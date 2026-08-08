# controllers

HTTP entry points for incoming webhooks. `WebhookController.handle` backs
`POST /webhooks/:provider` (see `src/routes/`). Responsibilities are
intentionally thin:

1. Parse the provider from the route and confirm the raw body is present.
2. Delegate everything else to `WebhookIngestionService`.
3. Translate the result into an HTTP response — `202` for accepted,
   `200` for an ignored (unsupported) event type, or the appropriate 4xx/5xx
   for an `AppError` thrown along the way.

No GitHub/GitLab API calls and no code-analysis logic live here — see the
target architecture in the root README.
