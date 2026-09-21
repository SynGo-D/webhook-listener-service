import type { IncomingHttpHeaders } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import type { WebhookEvent } from "../models/WebhookEvent.js";
import type { PullRequestAction, PullRequestState } from "../models/PullRequestEvent.js";
import { WebhookValidationError } from "../errors/WebhookValidationError.js";
import { requireFields } from "./requireFields.js";

/** Every path `normalize()` and `extractDeliveryId()` read — see parsePayload. */
const GITLAB_REQUIRED_FIELDS = [
    "object_attributes.iid",
    "object_attributes.action",
    "object_attributes.state",
    "object_attributes.title",
    "object_attributes.source_branch",
    "object_attributes.target_branch",
    "object_attributes.url",
    "object_attributes.created_at",
    "object_attributes.updated_at",
    "project.id",
    "project.path_with_namespace",
    "project.namespace",
    "project.web_url",
] as const;

/** Only the fields this service actually reads from GitLab's Merge Request Hook webhook payload. */
interface GitlabMergeRequestPayload {
    user: { id: number; username: string } | null;
    project: {
        id:                  number;
        path_with_namespace: string;
        namespace:           string;
        web_url:             string;
    };
    object_attributes: {
        iid:           number;
        title:         string;
        description?:  string | null;
        state:         "opened" | "closed" | "merged" | "locked";
        action:        string;
        url:           string;
        source_branch: string;
        target_branch: string;
        created_at:    string;
        updated_at:    string;
        last_commit?:  { id: string };
    };
}

/**
 * GitLab implementation of the ProviderWebhookHandler contract.
 *
 * Event types we currently support: `Merge Request Hook`. GitLab sends its
 * event type in the `X-Gitlab-Event` header, so `supportsEvent` is a cheap
 * header read implemented now, same as GitHub's.
 *
 * Delivery IDs come from GitLab's `Idempotency-Key` header where present,
 * falling back to a payload fingerprint on older GitLab — see
 * extractDeliveryId.
 */
export class GitlabWebhookHandler implements ProviderWebhookHandler {

    public readonly provider = "gitlab" as const;

    extractRepositoryFullName(payload: unknown): string | null {
        const fullName = (payload as { project?: { path_with_namespace?: unknown } } | null)
            ?.project?.path_with_namespace;
        return typeof fullName === "string" && fullName.length > 0 ? fullName : null;
    }

    /**
     * GitLab's mechanism is a static secret token (`X-Gitlab-Token`), not
     * an HMAC over the body — unlike GitHub, this only authenticates that
     * the sender knows the secret; it does not cryptographically cover the
     * payload, so a compromised network intermediary could in principle
     * tamper with the body without invalidating the token.
     *
     * GitLab 19.0 added HMAC signing (`webhook-signature`, Standard
     * Webhooks) when a signing token is configured on the hook. Adopting it
     * means integration-service setting that token at registration and this
     * method verifying it — a worthwhile follow-up, not yet done.
     *
     * Still compared with a constant-time check, for the same timing-leak
     * reason as GitHub's signature comparison.
     */
    verifySignature(_rawBody: Buffer, headers: IncomingHttpHeaders, secrets: readonly string[]): boolean {
        const token = headers["x-gitlab-token"];
        if (!token || typeof token !== "string") {
            return false;
        }

        const actual = Buffer.from(token, "utf8");

        // All candidates checked regardless of an early match — see
        // GithubWebhookHandler.verifySignature.
        let matched = false;
        for (const secret of secrets) {
            const expected = Buffer.from(secret, "utf8");
            const equal = expected.length === actual.length && timingSafeEqual(expected, actual);
            matched = equal || matched;
        }
        return matched;
    }

    supportsEvent(headers: IncomingHttpHeaders): boolean {
        return headers["x-gitlab-event"] === "Merge Request Hook";
    }

