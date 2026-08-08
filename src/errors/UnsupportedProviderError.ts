import { AppError } from "./AppError.js";

/**
 * Thrown when a request arrives for a provider we have no handler for.
 * In practice this should be unreachable once routing is wired (Phase 5)
 * since each route only ever asks the factory for its own fixed provider
 * — this exists so the factory fails loudly rather than silently if that
 * invariant is ever violated (e.g. a future route passes a typo'd string).
 * Maps to HTTP 400 Bad Request.
 */
export class UnsupportedProviderError extends AppError {
    constructor(provider: string) {
        super(
            `Unsupported provider '${provider}'. Supported providers: github, gitlab.`,
            400
        );
        Object.setPrototypeOf(this, UnsupportedProviderError.prototype);
    }
}
