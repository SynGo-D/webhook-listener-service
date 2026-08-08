// src/app.ts

import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { isRabbitMQConnected } from "./config/rabbitmq.js";
import { pool } from "./config/database.js";
import { WebhookIngestionService } from "./services/WebhookIngestionService.js";
import { WebhookController } from "./controllers/WebhookController.js";
import { createWebhookRoutes } from "./routes/webhookRoutes.js";

const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// Request-size limit: this endpoint is reachable from the public internet
// (GitHub/GitLab call it directly), so an unbounded body is a DoS vector.
// 2mb comfortably covers real GitHub/GitLab PR and MR payloads.
//
// The `verify` hook stashes the raw bytes on `req.rawBody` before they're
// parsed into JSON. Signature verification (a later phase) needs those
// exact bytes to recompute the HMAC — the parsed-and-re-serialized body is
// not guaranteed to match what the provider actually signed.
app.use(
    express.json({
        limit: "2mb",
        verify: (req, _res, buf) => {
            (req as express.Request).rawBody = buf;
        },
    })
);

// ---------------------------------------------------------------------------
// Health & readiness
//
// Deliberately separate:
//  • /health — liveness only ("is the process up"). No dependency checks,
//    so a slow/degraded database or broker doesn't cause a healthy process
//    to be killed and restarted for no reason.
//  • /ready  — readiness ("can this instance actually do its job"). Checked
//    by the load balancer / Kubernetes readiness probe before routing
//    webhook traffic to this instance.
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
    res.json({
        service: "webhook-listener",
        status:  "healthy",
    });
});

app.get("/ready", async (_req, res) => {
    const checks = {
        database: false,
        rabbitmq: isRabbitMQConnected(),
    };

    try {
        await pool.query("SELECT 1;");
        checks.database = true;
    } catch {
        checks.database = false;
    }

    const ready = checks.database && checks.rabbitmq;

    res.status(ready ? 200 : 503).json({
        service: "webhook-listener",
        ready,
        checks,
    });
});

// ---------------------------------------------------------------------------
// Dependency injection — wire service → controller → routes
// ---------------------------------------------------------------------------

const webhookIngestionService = new WebhookIngestionService();
const webhookController       = new WebhookController(webhookIngestionService);

// ---------------------------------------------------------------------------
// Route mounting
//
// POST /webhooks/github, POST /webhooks/gitlab. Note: normalize() (Phase 6)
// and GitLab's extractDeliveryId() (Phase 6) are still stubs — a real,
// correctly-signed, supported-event request will verify and route
// correctly, then fail loudly at that stub with a 500 until Phase 6 lands.
// That's the expected, honest state of this phase.
// ---------------------------------------------------------------------------

app.use("/webhooks", createWebhookRoutes(webhookController));

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------------------

app.use(errorHandler);

export default app;
