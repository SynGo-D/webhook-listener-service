// Receives provider webhooks and checks their credentials before accepting them.
import { Router, type Request, type Response } from "express";
import { ProviderHandlerFactory } from "../factories/ProviderHandlerFactory.js";
import { AppError } from "../errors/AppError.js";
import { processedEventRepository } from "../repositories/ProcessedEventRepository.js";

const router = Router();

async function receiveWebhook(provider: string, req: Request, res: Response): Promise<void> {
    const rawBody = req.rawBody;

    if (!rawBody || rawBody.length === 0) {
        throw new AppError("Request body is required.", 400);
    }

    const handler = ProviderHandlerFactory.create(provider);

    if (!handler.verifySignature(rawBody, req.headers)) {
        throw new AppError("Invalid webhook signature.", 401);
    }

    const event = handler.normalize(req.body, req.headers);
    const isNewDelivery = await processedEventRepository.claim({
        provider: event.provider,
        deliveryId: event.deliveryId,
        eventType: event.eventType,
    });

    if (!isNewDelivery) {
        res.status(200).json({
            accepted: true,
            duplicate: true,
            provider,
            deliveryId: event.deliveryId,
        });
        return;
    }

    res.status(202).json({
        accepted: true,
        event,
    });
}

router.post("/github", (req, res) => receiveWebhook("github", req, res));

router.post("/gitlab", (req, res) => receiveWebhook("gitlab", req, res));

export default router;
