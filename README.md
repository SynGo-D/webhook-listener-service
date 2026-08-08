# Webhook Listener

Event-ingestion microservice for the CodePulse automated code-review
platform. Receives GitHub/GitLab webhooks, verifies and normalizes them,
and publishes internal events to RabbitMQ for the downstream
Analysis/Orchestration service to consume.

**This service never analyzes code.** Its only job is turning external
provider events into trusted, normalized internal events, quickly and
reliably.

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
                 1. Verify signature
                          │
                 2. Validate payload
                          │
                 3. Identify provider
                          │
                 4. Normalize event
                          │
                 5. Deduplicate
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
| `services/` | Orchestrates verify → normalize → dedup → publish |
| `adapters/` | Provider-specific handlers (GitHub, GitLab) — Adapter Pattern |
| `factories/` | Selects the right adapter for a request — Factory Pattern |
| `models/` | Internal domain event shapes (`WebhookEvent`, `PullRequestEvent`) |
| `repositories/` | Postgres access (idempotency tracking) — Repository Pattern |
| `messaging/` | RabbitMQ publisher + topology |
| `middleware/`, `errors/`, `config/` | Cross-cutting infrastructure |

Each layer's `README.md` describes its responsibility and which phase adds
real code to it.

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

# 4. Run database migrations (none yet — added in Phase 7)
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
6. Event normalization (GitHub PR / GitLab MR → `PullRequestEvent`)
7. Idempotency / duplicate-event protection
8. RabbitMQ publisher (durable exchange/queue, persistent messages)
9. Retry / dead-letter handling
10. Testing (unit, integration, API, e2e)
11. Docker/AWS/Kubernetes deployment configuration