    /**
     * GitLab's per-delivery ID, most reliable source first:
     *
     *   1. `Idempotency-Key` (GitLab 17.4+) — documented as unique per
     *      delivery and stable across retries. Exactly a dedup key.
     *   2. `webhook-id` (GitLab 19.0+, Standard Webhooks) — same guarantees.
     *   3. A fingerprint of (project ID, MR IID, updated_at), for older and
     *      self-managed GitLab that sends neither.
     *
     * The fingerprint is a fallback, not the primary, because it can merge
     * two genuinely different events: two changes to one merge request
     * inside the same `updated_at` second produce the same ID, and the
     * second is silently dropped as a "duplicate". The headers can't.
     *
     * `X-Gitlab-Event-UUID` is deliberately not used: GitLab documents it
     * as shared across a chain of recursive webhooks, so it isn't unique
     * per delivery.
     *
     * Header-derived IDs are prefixed so they can never collide with a
     * fingerprint (a raw SHA-256 hex string) in the dedup table.
     */
    extractDeliveryId(headers: IncomingHttpHeaders, payload: unknown): string {
        const idempotencyKey = headers["idempotency-key"];
        if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
            return `idem:${idempotencyKey}`;
        }

        const webhookId = headers["webhook-id"];
        if (typeof webhookId === "string" && webhookId.length > 0) {
            return `whid:${webhookId}`;
        }

        const body = this.parsePayload(payload);
        const fingerprint = `${body.project.id}:${body.object_attributes.iid}:${body.object_attributes.updated_at}`;
        return createHash("sha256").update(fingerprint).digest("hex");
    }

    normalize(_headers: IncomingHttpHeaders, payload: unknown, deliveryId: string): WebhookEvent {
        const body = this.parsePayload(payload);
        const attrs = body.object_attributes;

        return {
            provider:   "gitlab",
            eventType:  "pull_request",
            deliveryId,
            receivedAt: new Date().toISOString(),

            repository: {
                provider:             "gitlab",
                providerRepositoryId: body.project.id.toString(),
                fullName:             body.project.path_with_namespace,
                owner:                body.project.namespace,
                url:                  body.project.web_url,
            },

            pullRequestId: attrs.iid.toString(),
            action:        this.mapAction(attrs.action),
            state:         this.mapState(attrs.state),

            title:        attrs.title,
            description:  attrs.description || undefined,
            sourceBranch: attrs.source_branch,
            targetBranch: attrs.target_branch,
            commitSha:    attrs.last_commit?.id,

            author: body.user
                ? { providerUserId: body.user.id.toString(), username: body.user.username }
                : undefined,

            url:       attrs.url,
            createdAt: this.parseGitlabTimestamp(attrs.created_at),
            updatedAt: this.parseGitlabTimestamp(attrs.updated_at),
        };
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * GitLab's `action` doesn't cleanly separate "new commit pushed" from
     * "MR edited (title/description/etc.)" — both arrive as "update". This
     * maps "update" to "synchronize" as a best-effort default; it's an
     * approximation, not a precise signal, and downstream consumers should
     * treat it that way.
     */
    private mapAction(action: string): PullRequestAction {
        switch (action) {
            case "open":   return "opened";
            case "reopen": return "reopened";
            case "update": return "synchronize";
            case "close":  return "closed";
            case "merge":  return "merged";
            default:       return "unknown";
        }
    }

    /**
     * GitLab's "locked" state (MR locked for discussion) doesn't map
     * cleanly onto our open/closed/merged model — treated as "closed"
     * since it's not actively open/mergeable, which is the closest fit.
     */
    private mapState(state: "opened" | "closed" | "merged" | "locked"): PullRequestState {
        switch (state) {
            case "opened": return "open";
            case "merged": return "merged";
            default:       return "closed";
        }
    }

    /**
     * GitLab's timestamps ("2024-01-01 00:00:00 UTC") aren't ISO 8601 like
     * GitHub's. Parsed defensively — an unparseable timestamp is a
     * malformed payload, not something to silently turn into "Invalid Date"
     * and pass downstream.
     */
    private parseGitlabTimestamp(value: string): string {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            throw new WebhookValidationError(`GitLab payload has an unparseable timestamp: '${value}'.`);
        }
        return date.toISOString();
    }

    /**
     * Confirms the payload has the shape this method depends on before
     * dereferencing anything — mirrors GithubWebhookHandler.parsePayload.
     */
    private parsePayload(payload: unknown): GitlabMergeRequestPayload {
        // See GithubWebhookHandler.parsePayload — same reasoning: a
        // top-level-keys-only check lets a malformed payload through to a
        // TypeError, which becomes a 500 and an endless redelivery loop.
        //
        // `user` and `object_attributes.last_commit` are deliberately
        // absent: normalize() already treats both as optional.
        requireFields(payload, GITLAB_REQUIRED_FIELDS, "GitLab");

        return payload as GitlabMergeRequestPayload;
    }
}
