# adapters

Provider-specific webhook handlers — one per source-control provider
(GitHub, GitLab), each implementing the shared `ProviderWebhookHandler`
interface (Adapter Pattern). Fully implemented as of Phase 6:

- `ProviderWebhookHandler` — the contract: `verifySignature`,
  `supportsEvent`, `extractDeliveryId`, `normalize(headers, payload, deliveryId)`.
- `GithubWebhookHandler` — HMAC-SHA256 signature verification, header-based
  event filtering, `X-GitHub-Delivery`-based delivery ID, and normalization
  of `pull_request` payloads into `PullRequestEvent` (disambiguating
  "closed" vs. "merged" via the `merged` boolean, since GitHub's `action`
  field alone doesn't distinguish them).
- `GitlabWebhookHandler` — secret-token verification (not HMAC — GitLab's
  mechanism authenticates the sender but doesn't cover the payload the way
  GitHub's does), header-based event filtering, a SHA-256-derived delivery
  ID (project ID + MR IID + `updated_at`, so real follow-up events get a
  different ID than true redeliveries), and normalization of
  `Merge Request Hook` payloads. GitLab's `action: "update"` covers both
  "new commit" and "MR edited" — mapped to `"synchronize"` as a documented
  best-effort approximation, not a precise signal.

This keeps provider-specific payload structure (field names, header
conventions, signature schemes) entirely out of the controller and out of
downstream services. Adding a third provider later means implementing this
interface once, not touching the controller.
