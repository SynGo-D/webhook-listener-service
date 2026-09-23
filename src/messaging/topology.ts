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
 * that happens to declare it first doesn't matter.
 *
 * Routing keys are `pr.<provider>.<action>` (e.g. `pr.github.opened`,
 * `pr.gitlab.merged`) — one wildcard binding (`pr.#`) catches all of them
 * today, but a future queue could bind to a narrower pattern (e.g.
 * `pr.*.merged`) without any change to the publisher.
 */
export const EXCHANGE_NAME = "webhook.events";
export const PR_QUEUE_NAME = "pr_queue"; // matches SynGo-D/RabbitMQ's QUEUES.PR_QUEUE exactly
export const PR_ROUTING_PATTERN = "pr.#";

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
    await channel.assertExchange(EXCHANGE_NAME, "topic", { durable: true });
    await channel.assertQueue(PR_QUEUE_NAME, { durable: true });
    await channel.bindQueue(PR_QUEUE_NAME, EXCHANGE_NAME, PR_ROUTING_PATTERN);
}
