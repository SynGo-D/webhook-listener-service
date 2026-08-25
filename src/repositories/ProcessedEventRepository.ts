import { pool } from "../config/database.js";
import { Provider } from "../models/Provider.js";

export interface ProcessedEventIdentity {
    provider: Provider;
    deliveryId: string;
    eventType: string;
}

export class ProcessedEventRepository {
    /** Claims a delivery once. The unique key makes concurrent retries safe. */
    async claim(identity: ProcessedEventIdentity): Promise<boolean> {
        const result = await pool.query(
            `INSERT INTO processed_webhook_events
                (provider, delivery_id, event_type)
             VALUES ($1, $2, $3)
             ON CONFLICT (provider, delivery_id) DO NOTHING
             RETURNING id;`,
            [identity.provider, identity.deliveryId, identity.eventType]
        );

        return result.rowCount === 1;
    }
}

export const processedEventRepository = new ProcessedEventRepository();
