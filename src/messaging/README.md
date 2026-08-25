# messaging

RabbitMQ publisher and topology. The only layer that knows about RabbitMQ
— everything upstream just calls `publisher.publish(event)`.

- `topology.ts` — declares a durable topic exchange (`webhook.events`),
  asserts the existing `pr_queue` (matching SynGo-D/RabbitMQ's
  `QUEUES.PR_QUEUE` exactly), and binds it under `pr.#`. Interoperable by
  design with that separate repo's existing bare-queue consumer — this
  service adds exchange/routing-key infrastructure in front of the same
  queue rather than diverging onto an incompatible pattern.
- `PullRequestJobPublisher.ts` — maps our `PullRequestEvent` onto the
  `PRJob` shape that repo's consumer already expects (field names kept in
  sync by hand — no shared-types package exists between the two repos),
  and publishes it to `webhook.events` with routing key
  `pr.<provider>.<action>` via a *confirm* channel (real broker-side
  ack/nack per message, not just local-buffer success — see
  `config/rabbitmq.ts`). Wraps each publish in `retry.ts`'s backoff
  (3 attempts, 200ms base) to absorb brief broker blips fast; if every
  attempt fails, the error propagates to `WebhookIngestionService`, which
  rolls back the dedup mark — the provider's own webhook redelivery is the
  backstop for anything that outlasts these retries.
- `retry.ts` — small generic exponential-backoff retry helper.

Known gap in the adopted `PRJob` contract: it has no field for our
`deliveryId`, so the consumer has no way to do its own idempotency check —
it's entirely dependent on this service's dedup (see `repositories/`)
never letting a duplicate through. Worth raising with whoever owns the
consumer side.

**Consumer-side dead-letter handling is deliberately out of scope here.**
This service only publishes to `pr_queue`, never consumes it — configuring
a dead-letter-exchange on that queue is a policy decision for whoever
processes it (retry counts, poison-message handling), which this service
has no visibility into. Attempting it here would also risk a hard conflict
with SynGo-D/RabbitMQ's existing plain `assertQueue` declaration — RabbitMQ
rejects redeclaring a queue with different arguments.
