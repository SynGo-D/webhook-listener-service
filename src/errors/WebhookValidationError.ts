import { AppError } from "./AppError.js";

/**
 * Thrown when a webhook request is malformed or missing information this
 * service requires to process it (e.g. a required header is absent).
 * Distinct from signature failures (which are an authentication concern,
 * not a validation one) — see errors added in Phase 4.
 * Maps to HTTP 400 Bad Request.
 */
export class WebhookValidationError extends AppError {
    constructor(message = "Malformed webhook request.") {
        super(message, 400);
        Object.setPrototypeOf(this, WebhookValidationError.prototype);
    }
}
