# repositories

Data-access layer (Repository Pattern) — the only place raw SQL against
Postgres lives, matching integration-service's convention of `pg` without
an ORM. This service persists as little as possible; the primary need is
tracking processed provider delivery/event IDs for idempotency.

Planned (Phase 7): `ProcessedEventRepository` — records a delivery ID once
its event has been published to RabbitMQ, and lets the service layer check
"have we already handled this one" before publishing again.
