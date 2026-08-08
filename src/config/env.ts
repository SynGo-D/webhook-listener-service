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
    // Must match the secret/token configured in each provider's webhook
    // settings UI exactly. Generate one with:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    // -----------------------------------------------------------------------

    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    GITLAB_WEBHOOK_SECRET: process.env.GITLAB_WEBHOOK_SECRET ?? "",
};
