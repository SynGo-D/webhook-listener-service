import { timingSafeEqual } from "crypto";
import { IncomingHttpHeaders } from "http";
import { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { env } from "../config/env.js";

/**
 * Handles GitLab webhook deliveries — secret-token verification and
 * payload normalization. Normalization is still stubbed out; that lands
 * in Phase 6.
 */
export class GitLabAdapter implements ProviderWebhookHandler {
    /**
     * GitLab doesn't sign anything — it just echoes the secret token you
     * configured back in the X-Gitlab-Token header. Verification is a
     * direct comparison, so rawBody isn't used here at all (unlike
     * GitHub's HMAC scheme).
     *
     * Still uses timingSafeEqual rather than === for the same reason as
     * GitHubAdapter: a naive string comparison leaks timing information
     * an attacker could use to guess the secret.
     */
    verifySignature(_rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
        const token = headers["x-gitlab-token"];
        if (typeof token !== "string") {
            return false;
        }

        const received = Buffer.from(token);
        const expected = Buffer.from(env.GITLAB_WEBHOOK_SECRET);

        if (received.length !== expected.length) {
            return false;
        }

        return timingSafeEqual(received, expected);
    }

    normalize(_payload: unknown, _headers: IncomingHttpHeaders): WebhookEvent {
        throw new Error("Not implemented — GitLab payload normalization lands in Phase 6.");
    }
}
