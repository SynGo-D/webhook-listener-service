import type { ProviderWebhookHandler } from "../adapters/ProviderWebhookHandler.js";
import { GithubWebhookHandler } from "../adapters/GithubWebhookHandler.js";
import { GitlabWebhookHandler } from "../adapters/GitlabWebhookHandler.js";
import type { Provider } from "../models/RepositoryRef.js";
import { UnsupportedProviderError } from "../errors/UnsupportedProviderError.js";

/**
 * Creates the correct ProviderWebhookHandler for a given provider name.
 *
 * The caller (the webhook controller, Phase 5) already knows the provider
 * from which route matched the request (`/webhooks/github` vs
 * `/webhooks/gitlab`) — this factory just centralizes handler
 * instantiation so the controller depends only on the interface.
 *
 * Adding a third provider later means implementing ProviderWebhookHandler
 * once and adding one case here — no other file changes.
 *
 * Handlers are created fresh on each call: they hold no per-request mutable
 * state, so there's no benefit to caching them as singletons.
 */
export class ProviderHandlerFactory {

    public static create(provider: string): ProviderWebhookHandler {
        switch (provider.toLowerCase() as Provider) {
            case "github":
                return new GithubWebhookHandler();
            case "gitlab":
                return new GitlabWebhookHandler();
            default:
                throw new UnsupportedProviderError(provider);
        }
    }
}
