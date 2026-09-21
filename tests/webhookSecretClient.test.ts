import { describe, it, expect, vi } from "vitest";

process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

import { WebhookSecretClient, SecretLookupUnavailableError } from "../src/clients/WebhookSecretClient.js";

type Answer = { secrets: string[]; legacy: boolean } | "down" | "malformed" | number;

/** A fetch stub whose answers are scripted per call, plus a controllable clock. */
function harness(answers: Answer[]) {
    let clock = 1_000_000;
    const queue = [...answers];

    const fetchImpl = vi.fn(async () => {
        const next = queue.length > 1 ? queue.shift()! : queue[0];
        if (next === "down") throw new TypeError("fetch failed");
        if (typeof next === "number") return new Response("{}", { status: next });
        if (next === "malformed") return Response.json({ success: true, data: { secrets: "nope" } });
        return Response.json({ success: true, data: next });
    });

    const client = new WebhookSecretClient({
        baseUrl: "http://integration-service.test",
        token: "internal-token",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => clock,
    });

    return {
        client,
        fetchImpl,
        advance: (ms: number) => { clock += ms; },
    };
}

const CONNECTED = { secrets: ["s1"], legacy: false };
const UNCONNECTED = { secrets: [], legacy: false };

describe("WebhookSecretClient", () => {

    it("calls integration-service with the bearer token and the repository", async () => {
        const { client, fetchImpl } = harness([CONNECTED]);

        await client.getSecrets("github", "acme/shop");

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
        expect(url.toString())
            .toBe("http://integration-service.test/internal/webhook-secrets?provider=github&repository=acme%2Fshop");
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer internal-token");
    });

    it("serves a connected repository from cache for a minute", async () => {
        const { client, fetchImpl, advance } = harness([CONNECTED]);

        await client.getSecrets("github", "acme/shop");
        advance(59_000);
        await client.getSecrets("github", "acme/shop");
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        advance(2_000);
        await client.getSecrets("github", "acme/shop");
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("caches a miss only briefly, so a newly connected repository isn't rejected for long", async () => {
        const { client, fetchImpl, advance } = harness([UNCONNECTED, CONNECTED]);

        expect(await client.getSecrets("github", "acme/shop")).toEqual(UNCONNECTED);
        advance(11_000);
        expect(await client.getSecrets("github", "acme/shop")).toEqual(CONNECTED);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("treats repository names case-insensitively, like GitHub does", async () => {
        const { client, fetchImpl } = harness([CONNECTED]);

        await client.getSecrets("github", "Acme/Shop");
        await client.getSecrets("github", "acme/shop");

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("keeps the two providers' caches apart", async () => {
        const { client, fetchImpl } = harness([CONNECTED]);

        await client.getSecrets("github", "acme/shop");
        await client.getSecrets("gitlab", "acme/shop");

        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("serves stale secrets while integration-service is down, instead of rejecting real deliveries", async () => {
        // GitLab disables a hook after four consecutive failures and GitHub
        // never retries — without this, a short outage loses real events.
        const { client, advance } = harness([CONNECTED, "down"]);

        await client.getSecrets("github", "acme/shop");
        advance(30 * 60_000);

        expect(await client.getSecrets("github", "acme/shop")).toEqual(CONNECTED);
    });

    it("stops serving stale secrets after an hour, so a revoked repository can't deliver indefinitely", async () => {
        const { client, advance } = harness([CONNECTED, "down"]);

        await client.getSecrets("github", "acme/shop");
        advance(61 * 60_000);

        await expect(client.getSecrets("github", "acme/shop")).rejects.toBeInstanceOf(SecretLookupUnavailableError);
    });

    it.each([["unreachable", "down"], ["erroring", 500], ["unauthorized", 401], ["malformed", "malformed"]] as const)(
        "reports 503 when integration-service is %s and nothing is cached",
        async (_label, answer) => {
            // Crucially not "no secrets": that would reject every delivery
            // as though the repository weren't connected.
            const { client } = harness([answer]);

            const error = await client.getSecrets("github", "acme/shop").catch((e) => e);
            expect(error).toBeInstanceOf(SecretLookupUnavailableError);
            expect(error.statusCode).toBe(503);
        }
    );

    it("refuses to look anything up without an internal token", async () => {
        const client = new WebhookSecretClient({
            baseUrl: "http://x.test", token: "", fetchImpl: vi.fn() as unknown as typeof fetch,
        });

        await expect(client.getSecrets("github", "acme/shop")).rejects.toBeInstanceOf(SecretLookupUnavailableError);
    });

    it("shares one request between concurrent deliveries for the same repository", async () => {
        const { client, fetchImpl } = harness([CONNECTED]);

        await Promise.all(Array.from({ length: 10 }, () => client.getSecrets("github", "acme/shop")));

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("bounds the cache, since unauthenticated callers choose the repository names", async () => {
        const { client, fetchImpl } = harness([UNCONNECTED]);

        for (let i = 0; i < 10_001; i++) {
            await client.getSecrets("github", `invented/repo-${i}`);
        }
        const callsBefore = fetchImpl.mock.calls.length;

        // The very first name has been evicted, so it's fetched again.
        await client.getSecrets("github", "invented/repo-0");
        expect(fetchImpl.mock.calls.length).toBe(callsBefore + 1);
    });
});
