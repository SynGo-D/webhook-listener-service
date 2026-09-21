import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        // Unit tests only — nothing here touches Postgres or RabbitMQ, so
        // `npm test` runs with no infrastructure at all.
    }
});
