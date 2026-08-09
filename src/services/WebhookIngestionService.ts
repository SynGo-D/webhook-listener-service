import type { IncomingHttpHeaders } from "node:http";
import { ProviderHandlerFactory } from "../factories/ProviderHandlerFactory.js";
import { ProcessedWebhookEventRepository } from "../repositories/ProcessedWebhookEventRepository.js";
import { InvalidSignatureError } from "../errors/InvalidSignatureError.js";

export type WebhookIngestResult =
    | { outcome: "accepted"; deliveryId: string }
    | { outcome: "ignored"; reason: string };

// Only supported event type right now — see adapters/README.md. This will
// need to come from the handler itself once a second event type exists;
// hardcoding it here for one type isn't worth an abstraction yet.
const CURRENT_EVENT_TYPE = "pull_request";

/**
 * Orchestrates the webhook ingestion pipeline:
 *
 *   verify signature → check event is supported → extract delivery ID
 *     → deduplicate → normalize → [Phase 8: publish]
 *
 * This is the only place that pipeline order is encoded — the controller
 * just calls `ingest()` and turns the result into an HTTP response.
 *
 * Signature verification runs strictly first: checking anything about the
 * payload or event type before proving the request came from the provider
 * it claims to would let an unauthenticated caller probe this service's
 * behavior without ever passing verification.
 *
 * Deduplication marks a delivery processed *before* normalizing/publishing
 * (that's what makes it safe under concurrent redelivery — see
 * ProcessedWebhookEventRepository), but if anything after that mark fails,
 * the mark is rolled back. Without the rollback, a normalize or publish
 * failure would leave the delivery permanently marked "processed" despite
 * never being published — silently losing it, since a provider redelivery
 * would then be rejected as a duplicate forever. This does still leave one
 * narrow, accepted gap: a hard process crash between the mark and the
 * rollback (not a caught exception, an actual crash) would leave a
 * processed-but-never-published row with no automatic recovery. Closing
 * that fully would mean a transactional outbox pattern, which is more
 * machinery than a first version needs — noting it here rather than
 * quietly ignoring it.
 */
export class WebhookIngestionService {

    private readonly processedEventRepository: ProcessedWebhookEventRepository;

    constructor(processedEventRepository?: ProcessedWebhookEventRepository) {
        this.processedEventRepository = processedEventRepository ?? new ProcessedWebhookEventRepository();
    }

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

        const isNewDelivery = await this.processedEventRepository.tryMarkProcessed(
            handler.provider,
            deliveryId,
            CURRENT_EVENT_TYPE
        );

        if (!isNewDelivery) {
            return {
                outcome: "ignored",
                reason:  "Duplicate delivery — already processed.",
            };
        }

        try {
            const event = handler.normalize(headers, payload, deliveryId);

            // Phase 8: publish `event` to RabbitMQ here — inside this try
            // block, so a publish failure also triggers the rollback below.
            void event;

            return { outcome: "accepted", deliveryId };

        } catch (error) {
            await this.processedEventRepository.unmarkProcessed(handler.provider, deliveryId);
            throw error;
        }
    }
}
