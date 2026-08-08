# factories

Selects the correct provider adapter (from `src/adapters/`) for an incoming
webhook request (Factory Pattern) — e.g. by inspecting the route it arrived
on (`/webhooks/github` vs `/webhooks/gitlab`) or a provider-identifying
header. Centralizes that selection so the controller never branches on
provider itself.

Planned (Phase 3): `ProviderHandlerFactory.create(provider)`.
