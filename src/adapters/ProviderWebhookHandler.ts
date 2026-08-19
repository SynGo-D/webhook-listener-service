import { IncomingHttpHeaders } from "http";
import { WebhookEvent } from "../models/WebhookEvent.js";

/**
 * The contract every provider specific adapter must satisfy (Adapter
 * Pattern). Keeping this interface separate from GitHubAdapter/GitLabAdapter
 * is what lets the factory and everything above it depend on "some
 * adapter" instead of a specific provider's implementation.
 */
export interface ProviderWebhookHandler {
    /**
     * Proves a request actually came from this provider. Must run against
     * the exact raw bytes captured by app.ts's express.json({ verify })
     * hook — a parsed-and-re-serialized body is not guaranteed to match
     * what the provider actually signed.
     */
    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders): boolean;

    /**
     * Converts this provider's payload shape into the service's internal
     * WebhookEvent representation.
     */
    normalize(payload: unknown, headers: IncomingHttpHeaders): WebhookEvent;
}
