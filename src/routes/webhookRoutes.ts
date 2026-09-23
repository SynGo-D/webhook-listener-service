// src/routes/webhookRoutes.ts

import { Router } from "express";
import { WebhookController } from "../controllers/WebhookController.js";

/**
 * Mounts the webhook ingestion route.
 *
 * POST /webhooks/:provider   e.g. /webhooks/github, /webhooks/gitlab
 *
 * A single parameterized route rather than two separate ones — the
 * controller reads `:provider` and the factory (Phase 3) resolves it to
 * the right adapter. Matches the pattern used for integration-service's
 * OAuth callback route.
 */
export function createWebhookRoutes(controller: WebhookController): Router {
    const router = Router();

    router.post("/:provider", (req, res) => controller.handle(req, res));

    return router;
}
