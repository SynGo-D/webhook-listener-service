# Webhook Listener

Event-ingestion microservice for the CodePulse automated code-review
platform. Receives GitHub/GitLab webhooks, verifies and normalizes them,
and publishes internal events to RabbitMQ for the downstream
Analysis/Orchestration service to consume.

**This service never analyzes code.** Its only job is turning external
provider events into trusted, normalized internal events, quickly and
reliably.

> **Interop note:** the platform also has a separate `SynGo-D/RabbitMQ`
> repo that already declares a durable `pr_queue` and consumes
> `PRJob`-shaped messages via plain `sendToQueue`. This service's
> messaging layer (Phase 8) is built to interoperate with that exactly —
> see `src/messaging/README.md` — rather than introducing a second,
> incompatible message contract or topology.

## Architecture

```text
                    GitHub / GitLab
                          │
                          │ Webhook (HTTP POST)
                          ▼
                 ┌─────────────────┐
                 │ Webhook Listener│
                 └────────┬────────┘
                          │
                 1. Identify provider
                          │
                 2. Look up the repository's secrets ──► integration-service
                          │                             (unconnected → 401)
                 3. Verify signature
                          │
                 4. Deduplicate
                          │
                 5. Validate + normalize event
                          │
                          ▼
                    ┌──────────┐
                    │ RabbitMQ │
                    └────┬─────┘
                         │
                         ▼
               Analysis / Orchestration
                       Service
                         │
                         ▼
                 Analysis Engine
```

```text
Webhook Listener
       │
       │ "A Pull Request was opened"
       ▼
    RabbitMQ
       │
       ▼
Analysis Service
       │
       │ "Analyze this PR"
       ▼
Analysis Engine
```

### Layers

| Layer | Responsibility |
|---|---|
| `routes/` | Maps HTTP verb/path to controller method — no logic |
| `controllers/` | HTTP entry points — thin, no business logic |
| `services/` | Orchestrates look up → verify → dedup → normalize → publish |
| `adapters/` | Provider-specific handlers (GitHub, GitLab) — Adapter Pattern |
| `factories/` | Selects the right adapter for a request — Factory Pattern |
| `models/` | Internal domain event shapes (`WebhookEvent`, `PullRequestEvent`) |
| `repositories/` | Postgres access (idempotency tracking + retention) — Repository Pattern |
| `clients/` | Calls to other services (`WebhookSecretClient` → integration-service) |
| `messaging/` | RabbitMQ publisher + topology |
| `middleware/`, `errors/`, `config/` | Cross-cutting infrastructure |

Each layer's `README.md` describes its responsibility and which phase adds
real code to it.

## Security

**Only connected repositories are accepted.** Each integration gets its own
random webhook secret when integration-service registers the hook. On every
delivery this service reads the repository name from the payload, asks
integration-service for that repository's secrets
(`GET /internal/webhook-secrets`, authenticated with `INTERNAL_SERVICE_TOKEN`),
and verifies the signature against them. A repository nobody has connected
has no secrets, so its deliveries fail with the same 401 as a forged
signature — callers can't tell "not connected" from "wrong secret". A leaked
secret only lets someone forge deliveries for that one repository.

The repository name is read *before* the signature is checked, which is
safe: it's only used to decide which secrets to try. If an attacker names
another repository, the check runs against that repository's secrets and
fails.

**Lookups are cached** (`src/clients/WebhookSecretClient.ts`): 60 s for a
connected repository, 10 s for an unconnected one (so a new connection
starts working quickly), at most 10,000 entries (attackers choose the names),
and concurrent lookups for the same repository share one request. If
integration-service is unreachable, secrets fetched in the last hour are
still used. Beyond that the delivery gets a **503, not a 401**. GitLab
disables a hook after four failures in a row and GitHub doesn't retry, so a
short outage of integration-service shouldn't count as "not connected".

