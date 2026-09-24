import type { Channel } from "amqplib";

/**
 * RabbitMQ topology for this service.
 *
 * Deliberately interoperable with the platform's existing `RabbitMQ`
 * service/repo (SynGo-D/RabbitMQ): that repo already declares a durable
 * `pr_queue` and consumes plain PRJob-shaped messages via
 * `channel.sendToQueue` — no exchange involved. Rather than diverge onto
 * an incompatible pattern, this topology adds a durable topic exchange
 * *in front of* that same queue: `pr_queue` is bound to it under
 * `pr.#`, so every routing key this service ever publishes under `pr.*`
 * still lands exactly where the existing consumer already expects it.
 * Declaring the queue here too (not just the binding) is intentional and
 * safe — `assertQueue` is idempotent, and either service being the one
 * that happens to declare it first doesn't matter, *provided both pass
 * the same arguments*. See PR_QUEUE_ARGUMENTS below.
 *
 * Routing keys are `pr.<provider>.<action>` (e.g. `pr.github.opened`,
 * `pr.gitlab.merged`) — one wildcard binding (`pr.#`) catches all of them
 * today, but a future queue could bind to a narrower pattern (e.g.
 * `pr.*.merged`) without any change to the publisher.
 */
export const EXCHANGE_NAME = "webhook.events";
export const PR_QUEUE_NAME = "pr_queue"; // matches SynGo-D/RabbitMQ's QUEUES.PR_QUEUE exactly
export const PR_ROUTING_PATTERN = "pr.#";

export const DEAD_EXCHANGE_NAME = "webhook.events.dead";
export const DEAD_QUEUE_NAME = "pr_queue.dead";

/**
 * Failures are parked here rather than discarded.
 *
 * analysis-engine nacks a job it cannot process with requeue=false. With
 * no dead-letter exchange that tells RabbitMQ to *delete* the message, so
 * a pull request whose review failed — bad payload, clone failure,
 * provider outage, a bug of ours — vanished leaving only a log line.
 * Nothing could list what was lost, and nothing could be replayed.
 *
 * No `x-dead-letter-routing-key`: leaving it unset keeps the message's
 * original routing key, so a parked job still reads `pr.github.opened`
 * and the binding below mirrors the live topology exactly.
 *
 * MUST be identical to analysis-engine's PR_QUEUE_ARGUMENTS
 * (messaging/topology.py). Queue arguments are immutable in RabbitMQ and
 * both services declare this queue, so a mismatch is not a disagreement
 * that resolves itself — whichever declares second gets
 * PRECONDITION_FAILED and crash-loops. A test in each repo pins the
 * literal value.
 */
export const PR_QUEUE_ARGUMENTS = {
    "x-dead-letter-exchange": DEAD_EXCHANGE_NAME,
} as const;

/**
 * Fourteen days, after which a parked message expires.
 *
 * The broker's volume shares the host's disk, and an unbounded queue of
 * failures is its own outage. Long enough to notice a bad week and replay
 * it; expiry *is* the retention policy here, not an accident — these
 * messages are not kept forever.
 */
const DEAD_QUEUE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function buildPullRequestRoutingKey(provider: string, action: string): string {
    return `pr.${provider}.${action}`;
}

/**
 * Declares the exchange, the queue, and the binding between them. Called
 * once at startup, right after connecting — fail-fast, same as the
 * Postgres/RabbitMQ connection checks: this service shouldn't accept
 * webhook traffic it can't durably hand off downstream.
 */
export async function setupMessagingTopology(channel: Channel): Promise<void> {
    // The dead-letter side first, and not for tidiness: a queue whose
    // x-dead-letter-exchange names an exchange that does not exist yet
    // drops its rejected messages silently, which is the exact failure
    // this is here to prevent.
    await channel.assertExchange(DEAD_EXCHANGE_NAME, "topic", { durable: true });
    await channel.assertQueue(DEAD_QUEUE_NAME, {
        durable: true,
        arguments: { "x-message-ttl": DEAD_QUEUE_TTL_MS },
    });
    await channel.bindQueue(DEAD_QUEUE_NAME, DEAD_EXCHANGE_NAME, PR_ROUTING_PATTERN);

    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
    await channel.assertQueue(PR_QUEUE_NAME, {
        durable: true,
        arguments: { ...PR_QUEUE_ARGUMENTS },
    });
    await channel.bindQueue(PR_QUEUE_NAME, EXCHANGE_NAME, PR_ROUTING_PATTERN);
}
