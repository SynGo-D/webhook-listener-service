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

Planned: Phase 5.
