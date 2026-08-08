# messaging

RabbitMQ publisher and topology setup — durable exchange/queue
declarations, persistent messages, routing keys, and the retry /
dead-letter-queue configuration that protects against lost events when the
downstream Analysis/Orchestration service is temporarily unavailable.

This is the only layer that knows about RabbitMQ. Everything upstream of
it just calls a plain `publish(event)`-shaped function.

Planned: Phase 8 (publisher, exchange/queue topology) and Phase 9
(retry/DLQ handling).
