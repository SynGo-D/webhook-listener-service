import { describe, it, expect, beforeAll } from "vitest";

process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

let toPRJob: typeof import("../src/messaging/PullRequestJobPublisher.js").toPRJob;
let MAX_DESCRIPTION_LENGTH: number;

beforeAll(async () => {
    ({ toPRJob, MAX_DESCRIPTION_LENGTH } = await import("../src/messaging/PullRequestJobPublisher.js"));
});

function event(overrides: Record<string, unknown> = {}) {
    return {
        eventType: "pull_request",
        provider: "github",
        deliveryId: "d1",
        receivedAt: "2026-09-21T10:00:00Z",
        repository: { providerRepositoryId: "1", fullName: "acme/shop", owner: "acme", url: "https://github.com/acme/shop" },
        pullRequestId: "42",
        action: "opened",
        state: "open",
        title: "Add bulk discounts",
        description: "Adds a bulk discount type.",
        sourceBranch: "feature/bulk",
        targetBranch: "main",
        commitSha: "abc123",
        url: "https://github.com/acme/shop/pull/42",
        createdAt: "2026-09-21T09:00:00Z",
        updatedAt: "2026-09-21T09:30:00Z",
        ...overrides,
    } as never;
}

describe("toPRJob", () => {
    it("carries what the AI review needs: target branch, title and description", () => {
        const job = toPRJob(event());

        expect(job).toMatchObject({
            branch: "feature/bulk",
            targetBranch: "main",
            title: "Add bulk discounts",
            description: "Adds a bulk discount type.",
        });
    });

    it("keeps the original PRJob fields unchanged for existing consumers", () => {
        expect(toPRJob(event())).toMatchObject({
            repository: "acme/shop",
            cloneUrl: "https://github.com/acme/shop.git",
            commit: "abc123",
            prNumber: 42,
            provider: "github",
            timestamp: "2026-09-21T10:00:00Z",
        });
    });

    it("truncates a long description, since every character costs tokens downstream", () => {
        const job = toPRJob(event({ description: "x".repeat(MAX_DESCRIPTION_LENGTH + 500) }));

        expect(job.description).toHaveLength(MAX_DESCRIPTION_LENGTH);
    });

    it("omits the description when the PR has none", () => {
        expect(toPRJob(event({ description: undefined })).description).toBeUndefined();
    });
});
