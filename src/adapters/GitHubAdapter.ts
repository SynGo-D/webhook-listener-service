import { IncomingHttpHeaders } from "http";
import { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import { WebhookEvent } from "../models/WebhookEvent.js";

/**
 * Handles GitHub webhook deliveries — HMAC-SHA256 signature verification
 * and payload normalization. Both are stubbed out here; this phase only
 * wires the class into the ProviderWebhookHandler contract and the
 * factory, so the pipeline shape exists before the provider-specific
 * logic does.
 */
export class GitHubAdapter implements ProviderWebhookHandler {
    verifySignature(_rawBody: Buffer, _headers: IncomingHttpHeaders): boolean {
        throw new Error("Not implemented — GitHub signature verification lands in Phase 4.");
    }

    normalize(_payload: unknown, _headers: IncomingHttpHeaders): WebhookEvent {
        throw new Error("Not implemented — GitHub payload normalization lands in Phase 6.");
    }
}
