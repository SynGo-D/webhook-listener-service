import { Request, Response } from "express";
import { WebhookIngestionService } from "../services/WebhookIngestionService.js";
import { WebhookValidationError } from "../errors/WebhookValidationError.js";
import { AppError } from "../errors/AppError.js";

/**
 * HTTP entry point for POST /webhooks/:provider.
 *
 * Deliberately thin: parse the request, delegate everything to the
 * service layer, translate the result/error into an HTTP response. No
 * GitHub/GitLab API calls and no code-analysis logic belong here.
 */
export class WebhookController {

    constructor(private readonly service: WebhookIngestionService) {}

    handle = async (req: Request, res: Response): Promise<void> => {
        // Express types req.params values as `string | string[]` to cover
        // repeatable route segments, which `:provider` never produces —
        // narrow it explicitly rather than asserting.
        const provider = Array.isArray(req.params.provider)
            ? req.params.provider[0]
            : req.params.provider;

        try {
            if (!provider) {
                throw new WebhookValidationError("Missing provider route segment.");
            }

            if (!req.rawBody) {
                // Should be unreachable in practice — express.json()'s verify
                // hook (app.ts) always sets this — but fail explicitly rather
                // than passing an empty buffer into signature verification.
                throw new WebhookValidationError("Missing request body.");
            }

            const result = await this.service.ingest(provider, req.rawBody, req.headers, req.body);

            if (result.outcome === "ignored") {
                res.status(200).json({
                    success: true,
                    message: result.reason,
                });
                return;
            }

            // 202: accepted for asynchronous downstream processing — this
            // service does not wait for the Analysis/Orchestration service.
            res.status(202).json({
                success:    true,
                deliveryId: result.deliveryId,
            });

        } catch (error) {
            this.handleError(res, provider, error);
        }
    };

    private handleError(res: Response, provider: string, error: unknown): void {
        if (error instanceof AppError) {
            console.warn(`[webhook:${provider}] rejected (${error.statusCode}): ${error.message}`);
            res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
            return;
        }

        console.error(`[webhook:${provider}] unhandled error:`, error);
        res.status(500).json({
            success: false,
            message: "An internal server error occurred.",
        });
    }
}
