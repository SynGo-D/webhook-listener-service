# adapters

Provider-specific webhook handlers — one per source-control provider
(GitHub, GitLab), each implementing a shared `ProviderWebhookHandler`
interface (Adapter Pattern). Each adapter is responsible for:

- Verifying that a request's signature/token actually came from that
  provider (GitHub HMAC-SHA256 `X-Hub-Signature-256`, GitLab's secret-token
  header) — added in Phase 4.
- Recognizing which of that provider's event types it received.
- Normalizing that provider's pull-request payload shape into the internal
  `models/` representation — implemented in Phase 6.

This keeps provider-specific payload structure (field names, header
conventions, signature schemes) entirely out of the controller and out of
downstream services. Adding a third provider later means adding one new
adapter here, not touching the controller.
