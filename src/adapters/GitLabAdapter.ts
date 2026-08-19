import { timingSafeEqual } from "crypto";
import { IncomingHttpHeaders } from "http";
import { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import { PullRequestAction, PullRequestEvent } from "../models/PullRequestEvent.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

/**
 * Handles GitLab webhook deliveries — token verification and merge-request
 * normalization.
 */
export class GitLabAdapter implements ProviderWebhookHandler {
    /**
     * GitLab doesn't sign anything — it just echoes the secret token you
     * configured back in the X-Gitlab-Token header. Verification is a
     * direct comparison, so rawBody isn't used here at all (unlike
     * GitHub's HMAC scheme).
     *
     * Still uses timingSafeEqual rather than === for the same reason as
     * GitHubAdapter: a naive string comparison leaks timing information
     * an attacker could use to guess the secret.
     */
    verifySignature(_rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
        const token = headers["x-gitlab-token"];
        if (typeof token !== "string") {
            return false;
        }

        const received = Buffer.from(token);
        const expected = Buffer.from(env.GITLAB_WEBHOOK_SECRET);

        if (received.length !== expected.length) {
            return false;
        }

        return timingSafeEqual(received, expected);
    }

    normalize(payload: unknown, headers: IncomingHttpHeaders): PullRequestEvent {
        if (!isRecord(payload) || headers["x-gitlab-event"] !== "Merge Request Hook") {
            throw new AppError("Unsupported GitLab webhook event.", 400);
        }

        const attributes = asRecord(payload.object_attributes);
        const project = asRecord(payload.project);
        const lastCommit = asRecord(attributes.last_commit);
        const user = asRecord(payload.user);

        return {
            provider: "gitlab",
            eventType: "pull_request",
            action: toPullRequestAction(attributes.action),
            deliveryId: requiredHeader(headers, "x-gitlab-event-uuid"),
            repository: {
                fullName: requiredString(project, "path_with_namespace"),
                cloneUrl: requiredString(project, "http_url_to_repo"),
                defaultBranch: requiredString(project, "default_branch"),
            },
            receivedAt: new Date().toISOString(),
            number: requiredNumber(attributes, "iid"),
            title: requiredString(attributes, "title"),
            sourceBranch: requiredString(attributes, "source_branch"),
            targetBranch: requiredString(attributes, "target_branch"),
            headSha: requiredString(lastCommit, "id"),
            authorUsername: requiredString(user, "username"),
            url: requiredString(attributes, "url"),
        };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new AppError("Malformed GitLab webhook payload.", 400);
    }

    return value;
}

function requiredString(record: Record<string, unknown>, field: string): string {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new AppError(`GitLab payload field "${field}" is required.`, 400);
    }

    return value;
}

function requiredNumber(record: Record<string, unknown>, field: string): number {
    const value = record[field];
    if (typeof value !== "number") {
        throw new AppError(`GitLab payload field "${field}" is required.`, 400);
    }

    return value;
}

function requiredHeader(headers: IncomingHttpHeaders, name: string): string {
    const value = headers[name];
    if (typeof value !== "string" || value.length === 0) {
        throw new AppError(`GitLab header "${name}" is required.`, 400);
    }

    return value;
}

function toPullRequestAction(value: unknown): PullRequestAction {
    switch (value) {
        case "open":
            return "opened";
        case "update":
            return "synchronize";
        case "close":
            return "closed";
        case "reopen":
            return "reopened";
        default:
            throw new AppError(`Unsupported GitLab merge-request action: "${String(value)}".`, 400);
    }
}
