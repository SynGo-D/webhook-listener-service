import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { createHmac } from "node:crypto";

const GITHUB_SECRET = "github-test-secret";
process.env.GITHUB_WEBHOOK_SECRET = GITHUB_SECRET;
process.env.GITLAB_WEBHOOK_SECRET = "gitlab-test-secret";
process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

let WebhookIngestionService: typeof import("../src/services/WebhookIngestionService.js").WebhookIngestionService;
let InvalidSignatureError: typeof import("../src/errors/InvalidSignatureError.js").InvalidSignatureError;

beforeAll(async () => {
    ({ WebhookIngestionService } = await import("../src/services/WebhookIngestionService.js"));
    ({ InvalidSignatureError } = await import("../src/errors/InvalidSignatureError.js"));
});

const PAYLOAD = {
    action: "opened",
    number: 42,
    pull_request: {
        state: "open", merged: false, title: "Add feature",
        html_url: "https://github.com/acme/shop/pull/42",
        created_at: "2026-09-20T10:00:00Z", updated_at: "2026-09-20T10:05:00Z",
        user: { id: 7, login: "alice" },
        head: { ref: "feature", sha: "abc123" },
        base: { ref: "main" },
    },
    repository: {
        id: 99, full_name: "acme/shop",
        owner: { login: "acme" }, html_url: "https://github.com/acme/shop",
    },
};

const RAW_BODY = Buffer.from(JSON.stringify(PAYLOAD));
const VALID_SIG = "sha256=" + createHmac("sha256", GITHUB_SECRET).update(RAW_BODY).digest("hex");

function validHeaders(deliveryId = "delivery-1") {
    return {
        "x-hub-signature-256": VALID_SIG,
        "x-github-event": "pull_request",
        "x-github-delivery": deliveryId,
    };
}

type Secrets = { secrets: string[]; legacy: boolean };

/** The repository in PAYLOAD is connected, with GITHUB_SECRET as its own secret. */
const CONNECTED: Secrets = { secrets: [GITHUB_SECRET], legacy: false };

function makeHarness(options: {
    alreadyProcessed?: boolean;
    publishFails?: boolean;
    secrets?: Secrets | Error;
    legacySecret?: string;
} = {}) {
    const secretClient = {
        getSecrets: vi.fn(async () => {
            const answer = options.secrets ?? CONNECTED;
            if (answer instanceof Error) throw answer;
            return answer;
        }),
    };
    const repository = {
        tryMarkProcessed: vi.fn(async () => !options.alreadyProcessed),
        unmarkProcessed:  vi.fn(async () => undefined),
    };
    const publisher = {
        publish: vi.fn(async () => {
            if (options.publishFails) throw new Error("broker unreachable");
        }),
    };
    const service = new WebhookIngestionService(
        repository as never, publisher as never, secretClient,
        { github: options.legacySecret ?? "", gitlab: "" }
    );
    return { service, repository, publisher, secretClient };
}

/**
 * The ingestion pipeline's ordering guarantees are the substance of this
 * service. Each one below is load-bearing:
 *   - verify before anything else, so an unauthenticated caller can't probe
 *   - mark-processed before publishing, so concurrent redeliveries collapse
 *   - roll the mark back on failure, so a transient error doesn't silently
 *     discard a delivery forever
 */
