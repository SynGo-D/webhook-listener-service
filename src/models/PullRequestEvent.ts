import { WebhookEvent } from "./WebhookEvent.js";

/**
 * The normalized lifecycle action for a pull request / merge request.
 *
 * GitHub and GitLab use different words for the same thing (e.g. GitHub's
 * "synchronize" vs. GitLab's "update" when new commits are pushed) — the
 * adapter that builds a PullRequestEvent maps its provider's action name
 * into one of these.
 */
export type PullRequestAction = "opened" | "synchronize" | "closed" | "reopened";

/**
 * The common representation both a GitHub `pull_request` event and a
 * GitLab Merge Request event get normalized into. This is what the
 * service layer eventually publishes to RabbitMQ for a PR/MR change.
 */
export interface PullRequestEvent extends WebhookEvent {
    eventType: "pull_request";
    action: PullRequestAction;

    number: number;
    title: string;
    sourceBranch: string;
    targetBranch: string;
    headSha: string;
    authorUsername: string;
    url: string;
}
