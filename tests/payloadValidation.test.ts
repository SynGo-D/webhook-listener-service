import { describe, it, expect, beforeAll } from "vitest";

process.env.GITHUB_WEBHOOK_SECRET = "github-test-secret";
process.env.GITLAB_WEBHOOK_SECRET = "gitlab-test-secret";
process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

let GithubWebhookHandler: typeof import("../src/adapters/GithubWebhookHandler.js").GithubWebhookHandler;
let GitlabWebhookHandler: typeof import("../src/adapters/GitlabWebhookHandler.js").GitlabWebhookHandler;
let WebhookValidationError: typeof import("../src/errors/WebhookValidationError.js").WebhookValidationError;

beforeAll(async () => {
    ({ GithubWebhookHandler } = await import("../src/adapters/GithubWebhookHandler.js"));
    ({ GitlabWebhookHandler } = await import("../src/adapters/GitlabWebhookHandler.js"));
    ({ WebhookValidationError } = await import("../src/errors/WebhookValidationError.js"));
});

function githubPayload(overrides: Record<string, unknown> = {}) {
    return {
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
        ...overrides,
    };
}

function gitlabPayload(overrides: Record<string, unknown> = {}) {
    return {
        user: { id: 3, username: "bob" },
        project: {
            id: 12, path_with_namespace: "acme/shop",
            namespace: "acme", web_url: "https://gitlab.com/acme/shop",
        },
        object_attributes: {
            iid: 7, title: "Add feature", state: "opened", action: "open",
            url: "https://gitlab.com/acme/shop/-/merge_requests/7",
            source_branch: "feature", target_branch: "main",
            created_at: "2026-09-20 10:00:00 UTC", updated_at: "2026-09-20 10:05:00 UTC",
            last_commit: { id: "def456" },
        },
        ...overrides,
    };
}

/**
 * A payload that clears signature verification but is structurally wrong
 * used to reach normalize() and throw a raw TypeError — surfacing as a 500,
 * which providers treat as retryable. Since the payload is identically
 * malformed on every retry, that produced an endless redelivery loop. These
 * assert the permanent-failure path instead.
 */
