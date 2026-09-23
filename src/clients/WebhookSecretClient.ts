import { AppError } from "../errors/AppError.js";
import { env } from "../config/env.js";
import type { Provider } from "../models/RepositoryRef.js";

export interface WebhookSecrets {
    /** Secrets of every active integration for the repository. Empty = not connected. */
    secrets: string[];
    /** At least one active integration predates per-integration secrets. */
    legacy: boolean;
}

export class SecretLookupUnavailableError extends AppError {
    constructor() {
        // 503, not 500: this is transient and on our side. GitLab still
        // counts it toward auto-disabling the hook, which is exactly why the
        // stale-if-error cache below exists.
        super("Webhook verification is temporarily unavailable.", 503);
        Object.setPrototypeOf(this, SecretLookupUnavailableError.prototype);
    }
}

interface CacheEntry {
    value: WebhookSecrets;
    fetchedAt: number;
}

export interface WebhookSecretClientOptions {
    baseUrl?: string;
    token?: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
}

/** A hit on a connected repository is reused for a minute. */
const POSITIVE_TTL_MS = 60_000;
/**
 * A miss is reused briefly — long enough to absorb a flood of deliveries
 * naming unconnected repositories, short enough that a repository connected
 * a moment ago isn't rejected for long.
 */
const NEGATIVE_TTL_MS = 10_000;
/**
 * How stale an entry may be and still be served when integration-service
 * can't be reached. The trade: during an outage, a repository revoked less
 * than an hour ago can still deliver. Against that, GitLab disables a hook
 * after four consecutive failures, and GitHub never retries at all — so
 * without this, a short integration-service outage silently loses real
 * events or disables real hooks.
 */
const STALE_IF_ERROR_MS = 60 * 60_000;
/**
 * Repository names in the lookup come from unauthenticated payloads, so an
 * attacker chooses them. Without a cap each invented name would add an
 * entry forever. Oldest entries go first (Map keeps insertion order).
 */
const MAX_ENTRIES = 10_000;
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * Fetches, from integration-service, the webhook secrets a delivery for a
 * given repository may be signed with.
 *
 * This is both the key store and the allowlist: a repository with no
 * active integration has no secrets, so its deliveries can't verify.
 */
export class WebhookSecretClient {

    private readonly cache    = new Map<string, CacheEntry>();
    private readonly inFlight = new Map<string, Promise<WebhookSecrets>>();

    private readonly baseUrl:   string;
    private readonly token:     string;
    private readonly fetchImpl: typeof fetch;
    private readonly now:       () => number;

    constructor(options: WebhookSecretClientOptions = {}) {
        this.baseUrl   = options.baseUrl   ?? env.INTEGRATION_SERVICE_URL;
        this.token     = options.token     ?? env.INTERNAL_SERVICE_TOKEN;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.now       = options.now       ?? Date.now;
    }

    async getSecrets(provider: Provider, repositoryFullName: string): Promise<WebhookSecrets> {
        const key = `${provider}:${repositoryFullName.toLowerCase()}`;
        const cached = this.cache.get(key);

        if (cached && this.age(cached) < this.ttlFor(cached.value)) {
            return cached.value;
        }

        // Concurrent deliveries for the same repository share one request
        // rather than each hitting integration-service.
        const pending = this.inFlight.get(key);
        if (pending) {
            return pending;
        }

        const request = this.fetchAndStore(key, provider, repositoryFullName, cached)
            .finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, request);
        return request;
    }

    private async fetchAndStore(
        key: string,
        provider: Provider,
        repositoryFullName: string,
        cached: CacheEntry | undefined
    ): Promise<WebhookSecrets> {
        try {
            const value = await this.fetchSecrets(provider, repositoryFullName);
            this.store(key, value);
            return value;
        } catch (error) {
            if (cached && this.age(cached) < STALE_IF_ERROR_MS) {
                console.warn(
                    `[secrets] integration-service unreachable, serving cached secrets for ${key}:`,
                    error instanceof Error ? error.message : error
                );
                return cached.value;
            }
            console.error(
                `[secrets] integration-service unreachable and nothing cached for ${key}:`,
                error instanceof Error ? error.message : error
            );
            throw new SecretLookupUnavailableError();
        }
    }

    private async fetchSecrets(provider: Provider, repositoryFullName: string): Promise<WebhookSecrets> {
        if (!this.token) {
            throw new Error("INTERNAL_SERVICE_TOKEN is not configured.");
        }

        const url = new URL("/internal/webhook-secrets", this.baseUrl);
        url.searchParams.set("provider", provider);
        url.searchParams.set("repository", repositoryFullName);

        const response = await this.fetchImpl(url, {
            headers: { Authorization: `Bearer ${this.token}` },
            signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`integration-service answered ${response.status}`);
        }

        const body = await response.json() as { data?: Partial<WebhookSecrets> };
        const data = body.data;

        // Treat a malformed answer as an outage, not as "no secrets" — the
        // latter would reject every delivery as if the repository weren't
        // connected.
        if (!data || !Array.isArray(data.secrets) || typeof data.legacy !== "boolean"
            || !data.secrets.every((s) => typeof s === "string")) {
            throw new Error("integration-service returned a malformed response");
        }

        return { secrets: data.secrets, legacy: data.legacy };
    }

    private store(key: string, value: WebhookSecrets): void {
        this.cache.delete(key); // re-insert so it counts as newest
        this.cache.set(key, { value, fetchedAt: this.now() });

        while (this.cache.size > MAX_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
    }

    private age(entry: CacheEntry): number {
        return this.now() - entry.fetchedAt;
    }

    private ttlFor(value: WebhookSecrets): number {
        const connected = value.secrets.length > 0 || value.legacy;
        return connected ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    }
}
