-- Migration: processed_webhook_events
-- Backs idempotency / duplicate-event protection (Phase 7).
--
-- Design decisions:
--   • Dedup key is (provider, delivery_id) — GitHub's delivery UUID or
--     GitLab's derived fingerprint (see GitlabWebhookHandler.extractDeliveryId).
--     Scoped by provider even though a cross-provider collision between a
--     UUID and a SHA-256 hex string is effectively impossible, for
--     defense-in-depth and because it's free.
--   • The UNIQUE constraint is the concurrency-safety mechanism, not a
--     preceding SELECT: ProcessedWebhookEventRepository.tryMarkProcessed
--     attempts the INSERT directly and treats a unique-violation as "this
--     is a duplicate" — safe under concurrent redelivery, which a
--     check-then-insert pattern would not be.
--   • Deliberately lean: no repository/PR columns. Adding them would force
--     the dedup check to happen after normalization (to have that data),
--     which both wastes work on known duplicates and complicates pipeline
--     ordering for a benefit nothing currently needs.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS processed_webhook_events (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    provider VARCHAR(20) NOT NULL
        CHECK (provider IN ('github', 'gitlab')),

    delivery_id VARCHAR(255) NOT NULL,

    event_type VARCHAR(50) NOT NULL,

    processed_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT uq_processed_webhook_events_provider_delivery
        UNIQUE (provider, delivery_id)
);
