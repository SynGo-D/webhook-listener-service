# adapters

Provider-specific webhook handlers — one per source-control provider
(GitHub, GitLab), each implementing the shared `ProviderWebhookHandler`
interface (Adapter Pattern).

- `ProviderWebhookHandler` — the contract: `verifySignature`,
  `supportsEvent`, `extractDeliveryId`, `normalize`.
- `GithubWebhookHandler` / `GitlabWebhookHandler` — `supportsEvent`,
  GitHub's `extractDeliveryId` (reads `X-GitHub-Delivery`), and
  `verifySignature` (GitHub: HMAC-SHA256 over the raw body via
  `X-Hub-Signature-256`; GitLab: constant-time comparison of the
  `X-Gitlab-Token` header against the configured secret — GitLab's
  mechanism does not cover the payload the way GitHub's HMAC does) are all
  implemented. `normalize` and GitLab's `extractDeliveryId` remain Phase 6
  stubs — calling them before then throws a clear "implemented in Phase N"
  error.

This keeps provider-specific payload structure (field names, header
conventions, signature schemes) entirely out of the controller and out of
downstream services. Adding a third provider later means implementing this
interface once, not touching the controller.
