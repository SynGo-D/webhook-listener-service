import type { IncomingHttpHeaders } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderWebhookHandler } from "./ProviderWebhookHandler.js";
import type { WebhookEvent } from "../models/WebhookEvent.js";
import type { PullRequestAction, PullRequestState } from "../models/PullRequestEvent.js";
import { WebhookValidationError } from "../errors/WebhookValidationError.js";
import { requireFields } from "./requireFields.js";

const SIGNATURE_PREFIX = "sha256=";

/** Every path `normalize()` reads — see parsePayload for why nested ones are listed. */
const GITHUB_REQUIRED_FIELDS = [
    "action",
    "number",
    "pull_request.state",
    "pull_request.merged",
    "pull_request.title",
    "pull_request.html_url",
    "pull_request.created_at",
    "pull_request.updated_at",
    "pull_request.head.ref",
    "pull_request.head.sha",
    "pull_request.base.ref",
    "repository.id",
    "repository.full_name",
    "repository.owner.login",
    "repository.html_url",
] as const;

/** Only the fields this service actually reads from GitHub's pull_request webhook payload. */
interface GithubPullRequestPayload {
    action: string;
    /** Top-level PR number — GitHub's canonical field for pull_request events (also duplicated at pull_request.number). */
    number: number;
    pull_request: {
        state:      "open" | "closed";
        merged:     boolean;
        title:      string;
        body?:      string | null;
        html_url:   string;
        created_at: string;
        updated_at: string;
        user:       { id: number; login: string } | null;
        head:       { ref: string; sha: string };
        base:       { ref: string };
    };
    repository: {
        id:        number;
        full_name: string;
        owner:     { login: string };
        html_url:  string;
    };
}

/**
 * GitHub implementation of the ProviderWebhookHandler contract.
 *
 * Event types we currently support: `pull_request`. GitHub sends its
 * event type in the `X-GitHub-Event` header (not in the payload body),
 * and a per-delivery UUID in `X-GitHub-Delivery` — both are cheap header
 * reads, so they're implemented now rather than stubbed.
 */
export class GithubWebhookHandler implements ProviderWebhookHandler {

    public readonly provider = "github" as const;

    extractRepositoryFullName(payload: unknown): string | null {
        const fullName = (payload as { repository?: { full_name?: unknown } } | null)
            ?.repository?.full_name;
        return typeof fullName === "string" && fullName.length > 0 ? fullName : null;
    }

    /**
     * Recomputes the HMAC-SHA256 over the exact raw body bytes (see
     * app.ts's express.json({ verify }) hook) and compares it to the
     * `X-Hub-Signature-256` header using a constant-time comparison — a
     * plain `===` here would leak how many leading bytes matched through
     * timing, which is exactly the kind of side channel HMAC signatures
     * exist to close.
     */
    verifySignature(rawBody: Buffer, headers: IncomingHttpHeaders, secrets: readonly string[]): boolean {
        const signatureHeader = headers["x-hub-signature-256"];
        if (!signatureHeader || typeof signatureHeader !== "string") {
            return false;
        }

        const actual = Buffer.from(signatureHeader, "utf8");

        // Every candidate is checked even after a match, so response time
        // doesn't reveal which of a repository's hooks a signature belongs to.
        let matched = false;
        for (const secret of secrets) {
            const expected = Buffer.from(
                SIGNATURE_PREFIX + createHmac("sha256", secret).update(rawBody).digest("hex"),
                "utf8"
            );
            // timingSafeEqual throws on length mismatch rather than
            // returning false — guard so a differently-sized header fails
            // closed instead of crashing the request.
            const equal = expected.length === actual.length && timingSafeEqual(expected, actual);
            matched = equal || matched;
        }
        return matched;
    }

    supportsEvent(headers: IncomingHttpHeaders): boolean {
        return headers["x-github-event"] === "pull_request";
    }

    extractDeliveryId(headers: IncomingHttpHeaders, _payload: unknown): string {
        const deliveryId = headers["x-github-delivery"];

        if (!deliveryId || typeof deliveryId !== "string") {
            throw new WebhookValidationError(
                "GitHub webhook request is missing the X-GitHub-Delivery header."
            );
        }

        return deliveryId;
    }

    normalize(_headers: IncomingHttpHeaders, payload: unknown, deliveryId: string): WebhookEvent {
        const body = this.parsePayload(payload);
        const pr   = body.pull_request;

        return {
            provider:   "github",
            eventType:  "pull_request",
            deliveryId,
            receivedAt: new Date().toISOString(),

            repository: {
                provider:             "github",
                providerRepositoryId: body.repository.id.toString(),
                fullName:             body.repository.full_name,
                owner:                body.repository.owner.login,
                url:                  body.repository.html_url,
            },

            pullRequestId: this.extractNumber(body),
            action:        this.mapAction(body.action, pr.merged),
            state:         this.mapState(pr.state, pr.merged),

            title:        pr.title,
            description:  pr.body || undefined,
            sourceBranch: pr.head.ref,
            targetBranch: pr.base.ref,
            commitSha:    pr.head.sha,

            author: pr.user
                ? { providerUserId: pr.user.id.toString(), username: pr.user.login }
                : undefined,

            url:       pr.html_url,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
        };
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private extractNumber(body: GithubPullRequestPayload): string {
        if (typeof body.number !== "number") {
            throw new WebhookValidationError("GitHub payload is missing a PR number.");
        }
        return body.number.toString();
    }

    /**
     * GitHub's `action` field doesn't distinguish "closed" from "merged" —
     * that's the separate `pull_request.merged` boolean, only meaningful
     * once state is "closed".
     */
    private mapAction(action: string, merged: boolean): PullRequestAction {
        switch (action) {
            case "opened":      return "opened";
            case "reopened":    return "reopened";
            case "synchronize": return "synchronize";
            case "edited":      return "edited";
            case "closed":      return merged ? "merged" : "closed";
            default:            return "unknown";
        }
    }

    private mapState(state: "open" | "closed", merged: boolean): PullRequestState {
        if (state === "open") return "open";
        return merged ? "merged" : "closed";
    }

    /**
     * Confirms the payload has the shape this method depends on before
     * dereferencing anything — a payload that passes signature verification
     * but doesn't look like a real pull_request event (e.g. a GitHub "ping"
     * payload sent to the wrong path) should fail with a clear 400, not a
     * raw TypeError on `undefined.foo`.
     */
    private parsePayload(payload: unknown): GithubPullRequestPayload {
        // Every path normalize() dereferences, checked up front. Listing
        // the nested ones matters: a payload carrying `pull_request: {}`
        // clears a top-level-keys-only check and then throws a TypeError
        // deeper in, which becomes a 500 and an endless GitHub redelivery
        // loop for a payload that can never succeed.
        //
        // `pull_request.user` is deliberately absent from this list —
        // GitHub sends null for a deleted account, and normalize() already
        // treats the author as optional.
        requireFields(payload, GITHUB_REQUIRED_FIELDS, "GitHub");

        return payload as GithubPullRequestPayload;
    }
}
