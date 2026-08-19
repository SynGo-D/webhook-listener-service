# models

Domain event models — the internal representation this service normalizes
every provider's payload into. Downstream consumers (RabbitMQ, the
Analysis/Orchestration service) only ever see these shapes, never raw
GitHub/GitLab payloads.

Implemented (Phase 2 and Phase 6):
- `WebhookEvent` — generic envelope: provider, event type, delivery ID,
  repository identity, timestamp, raw-payload reference.
- `PullRequestEvent` — the common representation GitHub `pull_request` and
  GitLab `Merge Request` events are normalized into by the provider adapters.

Designed so new event types (push, branch, issue, deployment, ...) can be
added as new model shapes without changing the webhook controller.
