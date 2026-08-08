import type { IncomingHttpHeaders } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import type { WebhookEvent } from "../models/WebhookEvent.js";
import { AppError } from "../errors/AppError.js";
import { env } from "../config/env.js";

/**
 * GitLab implementation of the ProviderWebhookHandler contract.
 *
 * Event types we currently support: `Merge Request Hook`. GitLab sends its
 * event type in the `X-Gitlab-Event` header, so `supportsEvent` is a cheap
 * header read implemented now, same as GitHub's.
 *
 * Unlike GitHub, GitLab does not reliably send a per-delivery UUID header
 * across all versions/self-managed instances — a real delivery-ID needs to
 * be derived from stable Merge Request payload fields (project ID +
 * merge-request IID + updated_at). That requires the real GitLab MR
 * payload shape, so it's implemented alongside normalization in Phase 6
 * rather than guessed at here.
 */
export class GitlabWebhookHandler implements ProviderWebhookHandler {

    public readonly provider = "gitlab" as const;

    /**
     * GitLab's mechanism is a static secret token (`X-Gitlab-Token`), not
     * an HMAC over the body — unlike GitHub, this only authenticates that
     * the sender knows the secret; it does not cryptographically cover the
     * payload, so a compromised network intermediary could in principle
     * tamper with the body without invalidating the token. That's a
     * platform limitation, not something this service can strengthen —
     * GitLab does not offer an HMAC-based alternative for webhooks.
     *
     * Still compared with a constant-time check, for the same timing-leak
     * reason as GitHub's signature comparison.
     */
    verifySignature(_rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
        if (!env.GITLAB_WEBHOOK_SECRET) {
            throw new AppError("GITLAB_WEBHOOK_SECRET is not configured.", 500);
        }

        const token = headers["x-gitlab-token"];
        if (!token || typeof token !== "string") {
            return false;
        }

        const expected = Buffer.from(env.GITLAB_WEBHOOK_SECRET, "utf8");
        const actual   = Buffer.from(token, "utf8");

        if (expected.length !== actual.length) {
            return false;
        }

        return timingSafeEqual(expected, actual);
    }

    supportsEvent(headers: IncomingHttpHeaders): boolean {
        return headers["x-gitlab-event"] === "Merge Request Hook";
    }

    extractDeliveryId(_headers: IncomingHttpHeaders, _payload: unknown): string {
        throw new Error(
            "GitlabWebhookHandler.extractDeliveryId is implemented in Phase 6, alongside normalization " +
            "(it needs the real Merge Request payload shape to derive a stable fingerprint)."
        );
    }

    normalize(_headers: IncomingHttpHeaders, _payload: unknown): WebhookEvent {
        throw new Error(
            "GitlabWebhookHandler.normalize is implemented in Phase 6 (event normalization)."
        );
    }
}
