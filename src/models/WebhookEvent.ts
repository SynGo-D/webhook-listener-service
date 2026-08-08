import type { Provider, RepositoryRef } from "./RepositoryRef.js";
import type { PullRequestEvent } from "./PullRequestEvent.js";

export type WebhookEventType = "pull_request";
// Future: "push" | "branch" | "issue" | "deployment" | "repository"
// Add the new literal here and a new event interface in this folder —
// nothing outside models/ needs to change to support it structurally.

/**
 * Fields every normalized event carries, regardless of provider or event
 * type. `deliveryId` is the provider's unique ID for this specific webhook
 * delivery (GitHub: `X-GitHub-Delivery` header; GitLab: no dedicated
 * header, so the adapter derives an equivalent from the payload — see
 * adapters/README.md) — this is the value idempotency/dedup (Phase 7) is
 * keyed on.
 */
export interface WebhookEventBase {
    provider:   Provider;
    eventType:  WebhookEventType;
    deliveryId: string;
    repository: RepositoryRef;
    /** When the Webhook Listener received this event (not when the provider's action occurred). */
    receivedAt: string;
}

/**
 * The internal event union. Every concrete event type (currently only
 * PullRequestEvent) extends WebhookEventBase and narrows `eventType` to
 * its own literal, so consumers can discriminate on `eventType` with full
 * type narrowing.
 */
export type WebhookEvent = PullRequestEvent;
