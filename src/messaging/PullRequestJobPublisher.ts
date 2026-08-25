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
interface PRJob {
    repository: string;
    cloneUrl:   string;
    commit:     string;
    branch:     string;
    prNumber:   number;
    provider:   "github" | "gitlab";
    timestamp:  string;
}

/**
 * Publishes a normalized PullRequestEvent as a PRJob message.
 */
export class PullRequestJobPublisher {

    async publish(event: PullRequestEvent): Promise<void> {
        const job = this.toPRJob(event);
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

    /**
     * Maps our richer internal event onto PRJob's narrower shape.
     * `cloneUrl` isn't part of our domain model — derived from the web URL
     * by appending ".git", which is a valid HTTPS clone URL for both
     * GitHub and GitLab repositories.
     */
    private toPRJob(event: PullRequestEvent): PRJob {
        return {
            repository: event.repository.fullName,
            cloneUrl:   `${event.repository.url}.git`,
            commit:     event.commitSha ?? "",
            branch:     event.sourceBranch,
            prNumber:   Number(event.pullRequestId),
            provider:   event.provider,
            timestamp:  event.receivedAt,
        };
    }
}
