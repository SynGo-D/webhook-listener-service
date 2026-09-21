-- Migration: processed_webhook_events retention
-- Supports purging old idempotency records.
--
-- processed_webhook_events gained one row per delivery and never lost any —
-- unbounded growth for a table whose only job is catching redeliveries,
-- which happen within minutes (GitLab's retries) to a few days (GitHub's
-- manual redelivery window). ProcessedWebhookEventRepository.deleteOlderThan
-- now removes rows past DEDUP_RETENTION_DAYS (default 30).
--
-- Without this index that purge is a full scan every time it runs, and the
-- table it scans is exactly the one that was growing without bound.

CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_processed_at
    ON processed_webhook_events (processed_at);
