import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";

const GITHUB_SECRET = "github-test-secret-0123456789abcdef";
const GITLAB_SECRET = "gitlab-test-secret-0123456789abcdef";

process.env.GITHUB_WEBHOOK_SECRET = GITHUB_SECRET;
process.env.GITLAB_WEBHOOK_SECRET = GITLAB_SECRET;
process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

let GithubWebhookHandler: typeof import("../src/adapters/GithubWebhookHandler.js").GithubWebhookHandler;
let GitlabWebhookHandler: typeof import("../src/adapters/GitlabWebhookHandler.js").GitlabWebhookHandler;

beforeAll(async () => {
    ({ GithubWebhookHandler } = await import("../src/adapters/GithubWebhookHandler.js"));
    ({ GitlabWebhookHandler } = await import("../src/adapters/GitlabWebhookHandler.js"));
});

function githubSignature(body: Buffer, secret = GITHUB_SECRET): string {
    return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Signature verification is the entire security boundary of this service:
 * everything downstream — cloning a repository, running analysis — happens
 * because something got past this check. These tests exist so a future
 * refactor can't quietly weaken it.
 */
describe("GithubWebhookHandler.verifySignature", () => {

    const body = Buffer.from(JSON.stringify({ action: "opened", number: 1 }));

    it("accepts a correctly signed body", () => {
        const handler = new GithubWebhookHandler();
        const headers = { "x-hub-signature-256": githubSignature(body) };

        expect(handler.verifySignature(body, headers)).toBe(true);
    });

    it("rejects a body that was modified after signing", () => {
        const handler = new GithubWebhookHandler();
        const headers = { "x-hub-signature-256": githubSignature(body) };
        const tampered = Buffer.from(JSON.stringify({ action: "opened", number: 999 }));

        expect(handler.verifySignature(tampered, headers)).toBe(false);
    });

    it("rejects a signature produced with the wrong secret", () => {
        const handler = new GithubWebhookHandler();
        const headers = { "x-hub-signature-256": githubSignature(body, "not-the-secret") };

        expect(handler.verifySignature(body, headers)).toBe(false);
    });

    it("fails closed when the signature header is absent", () => {
        // The single most important case: no header must never mean
        // "skip verification".
        expect(new GithubWebhookHandler().verifySignature(body, {})).toBe(false);
    });

    it.each([
        ["empty string", ""],
        ["wrong prefix", "sha1=" + createHmac("sha256", GITHUB_SECRET).update(Buffer.from("x")).digest("hex")],
        ["hash without prefix", createHmac("sha256", GITHUB_SECRET).update(Buffer.from("x")).digest("hex")],
        ["truncated signature", githubSignature(Buffer.from("x")).slice(0, 20)],
        ["overlong signature", githubSignature(Buffer.from("x")) + "aaaa"],
        ["non-hex garbage", "sha256=" + "z".repeat(64)],
    ])("fails closed on a malformed signature header (%s)", (_label, header) => {
        // A length mismatch must return false, not throw — timingSafeEqual
        // raises on differing lengths, so the guard around it is load-bearing.
        const handler = new GithubWebhookHandler();
        expect(() => handler.verifySignature(body, { "x-hub-signature-256": header })).not.toThrow();
        expect(handler.verifySignature(body, { "x-hub-signature-256": header })).toBe(false);
    });

    it("rejects an array-valued header rather than coercing it", () => {
        const handler = new GithubWebhookHandler();
        const headers = { "x-hub-signature-256": [githubSignature(body)] as unknown as string };

        expect(handler.verifySignature(body, headers)).toBe(false);
    });

    it("verifies over raw bytes, so key order in the JSON matters", () => {
        // This is what makes capturing rawBody in app.ts necessary: the
        // same object re-serialized in a different order has a different
        // signature, so verifying against a re-stringified body would
        // reject legitimate deliveries.
        const handler = new GithubWebhookHandler();
        const original   = Buffer.from('{"a":1,"b":2}');
        const reordered  = Buffer.from('{"b":2,"a":1}');
        const headers = { "x-hub-signature-256": githubSignature(original) };

        expect(handler.verifySignature(original, headers)).toBe(true);
        expect(handler.verifySignature(reordered, headers)).toBe(false);
    });
});

describe("GitlabWebhookHandler.verifySignature", () => {

    const body = Buffer.from("{}");

    it("accepts the correct token", () => {
        const handler = new GitlabWebhookHandler();
        expect(handler.verifySignature(body, { "x-gitlab-token": GITLAB_SECRET })).toBe(true);
    });

    it("rejects an incorrect token", () => {
        const handler = new GitlabWebhookHandler();
        expect(handler.verifySignature(body, { "x-gitlab-token": "wrong-token-same-length!!!!!!!!!!" })).toBe(false);
    });

    it("fails closed when the token header is absent", () => {
        expect(new GitlabWebhookHandler().verifySignature(body, {})).toBe(false);
    });

    it("fails closed, without throwing, on a differently-sized token", () => {
        const handler = new GitlabWebhookHandler();
        expect(() => handler.verifySignature(body, { "x-gitlab-token": "short" })).not.toThrow();
        expect(handler.verifySignature(body, { "x-gitlab-token": "short" })).toBe(false);
    });

    it("ignores the body entirely — GitLab's token does not cover it", () => {
        // Documents a real platform limitation rather than a bug: GitLab
        // offers no HMAC option, so the token authenticates the sender but
        // not the payload.
        const handler = new GitlabWebhookHandler();
        const headers = { "x-gitlab-token": GITLAB_SECRET };

        expect(handler.verifySignature(Buffer.from("anything"), headers)).toBe(true);
    });
});
