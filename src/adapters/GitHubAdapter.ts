import { createHmac, timingSafeEqual } from "crypto";
import { IncomingHttpHeaders } from "http";
import { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { env } from "../config/env.js";

/**
 * Handles GitHub webhook deliveries — HMAC-SHA256 signature verification
 * and payload normalization. Normalization is still stubbed out; that
 * lands in Phase 6.
 */
export class GitHubAdapter implements ProviderWebhookHandler {
    /**
     * GitHub signs the raw request body with HMAC-SHA256 using the
     * configured webhook secret, and sends the hex digest in the
     * X-Hub-Signature-256 header as "sha256=<hexdigest>". We recompute
     * the same HMAC over rawBody and compare it to what was sent.
     *
     * Comparison uses timingSafeEqual rather than === so a mismatch can't
     * be used to guess the secret one byte at a time via response timing.
     * timingSafeEqual throws on a length mismatch, so lengths are checked
     * first rather than letting that exception itself leak information.
     */
    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
        const signatureHeader = headers["x-hub-signature-256"];
        if (typeof signatureHeader !== "string") {
            return false;
        }

        const expectedSignature =
            "sha256=" + createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex");

        const received = Buffer.from(signatureHeader);
        const expected = Buffer.from(expectedSignature);

        if (received.length !== expected.length) {
            return false;
        }

        return timingSafeEqual(received, expected);
    }

    normalize(_payload: unknown, _headers: IncomingHttpHeaders): WebhookEvent {
        throw new Error("Not implemented — GitHub payload normalization lands in Phase 6.");
    }
}
