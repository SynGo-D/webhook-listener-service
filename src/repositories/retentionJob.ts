import { ProcessedWebhookEventRepository } from "./ProcessedWebhookEventRepository.js";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Periodically purges idempotency records past the retention window.
 *
 * Runs in-process rather than as a cron job so there's nothing extra to
 * deploy. With several instances each runs its own copy, which is fine:
 * the delete is idempotent and the purge is cheap once the backlog is gone.
 *
 * Runs once shortly after startup (so a long-stopped instance catches up)
 * and hourly after that. A failed run is logged and retried next hour —
 * retention is housekeeping and must never take the service down.
 *
 * @returns a function that stops the job, for graceful shutdown
 */
export function startRetentionJob(
    retentionDays: number,
    repository = new ProcessedWebhookEventRepository(),
    intervalMs = HOUR_MS
): () => void {
    const run = async (): Promise<void> => {
        try {
            const removed = await repository.deleteOlderThan(retentionDays);
            if (removed > 0) {
                console.log(`[retention] removed ${removed} idempotency record(s) older than ${retentionDays} days.`);
            }
        } catch (error) {
            console.error("[retention] purge failed, will retry next interval:", error);
        }
    };

    // unref() so neither timer keeps the process alive on its own — shutdown
    // shouldn't have to wait for housekeeping.
    const initial  = setTimeout(() => void run(), 30_000);
    const interval = setInterval(() => void run(), intervalMs);
    initial.unref();
    interval.unref();

    return () => {
        clearTimeout(initial);
        clearInterval(interval);
    };
}
