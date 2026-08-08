# models

Domain event models — the internal representation this service normalizes
every provider's payload into. Downstream consumers (RabbitMQ, the
Analysis/Orchestration service) only ever see these shapes, never raw
GitHub/GitLab payloads.

- `RepositoryRef` — provider-agnostic repository identity.
- `WebhookEvent` — the union of all normalized event types. Currently just
  `PullRequestEvent`; adding `push`, `branch`, `issue`, `deployment`, etc.
  later means adding a new member to this union and a new interface file
  here, without touching the controller or any code that already handles
  `WebhookEvent` generically.
- `PullRequestEvent` — the common representation GitHub `pull_request` and
  GitLab `Merge Request` events are normalized into (Phase 6 does the
  actual normalization; this phase only defines the target shape).
- `isPullRequestEvent()` — type guard for narrowing `WebhookEvent`.

No provider-specific parsing lives here — see `adapters/README.md`.
