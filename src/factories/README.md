# factories

`ProviderHandlerFactory.create(provider)` — selects the correct provider
adapter (from `src/adapters/`) for an incoming webhook request (Factory
Pattern). The caller (the webhook controller, Phase 5) already knows the
provider from which route matched (`/webhooks/github` vs
`/webhooks/gitlab`), so this factory only centralizes handler
instantiation — the controller depends on `ProviderWebhookHandler`, never
on `GithubWebhookHandler`/`GitlabWebhookHandler` directly.