**Legacy hooks.** Integrations connected before per-integration secrets have
no secret stored. For those repositories only (integration-service reports
`legacy: true`), the old shared `GITHUB_WEBHOOK_SECRET` /
`GITLAB_WEBHOOK_SECRET` is also tried. Reconnecting the repository removes
the need for it. Once none are left, clear both variables.

**GitLab deduplication** uses GitLab's `Idempotency-Key` header (GitLab
17.4+, the same across retries), then `webhook-id`, and only falls back to
a hash of the payload when neither header is sent.

**Retention.** Rows in `processed_webhook_events` exist only to catch
redeliveries, which providers stop sending within days. An hourly
in-process job deletes rows older than `DEDUP_RETENTION_DAYS` (default 30),
in batches.

**Rate limiting** is per IP: 300 requests/min overall, plus 50 *rejected*
(401) requests/min. Once an IP hits a limit, its valid deliveries are
throttled too until the window resets.

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 5002) |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | Postgres (idempotency records) |
| `RABBITMQ_URL` | Broker the PR jobs are published to |
| `INTEGRATION_SERVICE_URL` | Where to look up webhook secrets (default `http://localhost:5001`) |
| `INTERNAL_SERVICE_TOKEN` | Shared with integration-service; without it every delivery gets a 503 |
| `DEDUP_RETENTION_DAYS` | How long idempotency records are kept (default 30) |
| `GITHUB_WEBHOOK_SECRET` `GITLAB_WEBHOOK_SECRET` | **Legacy only.** The old shared secrets, used just for repositories connected before per-integration secrets |

## Tests

```bash
npm test
```

Vitest, no infrastructure required. Covers signature verification
(including multiple candidate secrets and the empty-list allowlist case),
payload validation, the order of steps in the ingestion pipeline, the
secret client's caching and outage behaviour, GitLab delivery IDs, and
the retention job.

## Local development

Requires Docker (for Postgres + RabbitMQ) and Node.js.

```bash
# 1. Start local infrastructure (Postgres on :5433, RabbitMQ on :5672,
#    RabbitMQ management UI on :15672)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Copy env config (already matches docker-compose.yml's ports/credentials)
cp .env.example .env

# 4. Run database migrations
npm run migrate:up

# 5. Start the service
npm run dev
```

```bash
curl http://localhost:5002/health   # liveness — process is up
curl http://localhost:5002/ready    # readiness — DB + RabbitMQ reachable
```

> Docker was not installed on the development machine at the time this
> service was scaffolded. The compose file above is the source of truth for
> local infra; install Docker before running these commands.

## Build roadmap

This service is being built incrementally, one phase at a time:

1. ✅ Project structure + local infrastructure
2. ✅ Domain event models (`WebhookEvent`, `PullRequestEvent`)
3. ✅ Provider abstraction (adapter interface + factory)
4. ✅ Signature verification (GitHub HMAC-SHA256, GitLab secret token)
5. ✅ Webhook controllers + routes
6. ✅ Event normalization (GitHub PR / GitLab MR → `PullRequestEvent`)
7. ✅ Idempotency / duplicate-event protection
8. ✅ RabbitMQ publisher (durable exchange/queue, persistent messages)
9. ◐ Retry / dead-letter handling. Publishing is retried (3 attempts, backoff),
   and the dedup mark is rolled back on failure so the provider's redelivery
   is still accepted. **There is no dead-letter queue yet**: a delivery that
   fails every retry returns 500 and depends on the provider redelivering it
   (GitLab retries, GitHub does not)
10. ◐ Testing: unit tests done (see Tests); integration/e2e not yet
11. Docker/AWS/Kubernetes deployment configuration

### Follow-ups

- **GitLab HMAC signatures.** GitLab 19.0 can sign deliveries
  (`webhook-signature`, Standard Webhooks format). Today GitLab deliveries
  are checked with the `X-Gitlab-Token` header, which proves who sent the
  delivery but not that the body is unchanged. Verifying the signature
  would cover the body too.
- **Dead-letter queue** (see phase 9).
