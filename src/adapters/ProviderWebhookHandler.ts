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
     * Verifies the request actually came from this provider (GitHub
     * HMAC-SHA256 over the raw body / GitLab secret-token header). Must be
     * called — and must pass — before the payload is parsed or normalized.
     * Implemented in Phase 4.
     */
    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders): boolean;

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
     * shape. Implemented in Phase 6.
     */
    normalize(headers: IncomingHttpHeaders, payload: unknown): WebhookEvent;
}
