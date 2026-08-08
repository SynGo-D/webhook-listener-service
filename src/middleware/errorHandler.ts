import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";

/**
 * Global error-handling middleware. Must be registered LAST in app.ts.
 *
 * Behaviour:
 *  • AppError and subclasses           → use the error's statusCode + message.
 *  • express.json() body-parser errors → 400 (malformed JSON is a client
 *    error, not ours — without this check it would fall through to the
 *    500 branch below and misreport a bad request as a server failure).
 *  • Any other error                   → 500, message withheld (don't leak
 *    internals from a service that receives requests from public webhook
 *    senders).
 *
 * Correlation/delivery IDs are attached to `req` by upstream middleware
 * (added in a later phase) and included here once structured logging lands,
 * so failures can be traced back to a specific provider delivery.
 */
export function errorHandler(
    err:   Error,
    req:   Request,
    res:   Response,
    _next: NextFunction
): void {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            success: false,
            message: err.message,
        });
        return;
    }

    const isBodyParserSyntaxError =
        err instanceof SyntaxError && (err as SyntaxError & { status?: number }).status === 400;

    if (isBodyParserSyntaxError) {
        res.status(400).json({
            success: false,
            message: "Malformed JSON payload.",
        });
        return;
    }

    console.error("[ErrorHandler]", err);

    res.status(500).json({
        success: false,
        message: "An internal server error occurred.",
    });
}
