import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";

const query = vi.fn();
vi.mock("../src/config/database.js", () => ({ pool: { query } }));

const { ProcessedWebhookEventRepository } = await import("../src/repositories/ProcessedWebhookEventRepository.js");
const { startRetentionJob } = await import("../src/repositories/retentionJob.js");

describe("ProcessedWebhookEventRepository.deleteOlderThan", () => {
    beforeEach(() => query.mockReset());

    it("deletes in batches until a batch comes back short", async () => {
        // Batching keeps a first run over a large backlog from holding one
        // long transaction next to live inserts.
        query
            .mockResolvedValueOnce({ rowCount: 3 })
            .mockResolvedValueOnce({ rowCount: 3 })
            .mockResolvedValueOnce({ rowCount: 1 });

        const removed = await new ProcessedWebhookEventRepository().deleteOlderThan(30, 3);

        expect(removed).toBe(7);
        expect(query).toHaveBeenCalledTimes(3);
        expect(query.mock.calls[0][1]).toEqual([30, 3]);
    });

    it("passes the retention window as a parameter, never interpolated", async () => {
        query.mockResolvedValueOnce({ rowCount: 0 });

        await new ProcessedWebhookEventRepository().deleteOlderThan(30);

        const sql = query.mock.calls[0][0] as string;
        expect(sql).toContain("make_interval(days => $1)");
        expect(sql).not.toContain("30");
    });
});

describe("startRetentionJob", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs shortly after startup and then every interval", async () => {
        const repository = { deleteOlderThan: vi.fn(async () => 0) };
        const stop = startRetentionJob(30, repository as never, 60_000);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(repository.deleteOlderThan).toHaveBeenCalledTimes(1);
        expect(repository.deleteOlderThan).toHaveBeenCalledWith(30);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(repository.deleteOlderThan).toHaveBeenCalledTimes(2);  // t=30s initial, t=60s interval

        stop();
    });

    it("keeps running after a failed purge — housekeeping must never crash the service", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const repository = { deleteOlderThan: vi.fn(async () => { throw new Error("db down"); }) };
        const stop = startRetentionJob(30, repository as never, 60_000);

        await vi.advanceTimersByTimeAsync(120_000);

        expect(repository.deleteOlderThan.mock.calls.length).toBeGreaterThan(1);
        expect(error).toHaveBeenCalled();
        stop();
        error.mockRestore();
    });

    it("stops completely when told to", async () => {
        const repository = { deleteOlderThan: vi.fn(async () => 0) };
        const stop = startRetentionJob(30, repository as never, 60_000);

        stop();
        await vi.advanceTimersByTimeAsync(10 * 60_000);

        expect(repository.deleteOlderThan).not.toHaveBeenCalled();
    });
});