describe("payload shape validation", () => {

    describe("GitHub", () => {
        it("normalizes a well-formed payload", () => {
            const event = new GithubWebhookHandler().normalize({}, githubPayload(), "d1");

            expect(event.provider).toBe("github");
            expect(event.pullRequestId).toBe("42");
            expect(event.repository.fullName).toBe("acme/shop");
            expect(event.sourceBranch).toBe("feature");
            expect(event.commitSha).toBe("abc123");
            expect(event.author).toEqual({ providerUserId: "7", username: "alice" });
        });

        it("rejects the shallow-but-hollow payload that used to cause a 500", () => {
            const hollow = { action: "opened", number: 1, pull_request: {}, repository: {} };

            expect(() => new GithubWebhookHandler().normalize({}, hollow, "d1"))
                .toThrow(WebhookValidationError);
        });

        it.each([
            ["repository.owner.login", { repository: { id: 1, full_name: "a/b", owner: {}, html_url: "u" } }],
            ["pull_request.head.sha", { pull_request: { ...githubPayload().pull_request, head: { ref: "f" } } }],
            ["number", { number: undefined }],
            ["action", { action: undefined }],
        ])("rejects a payload missing %s", (_label, override) => {
            expect(() => new GithubWebhookHandler().normalize({}, githubPayload(override), "d1"))
                .toThrow(WebhookValidationError);
        });

        it("names the missing fields in the error, so a real payload change is diagnosable", () => {
            const hollow = { action: "opened", number: 1, pull_request: {}, repository: {} };

            expect(() => new GithubWebhookHandler().normalize({}, hollow, "d1"))
                .toThrow(/pull_request\.state/);
        });

        it("still accepts a payload with a null author (deleted GitHub account)", () => {
            const event = new GithubWebhookHandler().normalize(
                {}, githubPayload({ pull_request: { ...githubPayload().pull_request, user: null } }), "d1"
            );

            expect(event.author).toBeUndefined();
        });

        it("accepts merged: false without treating it as missing", () => {
            // `false` is a legitimate value — a presence check that rejects
            // falsy values would break every open pull request.
            expect(() => new GithubWebhookHandler().normalize({}, githubPayload(), "d1")).not.toThrow();
        });

        it.each([
            ["opened", false, "opened", "open"],
            ["reopened", false, "reopened", "open"],
            ["synchronize", false, "synchronize", "open"],
            ["closed", false, "closed", "closed"],
            ["closed", true, "merged", "merged"],
            ["some_future_action", false, "unknown", "open"],
        ])("maps action=%s merged=%s to %s/%s", (action, merged, expectedAction, expectedState) => {
            const payload = githubPayload({
                action,
                pull_request: {
                    ...githubPayload().pull_request,
                    merged,
                    state: action === "closed" ? "closed" : "open",
                },
            });

            const event = new GithubWebhookHandler().normalize({}, payload, "d1");
            expect(event.action).toBe(expectedAction);
            expect(event.state).toBe(expectedState);
        });

        it("rejects a request with no X-GitHub-Delivery header", () => {
            expect(() => new GithubWebhookHandler().extractDeliveryId({}, githubPayload()))
                .toThrow(WebhookValidationError);
        });

        it("only accepts pull_request events", () => {
            const handler = new GithubWebhookHandler();
            expect(handler.supportsEvent({ "x-github-event": "pull_request" })).toBe(true);
            expect(handler.supportsEvent({ "x-github-event": "push" })).toBe(false);
            expect(handler.supportsEvent({})).toBe(false);
        });
    });

    describe("GitLab", () => {
        it("normalizes a well-formed payload", () => {
            const event = new GitlabWebhookHandler().normalize({}, gitlabPayload(), "d1");

            expect(event.provider).toBe("gitlab");
            expect(event.pullRequestId).toBe("7");
            expect(event.repository.fullName).toBe("acme/shop");
            expect(event.commitSha).toBe("def456");
        });

        it("rejects a hollow payload", () => {
            const hollow = { object_attributes: {}, project: {} };

            expect(() => new GitlabWebhookHandler().normalize({}, hollow, "d1"))
                .toThrow(WebhookValidationError);
        });

        it("accepts a payload with no last_commit", () => {
            const payload = gitlabPayload({
                object_attributes: { ...gitlabPayload().object_attributes, last_commit: undefined },
            });

            expect(new GitlabWebhookHandler().normalize({}, payload, "d1").commitSha).toBeUndefined();
        });

        it("derives a stable delivery ID from the same payload", () => {
            const handler = new GitlabWebhookHandler();
            const first  = handler.extractDeliveryId({}, gitlabPayload());
            const second = handler.extractDeliveryId({}, gitlabPayload());

            expect(first).toBe(second);
        });

        it("derives a different delivery ID once updated_at changes", () => {
            const handler = new GitlabWebhookHandler();
            const later = gitlabPayload({
                object_attributes: {
                    ...gitlabPayload().object_attributes,
                    updated_at: "2026-09-20 10:06:00 UTC",
                },
            });

            expect(handler.extractDeliveryId({}, gitlabPayload()))
                .not.toBe(handler.extractDeliveryId({}, later));
        });

        it("rejects a delivery-ID request for a malformed payload", () => {
            expect(() => new GitlabWebhookHandler().extractDeliveryId({}, { project: {} }))
                .toThrow(WebhookValidationError);
        });

        it("prefers GitLab's Idempotency-Key header, which is stable across retries", () => {
            // The payload fingerprint can't tell a retry from a genuinely new
            // event that lands in the same second; the header can.
            const handler = new GitlabWebhookHandler();
            const headers = { "idempotency-key": "5f0c-retry-stable", "webhook-id": "msg_1" };

            expect(handler.extractDeliveryId(headers, gitlabPayload())).toBe("idem:5f0c-retry-stable");
        });

        it("falls back to the webhook-id header when there is no Idempotency-Key", () => {
            const handler = new GitlabWebhookHandler();

            expect(handler.extractDeliveryId({ "webhook-id": "msg_1" }, gitlabPayload())).toBe("whid:msg_1");
        });

        it("namespaces header IDs so they can never collide with a fingerprint", () => {
            const handler = new GitlabWebhookHandler();
            const fingerprint = handler.extractDeliveryId({}, gitlabPayload());

            expect(handler.extractDeliveryId({ "idempotency-key": fingerprint }, gitlabPayload()))
                .not.toBe(fingerprint);
        });

        it("ignores an empty or array-valued header and uses the fingerprint", () => {
            const handler = new GitlabWebhookHandler();
            const fingerprint = handler.extractDeliveryId({}, gitlabPayload());

            expect(handler.extractDeliveryId({ "idempotency-key": "" }, gitlabPayload())).toBe(fingerprint);
            expect(handler.extractDeliveryId(
                { "idempotency-key": ["a", "b"] as unknown as string }, gitlabPayload()
            )).toBe(fingerprint);
        });
    });
});
