import { describe, it, expect, beforeEach, vi } from "vitest";

import {
    DEAD_EXCHANGE_NAME,
    DEAD_QUEUE_NAME,
    EXCHANGE_NAME,
    PR_QUEUE_ARGUMENTS,
    PR_QUEUE_NAME,
    PR_ROUTING_PATTERN,
    setupMessagingTopology,
} from "../src/messaging/topology.js";

/**
 * Records the order of declarations as well as their arguments — the
 * order is load-bearing here, not incidental.
 */
function fakeChannel() {
    const calls: string[] = [];

    return {
        calls,
        assertExchange: vi.fn(async (name: string) => { calls.push(`exchange:${name}`); }),
        assertQueue: vi.fn(async (name: string) => { calls.push(`queue:${name}`); }),
        bindQueue: vi.fn(async (queue: string, exchange: string) => {
            calls.push(`bind:${queue}->${exchange}`);
        }),
    };
}

describe("messaging topology", () => {
    let channel: ReturnType<typeof fakeChannel>;

    beforeEach(async () => {
        channel = fakeChannel();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await setupMessagingTopology(channel as any);
    });

    it("declares pr_queue with a dead-letter exchange", () => {
        expect(channel.assertQueue).toHaveBeenCalledWith(
            PR_QUEUE_NAME,
            expect.objectContaining({
                durable: true,
                arguments: { "x-dead-letter-exchange": DEAD_EXCHANGE_NAME },
            })
        );
    });

    it("pins the exact arguments analysis-engine must also use", () => {
        // Queue arguments are immutable and both services declare this
        // queue, so a change here without the matching change in
        // analysis-engine's messaging/topology.py makes whichever
        // declares second crash-loop on PRECONDITION_FAILED. If this
        // assertion fails, change both or neither.
        expect(PR_QUEUE_ARGUMENTS).toEqual({ "x-dead-letter-exchange": "webhook.events.dead" });
    });

    it("declares the dead-letter exchange before the queue that points at it", () => {
        // A queue whose x-dead-letter-exchange names an exchange that
        // does not exist yet drops its rejected messages silently, which
        // is the exact failure this topology exists to prevent.
        const deadExchange = channel.calls.indexOf(`exchange:${DEAD_EXCHANGE_NAME}`);
        const prQueue = channel.calls.indexOf(`queue:${PR_QUEUE_NAME}`);

        expect(deadExchange).toBeGreaterThanOrEqual(0);
        expect(deadExchange).toBeLessThan(prQueue);
    });

    it("binds the dead queue so parked messages are reachable", () => {
        // Bound on the same pattern as the live queue: no
        // x-dead-letter-routing-key is set, so a parked message keeps its
        // original key and `pr.#` still catches it.
        expect(channel.bindQueue).toHaveBeenCalledWith(
            DEAD_QUEUE_NAME, DEAD_EXCHANGE_NAME, PR_ROUTING_PATTERN
        );
    });

    it("gives the dead queue a retention window rather than letting it grow forever", () => {
        expect(channel.assertQueue).toHaveBeenCalledWith(
            DEAD_QUEUE_NAME,
            expect.objectContaining({
                durable: true,
                arguments: { "x-message-ttl": 14 * 24 * 60 * 60 * 1000 },
            })
        );
    });

    it("still declares the live exchange, queue and binding", () => {
        expect(channel.assertExchange).toHaveBeenCalledWith(EXCHANGE_NAME, "topic", { durable: true });
        expect(channel.bindQueue).toHaveBeenCalledWith(PR_QUEUE_NAME, EXCHANGE_NAME, PR_ROUTING_PATTERN);
    });
});
