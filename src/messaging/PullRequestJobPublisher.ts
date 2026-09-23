import { getRabbitMQChannel } from "../config/rabbitmq.js";
import { EXCHANGE_NAME, buildPullRequestRoutingKey } from "./topology.js";
import { withRetry } from "./retry.js";
import type { PullRequestEvent } from "../models/PullRequestEvent.js";

const PUBLISH_RETRY_OPTIONS = { attempts: 3, baseDelayMs: 200 };

/**
 * Mirrors SynGo-D/RabbitMQ's `src/rabbitmq/types.ts` PRJob interface
 * exactly. No shared-types package exists between the two repos, so this
 * has to be kept in sync by hand — worth turning into a real shared
 * package (e.g. published as @syngo-d/contracts) rather than two
 * hand-maintained copies drifting apart over time.
 *
 * Known gap, not something this service can fix unilaterally: PRJob has
 * no field for our deliveryId, so whatever consumes pr_queue has no way
 * to do its own idempotency check — it's entirely dependent on this
 * service's Phase 7 dedup never letting a duplicate through.
 */
export interface PRJob {
    repository: string;
    cloneUrl:   string;
    commit:     string;
    branch:     string;
    prNumber:   number;
    provider:   "github" | "gitlab";
    timestamp:  string;

    // Added for analysis-engine's AI review, which reviews the PR's diff
    // against the branch it targets and needs the author's stated intent.
    // Optional, so consumers that predate them keep working.
    targetBranch?: string;
    title?:        string;
    description?:  string;

    // Who opened the pull request. The webhook has always carried this
    // and the normalized event has always kept it; it stopped here, so
    // every analysis downstream was unattributable and no per-contributor
    // view of the work was possible.
    //
    // Optional for the same reason as the fields above, and because the
    // provider genuinely omits it for a deleted account.
    author?: {
        providerUserId: string;
        username:       string;
    };
}

/**
 * PR descriptions can be arbitrarily long (checklists, pasted logs). The
 * reviewer only needs the gist, and every character here is paid for in
 * LLM tokens downstream.
 */
export const MAX_DESCRIPTION_LENGTH = 4_000;

/**
 * Publishes a normalized PullRequestEvent as a PRJob message.
 */
export class PullRequestJobPublisher {

    async publish(event: PullRequestEvent): Promise<void> {
        const job = toPRJob(event);
        const routingKey = buildPullRequestRoutingKey(event.provider, event.action);

        // Retries smooth over brief broker blips. If every attempt fails,
        // this throws and the caller (WebhookIngestionService) rolls back
        // the dedup mark and returns a 500 — the provider's own webhook
        // redelivery becomes the backstop for anything that outlasts these
        // retries, and won't be blocked by dedup since the mark was rolled
        // back.
        await withRetry(() => this.publishOnce(job, routingKey), PUBLISH_RETRY_OPTIONS);
    }

    /**
     * A single publish attempt via the confirm channel — resolves only on
     * the broker's ack, rejects on nack or channel-level error. This is
     * what a plain (non-confirm) channel's `publish()` cannot give you:
     * local buffering success looks identical to a message the broker
     * never actually received if the connection drops right after the
     * call returns.
     */
    private publishOnce(job: PRJob, routingKey: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const channel = getRabbitMQChannel();

            channel.publish(
                EXCHANGE_NAME,
                routingKey,
                Buffer.from(JSON.stringify(job)),
                { persistent: true },
                (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }
}

/**
 * Maps our richer internal event onto PRJob's narrower shape.
 * `cloneUrl` isn't part of our domain model — derived from the web URL
 * by appending ".git", which is a valid HTTPS clone URL for both
 * GitHub and GitLab repositories.
 */
export function toPRJob(event: PullRequestEvent): PRJob {
    return {
        repository: event.repository.fullName,
        cloneUrl:   `${event.repository.url}.git`,
        commit:     event.commitSha ?? "",
        branch:     event.sourceBranch,
        prNumber:   Number(event.pullRequestId),
        provider:   event.provider,
        timestamp:  event.receivedAt,

        targetBranch: event.targetBranch,
        title:        event.title,
        description:  event.description?.slice(0, MAX_DESCRIPTION_LENGTH),
        author:       event.author,
    };
}
