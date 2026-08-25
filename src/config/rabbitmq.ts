import amqplib, { type ChannelModel, type ConfirmChannel } from "amqplib";
import { env } from "./env.js";

/**
 * Shared RabbitMQ connection + channel.
 *
 * Uses a *confirm* channel, not a plain one: a plain channel's `publish()`
 * only confirms the message was written to the local socket buffer, not
 * that the broker actually received and routed it. A confirm channel gets
 * a real per-message ack/nack from the broker — the messaging layer
 * (PullRequestJobPublisher) depends on that to know whether a publish
 * genuinely succeeded.
 *
 * Deliberately topology-agnostic: this module only knows about the
 * connection, never about exchanges/queues (that's messaging/topology.ts).
 * `onRabbitMQReconnect` lets a higher layer (server.ts) hook "re-run
 * topology setup" into the reconnect flow without this module importing
 * business-layer code — keeping the dependency direction pointing the
 * right way.
 */
let connection: ChannelModel  | undefined;
let channel:    ConfirmChannel | undefined;
let reconnecting = false;
let onReconnect: (() => Promise<void>) | undefined;

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS     = 30_000;

/**
 * Connects to RabbitMQ and opens a shared confirm channel.
 * Fail-fast on the *initial* connection: exits the process if the broker
 * cannot be reached at startup, same as the Postgres connection check —
 * this service should not accept webhook traffic it cannot durably hand
 * off downstream. A connection that drops later is handled by
 * reconnection (see below), not a process exit — a transient network blip
 * shouldn't require manual intervention to recover from.
 */
export async function connectRabbitMQ(): Promise<void> {
    try {
        await establishConnection();
    } catch (error) {
        console.error("Failed to connect to RabbitMQ:", error);
        process.exit(1);
    }
}

async function establishConnection(): Promise<void> {
    connection = await amqplib.connect(env.RABBITMQ_URL);
    channel    = await connection.createConfirmChannel();

    console.log("Webhook Listener connected to RabbitMQ.");

    connection.on("error", (error) => {
        // "close" fires right after "error" for a dropped connection —
        // just log here, the actual recovery happens in the close handler.
        console.error("RabbitMQ connection error:", error);
    });

    connection.on("close", () => {
        console.warn("RabbitMQ connection closed — attempting to reconnect...");
        connection = undefined;
        channel    = undefined;
        void scheduleReconnect();
    });
}

async function scheduleReconnect(delayMs = INITIAL_RECONNECT_DELAY_MS): Promise<void> {
    // Guards against overlapping reconnect loops if "close" somehow fires
    // more than once before a reconnect attempt resolves.
    if (reconnecting) return;
    reconnecting = true;

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
        await establishConnection();
        await onReconnect?.();
        reconnecting = false;
        console.log("RabbitMQ reconnected.");
    } catch (error) {
        console.error("RabbitMQ reconnect attempt failed, retrying:", error);
        reconnecting = false;
        void scheduleReconnect(Math.min(delayMs * 2, MAX_RECONNECT_DELAY_MS));
    }
}

/**
 * Registers a callback to run after a successful reconnect (e.g.
 * re-asserting exchange/queue/binding topology on the new channel — the
 * durable objects themselves persist on the broker across a connection
 * drop, but the new channel needs to re-declare them to use them).
 */
export function onRabbitMQReconnect(handler: () => Promise<void>): void {
    onReconnect = handler;
}

export function getRabbitMQChannel(): ConfirmChannel {
    if (!channel) {
        throw new Error("RabbitMQ channel requested before connectRabbitMQ() completed.");
    }
    return channel;
}

export function isRabbitMQConnected(): boolean {
    return connection !== undefined && channel !== undefined;
}

export async function closeRabbitMQ(): Promise<void> {
    await channel?.close();
    await connection?.close();
}
