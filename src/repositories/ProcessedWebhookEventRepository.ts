import { pool } from "../config/database.js";
import type { Provider } from "../models/RepositoryRef.js";

const UNIQUE_VIOLATION = "23505";

/**
 * Data-access layer for idempotency / duplicate-event protection.
 *
 * The only operation is `tryMarkProcessed` — there is deliberately no
 * separate `isProcessed` check-then-insert pair. Attempting the INSERT
 * directly and treating a unique-violation as "already processed" is
 * atomic at the database level; a preceding SELECT would leave a race
 * window between the check and the insert under concurrent redelivery.
 */
export class ProcessedWebhookEventRepository {

    /**
     * Attempts to record this delivery as processed.
     *
     * @returns `true` if this is the first time this (provider, deliveryId)
     *          pair has been seen (safe to proceed), `false` if it's a
     *          duplicate (already recorded — caller should skip processing).
     */
    async tryMarkProcessed(
        provider:   Provider,
        deliveryId: string,
        eventType:  string
    ): Promise<boolean> {

        try {
            await pool.query(
                `INSERT INTO processed_webhook_events (provider, delivery_id, event_type)
                 VALUES ($1, $2, $3);`,
                [provider, deliveryId, eventType]
            );
            return true;

        } catch (error) {
            if (this.isUniqueViolation(error)) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Rolls back a `tryMarkProcessed` reservation. Called when normalization
     * or publishing fails after the delivery was marked — without this, a
     * failure partway through the pipeline would leave the delivery
     * permanently marked "processed" despite never actually being
     * published, silently losing it: a provider redelivery (or our own
     * future retry) would be rejected as a duplicate forever.
     */
    async unmarkProcessed(provider: Provider, deliveryId: string): Promise<void> {
        await pool.query(
            `DELETE FROM processed_webhook_events WHERE provider = $1 AND delivery_id = $2;`,
            [provider, deliveryId]
        );
    }

    private isUniqueViolation(error: unknown): boolean {
        return (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { code: unknown }).code === UNIQUE_VIOLATION
        );
    }
}