describe("WebhookIngestionService.ingest", () => {
    beforeEach(() => vi.clearAllMocks());

    it("accepts and publishes a valid delivery", async () => {
        const { service, publisher } = makeHarness();

        const result = await service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD);

        expect(result).toEqual({ outcome: "accepted", deliveryId: "delivery-1" });
        expect(publisher.publish).toHaveBeenCalledOnce();
    });

    it("rejects an invalid signature", async () => {
        const { service } = makeHarness();
        const headers = { ...validHeaders(), "x-hub-signature-256": "sha256=" + "0".repeat(64) };

        await expect(service.ingest("github", RAW_BODY, headers, PAYLOAD))
            .rejects.toBeInstanceOf(InvalidSignatureError);
    });

    it("verifies the signature before touching the database", async () => {
        // If dedup ran first, an unauthenticated flood could write a row
        // per request and probe which delivery IDs already exist.
        const { service, repository, publisher } = makeHarness();
        const headers = { ...validHeaders(), "x-hub-signature-256": "sha256=" + "0".repeat(64) };

        await expect(service.ingest("github", RAW_BODY, headers, PAYLOAD)).rejects.toThrow();

        expect(repository.tryMarkProcessed).not.toHaveBeenCalled();
        expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("ignores an unsupported event without publishing", async () => {
        const { service, repository, publisher } = makeHarness();
        const headers = { ...validHeaders(), "x-github-event": "push" };

        const result = await service.ingest("github", RAW_BODY, headers, PAYLOAD);

        expect(result.outcome).toBe("ignored");
        expect(repository.tryMarkProcessed).not.toHaveBeenCalled();
        expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("ignores a duplicate delivery without republishing", async () => {
        const { service, publisher } = makeHarness({ alreadyProcessed: true });

        const result = await service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD);

        expect(result).toEqual({
            outcome: "ignored",
            reason: "Duplicate delivery — already processed.",
        });
        expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("marks the delivery processed before publishing, not after", async () => {
        // Order matters under concurrent redelivery: publishing first would
        // let two simultaneous copies both publish before either marked.
        const order: string[] = [];
        const repository = {
            tryMarkProcessed: vi.fn(async () => { order.push("mark"); return true; }),
            unmarkProcessed:  vi.fn(async () => undefined),
        };
        const publisher = { publish: vi.fn(async () => { order.push("publish"); }) };
        const secretClient = { getSecrets: vi.fn(async () => CONNECTED) };
        const service = new WebhookIngestionService(
            repository as never, publisher as never, secretClient, { github: "", gitlab: "" }
        );

        await service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD);

        expect(order).toEqual(["mark", "publish"]);
    });

    it("rolls back the dedup mark when publishing fails", async () => {
        // Without this, a broker blip would leave the delivery marked
        // processed forever — the provider's redelivery would be rejected
        // as a duplicate and the event lost silently.
        const { service, repository } = makeHarness({ publishFails: true });

        await expect(service.ingest("github", RAW_BODY, validHeaders("d-fail"), PAYLOAD)).rejects.toThrow();

        expect(repository.unmarkProcessed).toHaveBeenCalledWith("github", "d-fail");
    });

    it("rolls back the dedup mark when normalization fails", async () => {
        const { service, repository } = makeHarness();
        // Names its repository (so it gets past the lookup) but nothing else.
        const hollow = { action: "opened", number: 1, pull_request: {}, repository: { full_name: "acme/shop" } };
        const rawHollow = Buffer.from(JSON.stringify(hollow));
        const sig = "sha256=" + createHmac("sha256", GITHUB_SECRET).update(rawHollow).digest("hex");

        await expect(service.ingest("github", rawHollow, {
            "x-hub-signature-256": sig,
            "x-github-event": "pull_request",
            "x-github-delivery": "d-bad-shape",
        }, hollow)).rejects.toThrow();

        expect(repository.unmarkProcessed).toHaveBeenCalledWith("github", "d-bad-shape");
    });

    it("does not roll back a mark it never made", async () => {
        const { service, repository } = makeHarness({ alreadyProcessed: true });

        await service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD);

        expect(repository.unmarkProcessed).not.toHaveBeenCalled();
    });

    it("rejects an unknown provider", async () => {
        const { service } = makeHarness();

        await expect(service.ingest("bitbucket", RAW_BODY, validHeaders(), PAYLOAD)).rejects.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Per-integration secrets and the repository allowlist
// ---------------------------------------------------------------------------

describe("WebhookIngestionService — repository allowlist", () => {
    beforeEach(() => vi.clearAllMocks());

    it("looks up the secrets of the repository the payload names", async () => {
        const { service, secretClient } = makeHarness();

        await service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD);

        expect(secretClient.getSecrets).toHaveBeenCalledWith("github", "acme/shop");
    });

    it("rejects a correctly-formed delivery for a repository that isn't connected", async () => {
        // The core of the fix: before, any payload signed with the one shared
        // secret was queued for analysis, whatever repository it named.
        const { service, repository, publisher } = makeHarness({ secrets: { secrets: [], legacy: false } });

        await expect(service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD))
            .rejects.toBeInstanceOf(InvalidSignatureError);
        expect(repository.tryMarkProcessed).not.toHaveBeenCalled();
        expect(publisher.publish).not.toHaveBeenCalled();
    });

    it("rejects a delivery signed with another repository's secret", async () => {
        // A leaked secret for one repository must not unlock another.
        const { service } = makeHarness({ secrets: { secrets: ["a-different-repositorys-secret"], legacy: false } });

        await expect(service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD))
            .rejects.toBeInstanceOf(InvalidSignatureError);
    });

    it("rejects a payload that doesn't name a repository, the same way as a bad signature", async () => {
        const { service, secretClient } = makeHarness();
        const { repository: _dropped, ...noRepository } = PAYLOAD;

        await expect(service.ingest("github", RAW_BODY, validHeaders(), noRepository))
            .rejects.toBeInstanceOf(InvalidSignatureError);
        expect(secretClient.getSecrets).not.toHaveBeenCalled();
    });

    it("accepts the old shared secret only for a repository flagged as legacy", async () => {
        const { service } = makeHarness({
            secrets: { secrets: [], legacy: true },
            legacySecret: GITHUB_SECRET,
        });

        const result = await service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD);
        expect(result.outcome).toBe("accepted");
    });

    it("never accepts the old shared secret for a repository connected with its own secret", async () => {
        // The legacy fallback must not become a way around per-integration
        // secrets: a leaked shared secret stays useless against new connections.
        const { service } = makeHarness({
            secrets: { secrets: ["this-repos-own-secret"], legacy: false },
            legacySecret: GITHUB_SECRET,
        });

        await expect(service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD))
            .rejects.toBeInstanceOf(InvalidSignatureError);
    });

    it("propagates a lookup outage without writing or publishing anything", async () => {
        const outage = Object.assign(new Error("Webhook verification is temporarily unavailable."), { statusCode: 503 });
        const { service, repository, publisher } = makeHarness({ secrets: outage });

        await expect(service.ingest("github", RAW_BODY, validHeaders(), PAYLOAD)).rejects.toThrow(/unavailable/);
        expect(repository.tryMarkProcessed).not.toHaveBeenCalled();
        expect(publisher.publish).not.toHaveBeenCalled();
    });
});
