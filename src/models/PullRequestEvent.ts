import type { WebhookEventBase } from "./WebhookEvent.js";

/**
 * Normalized action, mapped from GitHub's top-level `action` field and
 * GitLab's `object_attributes.action`. "unknown" is a deliberate fallback:
 * an action we haven't explicitly mapped yet is not a malformed or invalid
 * payload — it should still normalize and publish rather than being
 * rejected, so the pipeline doesn't silently drop legitimate provider
 * events just because their action string is new to us.
 */
export type PullRequestAction =
    | "opened"
    | "reopened"
    | "synchronize" // new commits pushed to an open PR/MR
    | "edited"
    | "closed"
    | "merged"
    | "unknown";

export type PullRequestState = "open" | "closed" | "merged";

export interface PullRequestActor {
    providerUserId: string;
    username:       string;
}

export interface PullRequestEvent extends WebhookEventBase {
    eventType: "pull_request";

    /** Per-repo PR/MR number — GitHub `number` / GitLab `iid` (the ID used in URLs, not the global cross-instance ID). */
    pullRequestId: string;

    action: PullRequestAction;
    state:  PullRequestState;

    title:        string;
    sourceBranch: string;
    targetBranch: string;

    /** Head commit SHA, when the provider's payload includes one for this action. */
    commitSha?: string;

    author?: PullRequestActor;

    /** Web URL to the PR/MR itself (not the API URL). */
    url: string;

    /** Timestamps of the PR/MR itself, as reported by the provider — not this event's receivedAt. */
    createdAt: string;
    updatedAt: string;
}
