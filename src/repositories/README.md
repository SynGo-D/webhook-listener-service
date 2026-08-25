# repositories

Data-access layer (Repository Pattern) — the only place raw SQL against
Postgres lives, matching integration-service's convention of `pg` without
an ORM. This service persists as little as possible; the primary need is
tracking processed provider delivery/event IDs for idempotency.

Implemented (Phase 7): `ProcessedEventRepository` — atomically claims a
provider delivery ID before the current acknowledgment. The database's
`(provider, delivery_id)` unique key makes concurrent retries safe and lets
the controller recognize duplicate deliveries.

RabbitMQ publishing is still a later phase. When publishing is added, this
claim step should be moved into the service workflow or replaced with an
outbox/status design so a delivery is not treated as complete before it is
published successfully.
