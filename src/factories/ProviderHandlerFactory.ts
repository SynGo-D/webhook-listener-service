import { AppError } from "../errors/AppError.js";
import { ProviderWebhookHandler } from "../adapters/ProviderWebhookHandler.js";
import { GitHubAdapter } from "../adapters/GitHubAdapter.js";
import { GitLabAdapter } from "../adapters/GitLabAdapter.js";

/**
 * Selects the adapter for an incoming webhook request (Factory Pattern).
 * Centralizing that choice here means the controller never branches on
 * provider itself — it just asks for a handler and gets back something
 * that satisfies ProviderWebhookHandler.
 *
 * Takes a plain string rather than the stricter Provider type because the
 * caller (a future controller) will be handing this a raw route param —
 * validation of "is this a provider we actually support" has to happen
 * here, at runtime, not just at the type level.
 */
export class ProviderHandlerFactory {
    static create(provider: string): ProviderWebhookHandler {
        switch (provider) {
            case "github":
                return new GitHubAdapter();
            case "gitlab":
                return new GitLabAdapter();
            default:
                throw new AppError(`Unsupported provider: "${provider}"`, 400);
        }
    }
}
