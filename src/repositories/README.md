# repositories

Data-access layer (Repository Pattern) — the only place raw SQL against
Postgres lives, matching integration-service's convention of `pg` without
an ORM.

- `ProcessedWebhookEventRepository` — backs idempotency/dedup (Phase 7).
  `tryMarkProcessed(provider, deliveryId, eventType)` attempts an INSERT
  directly and treats a unique-violation as "duplicate" rather than doing a
  SELECT-then-INSERT check — the INSERT's atomicity is what makes this safe
  under concurrent redelivery. `unmarkProcessed` rolls back the mark if
  normalization or publishing fails afterward, so a failure doesn't
  permanently block a legitimate retry of the same delivery.
