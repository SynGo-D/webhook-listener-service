import { Pool } from "pg";
import { env } from "./env.js";

/**
 * Shared PostgreSQL connection pool.
 *
 * This service uses Postgres only where persistence is genuinely required
 * (idempotency/dedup tracking, added in a later phase) — it is not a
 * general-purpose datastore for this service. All access goes through this
 * pool rather than ad-hoc connections, matching integration-service.
 */
export const pool = new Pool({
    host:     env.DB_HOST,
    port:     env.DB_PORT,
    database: env.DB_NAME,
    user:     env.DB_USER,
    password: env.DB_PASSWORD,
    max:      10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

/**
 * Verifies that the database is reachable during server startup.
 * Fail-fast: exits the process if the connection cannot be established,
 * rather than serving traffic against a service that cannot persist events.
 */
export async function connectDatabase(): Promise<void> {
    try {
        const result = await pool.query("SELECT NOW();");
        console.log("Webhook Listener connected to PostgreSQL.", result.rows[0]);
    } catch (error) {
        console.error("Failed to connect to PostgreSQL:", error);
        process.exit(1);
    }
}
