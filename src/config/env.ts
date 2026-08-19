import "dotenv/config";

function requiredSecret(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`${name} must be set to verify webhook requests.`);
    }

    return value;
}

/**
 * Centralised, type-safe access to all environment variables.
 *
 * Every variable should be read from process.env exactly once here.
 * The rest of the application should import `env` rather than
 * accessing process.env directly. This mirrors integration-service's
 * config/env.ts so the two codebases stay consistent to read.
 */
export const env = {

    NODE_ENV: process.env.NODE_ENV ?? "development",

    // -----------------------------------------------------------------------
    // Server
    // -----------------------------------------------------------------------

    PORT: Number(process.env.PORT) || 5002,

    // -----------------------------------------------------------------------
    // Database
    // -----------------------------------------------------------------------

    DB_HOST:     process.env.DB_HOST!,
    DB_PORT:     Number(process.env.DB_PORT) || 5432,
    DB_NAME:     process.env.DB_NAME!,
    DB_USER:     process.env.DB_USER!,
    DB_PASSWORD: process.env.DB_PASSWORD!,

    // -----------------------------------------------------------------------
    // RabbitMQ
    // -----------------------------------------------------------------------

    RABBITMQ_URL: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",

    // -----------------------------------------------------------------------
    // Provider webhook secrets (Phase 4 — signature verification)
    // -----------------------------------------------------------------------

    GITHUB_WEBHOOK_SECRET: requiredSecret("GITHUB_WEBHOOK_SECRET"), 
    GITLAB_WEBHOOK_SECRET: requiredSecret("GITLAB_WEBHOOK_SECRET"), 
};                                             
