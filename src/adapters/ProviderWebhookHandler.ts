import type { IncomingHttpHeaders } from "node:http";
import type { Provider } from "../models/RepositoryRef.js";
import type { WebhookEvent } from "../models/WebhookEvent.js";

/**
 * Adapter contract every supported provider must implement. The webhook
 * controller (Phase 5) only ever talks to this interface — provider-
 * specific header names, payload shapes, and signature schemes never leak
 * outside the adapter that owns them.
 */
export interface ProviderWebhookHandler {

    readonly provider: Provider;

    /**
     * The repository this payload *claims* to be for (`owner/name`, or
     * `group/sub/name` on GitLab), or null if it doesn't say.
     *
     * Read before verification, because it decides which secrets to verify
     * against — each integration has its own. That is safe only because
     * nothing is trusted on the strength of it: a payload naming someone
     * else's repository must then be signed with *that* repository's
     * secret, which the sender doesn't have. It must stay a pure read of
     * the parsed body — no side effects, no normalization.
     */
    extractRepositoryFullName(payload: unknown): string | null;

    /**
     * Verifies the request actually came from this provider (GitHub
     * HMAC-SHA256 over the raw body / GitLab secret-token header), against
     * any of `secrets`. More than one is legitimate: two users connecting
     * the same repository register two hooks with two secrets. An empty
     * list must return false. Must pass before anything is written or
     * published.
     */
    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders, secrets: readonly string[]): boolean;

    /**
     * True if this request's event type is one we currently normalize
     * (e.g. GitHub `pull_request`, GitLab `Merge Request Hook`). Lets the
     * controller acknowledge-and-drop event types we don't support yet
     * (push, issues, ...) instead of erroring on them.
     */
    supportsEvent(headers: IncomingHttpHeaders): boolean;

    /**
     * Extracts a stable per-delivery identifier used for idempotency
     * (Phase 7) — the same webhook delivery must always yield the same ID
     * so a retry/redelivery from the provider doesn't trigger duplicate
     * downstream processing.
     */
    extractDeliveryId(headers: IncomingHttpHeaders, payload: unknown): string;

    /**
     * Converts this provider's raw payload into the internal WebhookEvent
     * shape. `deliveryId` is passed in rather than recomputed — the caller
     * (WebhookIngestionService) has already called `extractDeliveryId`
     * before this, and GitLab's version isn't free (it hashes payload
     * fields), so recomputing it here would be pure waste.
     * Implemented in Phase 6.
     */
    normalize(headers: IncomingHttpHeaders, payload: unknown, deliveryId: string): WebhookEvent;
}
