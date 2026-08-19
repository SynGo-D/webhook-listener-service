import { createHmac, timingSafeEqual } from "crypto";
import { IncomingHttpHeaders } from "http";
import { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import { PullRequestAction, PullRequestEvent } from "../models/PullRequestEvent.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

/**
 * Handles GitHub webhook deliveries — signature verification and
 * pull-request normalization.
 */
export class GitHubAdapter implements ProviderWebhookHandler {
    /**
     * GitHub signs the raw request body with HMAC-SHA256 using the
     * configured webhook secret, and sends the hex digest in the
     * X-Hub-Signature-256 header as "sha256=<hexdigest>". We recompute
     * the same HMAC over rawBody and compare it to what was sent.
     *
     * Comparison uses timingSafeEqual rather than === so a mismatch can't
     * be used to guess the secret one byte at a time via response timing.
     * timingSafeEqual throws on a length mismatch, so lengths are checked
     * first rather than letting that exception itself leak information.
     */
    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
        const signatureHeader = headers["x-hub-signature-256"];
        if (typeof signatureHeader !== "string") {
            return false;
        }

        const expectedSignature =
            "sha256=" + createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex");

        const received = Buffer.from(signatureHeader);
        const expected = Buffer.from(expectedSignature);

        if (received.length !== expected.length) {
            return false;
        }

        return timingSafeEqual(received, expected);
    }

    normalize(payload: unknown, headers: IncomingHttpHeaders): PullRequestEvent {
        if (!isRecord(payload) || headers["x-github-event"] !== "pull_request") {
            throw new AppError("Unsupported GitHub webhook event.", 400);
        }

        const pullRequest = asRecord(payload.pull_request);
        const repository = asRecord(payload.repository);
        const action = toPullRequestAction(payload.action);

        return {
            provider: "github",
            eventType: "pull_request",
            action,
            deliveryId: requiredHeader(headers, "x-github-delivery"),
            repository: {
                fullName: requiredString(repository, "full_name"),
                cloneUrl: requiredString(repository, "clone_url"),
                defaultBranch: requiredString(repository, "default_branch"),
            },
            receivedAt: new Date().toISOString(),
            number: requiredNumber(payload, "number"),
            title: requiredString(pullRequest, "title"),
            sourceBranch: requiredString(asRecord(pullRequest.head), "ref"),
            targetBranch: requiredString(asRecord(pullRequest.base), "ref"),
            headSha: requiredString(asRecord(pullRequest.head), "sha"),
            authorUsername: requiredString(asRecord(pullRequest.user), "login"),
            url: requiredString(pullRequest, "html_url"),
        };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new AppError("Malformed GitHub webhook payload.", 400);
    }

    return value;
}

function requiredString(record: Record<string, unknown>, field: string): string {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new AppError(`GitHub payload field "${field}" is required.`, 400);
    }

    return value;
}

function requiredNumber(record: Record<string, unknown>, field: string): number {
    const value = record[field];
    if (typeof value !== "number") {
        throw new AppError(`GitHub payload field "${field}" is required.`, 400);
    }

    return value;
}

function requiredHeader(headers: IncomingHttpHeaders, name: string): string {
    const value = headers[name];
    if (typeof value !== "string" || value.length === 0) {
        throw new AppError(`GitHub header "${name}" is required.`, 400);
    }

    return value;
}

function toPullRequestAction(value: unknown): PullRequestAction {
    if (value === "opened" || value === "synchronize" || value === "closed" || value === "reopened") {
        return value;
    }

    throw new AppError(`Unsupported GitHub pull-request action: "${String(value)}".`, 400);
}
