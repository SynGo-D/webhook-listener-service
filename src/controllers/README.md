# controllers

HTTP entry points for incoming webhooks (`POST /webhooks/github`,
`POST /webhooks/gitlab`). Responsibilities are intentionally thin:

1. Parse request headers/params.
2. Delegate to the factory to get the right provider adapter.
3. Delegate to the service layer for signature verification, normalization,
   dedup, and publishing.
4. Return the appropriate HTTP response quickly — this endpoint must
   acknowledge valid events fast and must NOT synchronously wait on the
   Analysis/Orchestration service.

No GitHub/GitLab API calls and no code-analysis logic ever live here — see
the target architecture in the root README.

Implemented: Phase 5.

Current behavior:

- `POST /webhooks/github` and `POST /webhooks/gitlab` are mounted.
- Valid signatures or tokens receive HTTP `202 Accepted`.
- Invalid or missing credentials receive HTTP `401 Unauthorized`.
- Requests without a body receive HTTP `400 Bad Request`.
- Unknown routes receive HTTP `404 Not Found`.
- Valid requests are acknowledged only for now.
- Event normalization and downstream publishing will be added in later phases.
