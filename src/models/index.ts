export type { Provider, RepositoryRef } from "./RepositoryRef.js";
export type { WebhookEvent, WebhookEventBase, WebhookEventType } from "./WebhookEvent.js";
export type {
    PullRequestEvent,
    PullRequestAction,
    PullRequestState,
    PullRequestActor,
} from "./PullRequestEvent.js";

import type { WebhookEvent } from "./WebhookEvent.js";
import type { PullRequestEvent } from "./PullRequestEvent.js";

/**
 * Type guard for narrowing a WebhookEvent to a PullRequestEvent. Trivial
 * today (it's the only member of the union) but keeps call sites written
 * the way they'll still need to be written once push/branch/issue events
 * are added, rather than relying on callers to know the union has only
 * one member right now.
 */
export function isPullRequestEvent(event: WebhookEvent): event is PullRequestEvent {
    return event.eventType === "pull_request";
}
