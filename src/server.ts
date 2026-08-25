// src/server.ts

import app from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, pool } from "./config/database.js";
import { connectRabbitMQ, closeRabbitMQ, getRabbitMQChannel, onRabbitMQReconnect } from "./config/rabbitmq.js";
import { setupMessagingTopology } from "./messaging/topology.js";

async function main(): Promise<void> {
    await connectDatabase();
    await connectRabbitMQ();

    // Re-run topology setup after every reconnect — the exchange/queue/
    // binding are durable and persist on the broker across a connection
    // drop, but a new channel still needs to (re-)declare them. Registered
    // before the initial setup call below so the exact same function
    // handles both the first connection and every reconnect thereafter.
    onRabbitMQReconnect(() => setupMessagingTopology(getRabbitMQChannel()));

    // Fail-fast, same as the connection checks above: this service
    // shouldn't accept webhook traffic it can't durably hand off to
    // pr_queue.
    try {
        await setupMessagingTopology(getRabbitMQChannel());
        console.log("RabbitMQ messaging topology ready.");
    } catch (error) {
        console.error("Failed to set up RabbitMQ messaging topology:", error);
        process.exit(1);
    }

    const server = app.listen(env.PORT, () => {
        console.log(`Webhook Listener running on port ${env.PORT}`);
        console.log(`Health: http://localhost:${env.PORT}/health`);
        console.log(`Ready:  http://localhost:${env.PORT}/ready`);
    });

    // Graceful shutdown.
    //
    // This service is designed to be stateless and run as multiple
    // instances behind a load balancer (see target architecture). In
    // Kubernetes, a pod receives SIGTERM before being killed — if we exit
    // immediately instead of draining, an in-flight webhook request (or an
    // unpublished RabbitMQ message) can be lost. Instead: stop accepting
    // new connections, let in-flight ones finish, then close the broker
    // channel/connection and the Postgres pool before exiting.
    const shutdown = (signal: string): void => {
        console.log(`${signal} received, shutting down gracefully...`);

        server.close(() => {
            void (async () => {
                await closeRabbitMQ();
                await pool.end();
                process.exit(0);
            })();
        });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT",  () => shutdown("SIGINT"));
}

main();
