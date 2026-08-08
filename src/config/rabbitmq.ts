import amqplib, { type ChannelModel, type Channel } from "amqplib";
import { env } from "./env.js";

/**
 * Shared RabbitMQ connection + channel.
 *
 * Only connection lifecycle lives here. Exchange/queue topology and
 * publishing logic belong to the messaging layer (added in a later phase)
 * — this module's only job is "are we connected", which the readiness
 * endpoint and the future publisher both depend on.
 */
let connection: ChannelModel | undefined;
let channel: Channel | undefined;

/**
 * Connects to RabbitMQ and opens a shared channel.
 * Fail-fast: exits the process if the broker cannot be reached, same as
 * the Postgres connection check — this service should not accept webhook
 * traffic it cannot durably hand off downstream.
 */
export async function connectRabbitMQ(): Promise<void> {
    try {
        connection = await amqplib.connect(env.RABBITMQ_URL);
        channel = await connection.createChannel();
        console.log("Webhook Listener connected to RabbitMQ.");
    } catch (error) {
        console.error("Failed to connect to RabbitMQ:", error);
        process.exit(1);
    }
}

export function getRabbitMQChannel(): Channel {
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
