import { AppError } from "./AppError.js";

/**
 * Thrown when a webhook's signature/token fails verification — distinct
 * from WebhookValidationError (malformed request) because this is
 * specifically an authentication failure: the request may be well-formed
 * but we can't trust it came from the provider it claims to.
 * Maps to HTTP 401 Unauthorized.
 */
export class InvalidSignatureError extends AppError {
    constructor(message = "Invalid webhook signature.") {
        super(message, 401);
        Object.setPrototypeOf(this, InvalidSignatureError.prototype);
    }
}
