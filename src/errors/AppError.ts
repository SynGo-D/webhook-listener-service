/**
 * Base class for all expected/handled errors in this service.
 * Carries an HTTP status code so the global error handler can respond
 * correctly without needing to know about every specific error type.
 */
export class AppError extends Error {
    constructor(message: string, public readonly statusCode: number = 500) {
        super(message);
        this.name = "AppError";
        Object.setPrototypeOf(this, AppError.prototype);
    }
}
