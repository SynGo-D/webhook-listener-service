// src/app.ts

import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { isRabbitMQConnected } from "./config/rabbitmq.js";
import { pool } from "./config/database.js";

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
// Route mounting
//
// Webhook ingestion routes (POST /webhooks/github, POST /webhooks/gitlab)
// are added once the controller/provider-handler layers exist — see
// src/controllers/README.md and src/adapters/README.md for the plan.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------------------

app.use(errorHandler);

export default app;
