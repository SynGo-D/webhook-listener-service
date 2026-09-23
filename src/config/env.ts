import "dotenv/config";

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
    // Webhook signature verification
    //
    // Each integration now has its own webhook secret, fetched from
    // integration-service per delivery (clients/WebhookSecretClient.ts).
    // INTERNAL_SERVICE_TOKEN must match integration-service's value.
    // -----------------------------------------------------------------------

    INTEGRATION_SERVICE_URL: process.env.INTEGRATION_SERVICE_URL ?? "http://localhost:5001",
    INTERNAL_SERVICE_TOKEN:  process.env.INTERNAL_SERVICE_TOKEN ?? "",

    // LEGACY. The single shared secrets every hook was signed with before
    // per-integration secrets. Only consulted for a repository whose active
    // integration predates the change (integration-service reports it as
    // `legacy`), so leaking these no longer affects newer connections.
    // Remove once every such integration has been reconnected.
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    GITLAB_WEBHOOK_SECRET: process.env.GITLAB_WEBHOOK_SECRET ?? "",

    // -----------------------------------------------------------------------
    // Idempotency record retention
    // How long a processed delivery ID is remembered. Must exceed the longest
    // window in which a provider may redeliver (GitHub allows manual
    // redelivery for a few days); 30 is comfortably beyond that.
    // -----------------------------------------------------------------------

    DEDUP_RETENTION_DAYS: Number(process.env.DEDUP_RETENTION_DAYS) || 30,
};
