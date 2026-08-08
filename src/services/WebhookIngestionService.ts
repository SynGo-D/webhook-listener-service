import type { IncomingHttpHeaders } from "node:http";
import { ProviderHandlerFactory } from "../factories/ProviderHandlerFactory.js";
import { InvalidSignatureError } from "../errors/InvalidSignatureError.js";

export type WebhookIngestResult =
    | { outcome: "accepted"; deliveryId: string }
    | { outcome: "ignored"; reason: string };

/**
 * Orchestrates the webhook ingestion pipeline:
 *
 *   verify signature → check event is supported → extract delivery ID
 *     → [Phase 7: deduplicate] → normalize → [Phase 8: publish]
 *
 * This is the only place that pipeline order is encoded — the controller
 * just calls `ingest()` and turns the result into an HTTP response.
 *
 * Signature verification runs strictly first: checking anything about the
 * payload or event type before proving the request came from the provider
 * it claims to would let an unauthenticated caller probe this service's
 * behavior without ever passing verification.
 */
export class WebhookIngestionService {

    async ingest(
        provider: string,
        rawBody:  Buffer,
        headers:  IncomingHttpHeaders,
        payload:  unknown
    ): Promise<WebhookIngestResult> {

        const handler = ProviderHandlerFactory.create(provider);

        const signatureValid = handler.verifySignature(rawBody, headers);
        if (!signatureValid) {
            throw new InvalidSignatureError();
        }

        if (!handler.supportsEvent(headers)) {
            return {
                outcome: "ignored",
                reason:  "Event type is not one this service currently processes.",
            };
        }

        const deliveryId = handler.extractDeliveryId(headers, payload);

        // Phase 7: check `deliveryId` against processed-event storage here
        // and short-circuit with { outcome: "ignored", reason: "duplicate" }
        // if it's already been handled — before doing the normalization
        // work below.

        const event = handler.normalize(headers, payload);

        // Phase 8: publish `event` to RabbitMQ here, then record
        // `deliveryId` as processed (Phase 7) so a provider redelivery of
        // the same webhook doesn't publish it a second time.
        void event;

        return { outcome: "accepted", deliveryId };
    }
}
