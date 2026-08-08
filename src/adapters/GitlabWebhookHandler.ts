import type { IncomingHttpHeaders } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import type { WebhookEvent } from "../models/WebhookEvent.js";
import type { PullRequestAction, PullRequestState } from "../models/PullRequestEvent.js";
import { AppError } from "../errors/AppError.js";
import { WebhookValidationError } from "../errors/WebhookValidationError.js";
import { env } from "../config/env.js";

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
 * Unlike GitHub, GitLab does not reliably send a per-delivery UUID header
 * across all versions/self-managed instances — a real delivery-ID needs to
 * be derived from stable Merge Request payload fields (project ID +
 * merge-request IID + updated_at). That requires the real GitLab MR
 * payload shape, so it's implemented alongside normalization in Phase 6
 * rather than guessed at here.
 */
export class GitlabWebhookHandler implements ProviderWebhookHandler {

    public readonly provider = "gitlab" as const;

    /**
     * GitLab's mechanism is a static secret token (`X-Gitlab-Token`), not
     * an HMAC over the body — unlike GitHub, this only authenticates that
     * the sender knows the secret; it does not cryptographically cover the
     * payload, so a compromised network intermediary could in principle
     * tamper with the body without invalidating the token. That's a
     * platform limitation, not something this service can strengthen —
     * GitLab does not offer an HMAC-based alternative for webhooks.
     *
     * Still compared with a constant-time check, for the same timing-leak
     * reason as GitHub's signature comparison.
     */
    verifySignature(_rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
        if (!env.GITLAB_WEBHOOK_SECRET) {
            throw new AppError("GITLAB_WEBHOOK_SECRET is not configured.", 500);
        }

        const token = headers["x-gitlab-token"];
        if (!token || typeof token !== "string") {
            return false;
        }

        const expected = Buffer.from(env.GITLAB_WEBHOOK_SECRET, "utf8");
        const actual   = Buffer.from(token, "utf8");

        if (expected.length !== actual.length) {
            return false;
        }

        return timingSafeEqual(expected, actual);
    }

    supportsEvent(headers: IncomingHttpHeaders): boolean {
        return headers["x-gitlab-event"] === "Merge Request Hook";
    }

    /**
     * GitLab has no delivery-ID header, so this derives a stable
     * fingerprint from (project ID, MR IID, updated_at). Keying on
     * `updated_at` rather than just the MR's identity is deliberate: a
     * genuine follow-up change (new commit, edit) bumps `updated_at` and
     * correctly produces a *different* ID, so Phase 7's dedup only
     * collapses true redeliveries of the identical webhook, not real
     * subsequent events on the same MR.
     */
    extractDeliveryId(_headers: IncomingHttpHeaders, payload: unknown): string {
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
        if (
            !payload ||
            typeof payload !== "object" ||
            !("object_attributes" in payload) ||
            !("project" in payload)
        ) {
            throw new WebhookValidationError(
                "GitLab payload is missing required 'object_attributes'/'project' fields."
            );
        }

        return payload as GitlabMergeRequestPayload;
    }
}
