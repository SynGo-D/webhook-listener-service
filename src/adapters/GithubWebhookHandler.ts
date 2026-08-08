import type { IncomingHttpHeaders } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import type { WebhookEvent } from "../models/WebhookEvent.js";
import { WebhookValidationError } from "../errors/WebhookValidationError.js";
import { AppError } from "../errors/AppError.js";
import { env } from "../config/env.js";

const SIGNATURE_PREFIX = "sha256=";

/**
 * GitHub implementation of the ProviderWebhookHandler contract.
 *
 * Event types we currently support: `pull_request`. GitHub sends its
 * event type in the `X-GitHub-Event` header (not in the payload body),
 * and a per-delivery UUID in `X-GitHub-Delivery` — both are cheap header
 * reads, so they're implemented now rather than stubbed.
 */
export class GithubWebhookHandler implements ProviderWebhookHandler {

    public readonly provider = "github" as const;

    /**
     * Recomputes the HMAC-SHA256 over the exact raw body bytes (see
     * app.ts's express.json({ verify }) hook) and compares it to the
     * `X-Hub-Signature-256` header using a constant-time comparison — a
     * plain `===` here would leak how many leading bytes matched through
     * timing, which is exactly the kind of side channel HMAC signatures
     * exist to close.
     */
    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
        if (!env.GITHUB_WEBHOOK_SECRET) {
            // Misconfiguration, not an invalid request — fail loudly (500)
            // rather than silently rejecting every legitimate delivery.
            throw new AppError("GITHUB_WEBHOOK_SECRET is not configured.", 500);
        }

        const signatureHeader = headers["x-hub-signature-256"];
        if (!signatureHeader || typeof signatureHeader !== "string") {
            return false;
        }

        const expectedSignature =
            SIGNATURE_PREFIX +
            createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex");

        const expected = Buffer.from(expectedSignature, "utf8");
        const actual   = Buffer.from(signatureHeader, "utf8");

        // timingSafeEqual throws on length mismatch rather than returning
        // false — guard explicitly so a differently-sized header fails
        // closed instead of crashing the request.
        if (expected.length !== actual.length) {
            return false;
        }

        return timingSafeEqual(expected, actual);
    }

    supportsEvent(headers: IncomingHttpHeaders): boolean {
        return headers["x-github-event"] === "pull_request";
    }

    extractDeliveryId(headers: IncomingHttpHeaders, _payload: unknown): string {
        const deliveryId = headers["x-github-delivery"];

        if (!deliveryId || typeof deliveryId !== "string") {
            throw new WebhookValidationError(
                "GitHub webhook request is missing the X-GitHub-Delivery header."
            );
        }

        return deliveryId;
    }

    normalize(_headers: IncomingHttpHeaders, _payload: unknown): WebhookEvent {
        throw new Error(
            "GithubWebhookHandler.normalize is implemented in Phase 6 (event normalization)."
        );
    }
}
