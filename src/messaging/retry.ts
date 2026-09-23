export interface RetryOptions {
    attempts:    number;
    baseDelayMs: number;
}

/**
 * Retries `fn` with exponential backoff (baseDelayMs, 2x, 4x, ...) up to
 * `attempts` total tries, throwing the last error if all attempts fail.
 *
 * Deliberately generic and tiny — this smooths over brief transient
 * failures (a broker blip lasting a few hundred ms) fast, without waiting
 * on the much slower provider-webhook-redelivery path that's the ultimate
 * backstop for anything that outlasts these retries (see
 * WebhookIngestionService's rollback-on-failure).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.attempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt === options.attempts) {
                break;
            }

            const delayMs = options.baseDelayMs * 2 ** (attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw lastError;
}
