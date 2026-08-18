import { Provider } from "./Provider.js";

/**
 * Identifies the repository a webhook event belongs to.
 *
 * GitHub calls this field "full_name" (e.g. "octocat/Hello-World") and
 * GitLab calls it "path_with_namespace" — adapters are responsible for
 * mapping their provider's field into this one shared shape.
 */
export interface RepositoryIdentity {
    fullName: string;
    cloneUrl: string;
    defaultBranch: string;
}

/**
 * The generic envelope every normalized webhook event shares, regardless
 * of provider or event type. Downstream consumers (RabbitMQ, and
 * ultimately the Analysis/Orchestration service) only ever see this shape
 * — or something that extends it — never a raw GitHub/GitLab payload.
 *
 * `eventType` is a discriminant: concrete event shapes (PullRequestEvent,
 * and future ones like PushEvent) narrow it to a literal string, so code
 * consuming a WebhookEvent can switch on `eventType` and get full type
 * safety without a manual type assertion.
 */
export interface WebhookEvent {
    provider: Provider;
    eventType: string;

    /**
     * The value this service's idempotency check (Phase 7) keys off.
     * GitHub supplies one directly via the X-GitHub-Delivery header;
     * GitLab does not always send an equivalent, so the adapter that
     * produces this field may need to derive one rather than copy a
     * header verbatim.
     */
    deliveryId: string;

    repository: RepositoryIdentity;

    /**
     * When THIS service processed the event — not a timestamp taken from
     * the provider's payload, whose format and meaning varies by provider.
     */
    receivedAt: string;

    /**
     * Optional pointer back to the raw payload this event was normalized
     * from (e.g. a storage key), for debugging. Deliberately not the raw
     * payload itself — that would reintroduce provider-specific shape
     * into a message meant to be provider-agnostic.
     */
    rawPayloadRef?: string;
}
