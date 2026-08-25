CREATE TABLE processed_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, delivery_id)
);

CREATE INDEX processed_webhook_events_received_at_idx
    ON processed_webhook_events (received_at);
