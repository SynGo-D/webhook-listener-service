import type { IncomingHttpHeaders } from "node:http";
import { ProviderHandlerFactory } from "../factories/ProviderHandlerFactory.js";
import { ProcessedWebhookEventRepository } from "../repositories/ProcessedWebhookEventRepository.js";
import { PullRequestJobPublisher } from "../messaging/PullRequestJobPublisher.js";
import { InvalidSignatureError } from "../errors/InvalidSignatureError.js";
import { WebhookSecretClient } from "../clients/WebhookSecretClient.js";
import { env } from "../config/env.js";
import type { Provider } from "../models/RepositoryRef.js";

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
 *   identify claimed repository → look up its secrets → verify signature
 *     → check event is supported → extract delivery ID → deduplicate
 *     → normalize → publish
 *
 * This is the only place that pipeline order is encoded — the controller
 * just calls `ingest()` and turns the result into an HTTP response.
 *
 * Nothing is written, published, or revealed before the signature verifies.
 * The only step ahead of it is a read-only lookup of the secrets for the
 * repository the payload names — unavoidable now that each integration has
 * its own secret — and every failure before or at verification returns the
 * same 401, so an unauthenticated caller learns nothing from the response.
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
    private readonly publisher:                PullRequestJobPublisher;
    private readonly secretClient:             Pick<WebhookSecretClient, "getSecrets">;
    private readonly legacySecrets:            Record<Provider, string>;

    constructor(
        processedEventRepository?: ProcessedWebhookEventRepository,
        publisher?:                PullRequestJobPublisher,
        secretClient?:             Pick<WebhookSecretClient, "getSecrets">,
        legacySecrets?:            Record<Provider, string>
    ) {
        this.processedEventRepository = processedEventRepository ?? new ProcessedWebhookEventRepository();
        this.publisher                = publisher ?? new PullRequestJobPublisher();
        this.secretClient             = secretClient ?? new WebhookSecretClient();
        this.legacySecrets            = legacySecrets ?? {
            github: env.GITHUB_WEBHOOK_SECRET,
            gitlab: env.GITLAB_WEBHOOK_SECRET,
        };
    }

    async ingest(
        provider: string,
        rawBody:  Buffer,
        headers:  IncomingHttpHeaders,
        payload:  unknown
    ): Promise<WebhookIngestResult> {

        const handler = ProviderHandlerFactory.create(provider);

        // Which repository does this delivery claim to be for? That decides
        // which secrets can verify it. A payload that names none can't be
        // verified at all, and is rejected exactly like a bad signature — a
        // distinct response would tell a prober something.
        const repositoryFullName = handler.extractRepositoryFullName(payload);
        if (!repositoryFullName) {
            throw new InvalidSignatureError();
        }

        // Read-only lookup, before verification. This is the one thing an
        // unauthenticated request can cause; it writes nothing, publishes
        // nothing, and is bounded by the rate limiters and the lookup cache.
        const { secrets, legacy } = await this.secretClient.getSecrets(handler.provider, repositoryFullName);

        // The old shared secret is only a candidate for repositories whose
        // integration predates per-integration secrets — never for anything
        // connected since, so leaking it can't forge deliveries for them.
        const legacySecret = this.legacySecrets[handler.provider];
        const candidates = legacy && legacySecret ? [...secrets, legacySecret] : secrets;

        // An unconnected repository has no candidates and fails here: this
        // is the allowlist. Same 401 as a wrong signature, deliberately, so
        // the response doesn't reveal which repositories are connected.
        if (!handler.verifySignature(rawBody, headers, candidates)) {
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
            await this.publisher.publish(event);

            return { outcome: "accepted", deliveryId };

        } catch (error) {
            await this.processedEventRepository.unmarkProcessed(handler.provider, deliveryId);
            throw error;
        }
    }
}
