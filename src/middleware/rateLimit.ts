import type { Request } from "express";
import { rateLimit, ipKeyGenerator, MINUTE } from "express-rate-limit";

/**
 * Rate limiting for the public webhook endpoint.
 *
 * Unlike integration-service — where every request arrives from
 * main-backend's single IP and per-IP limiting would punish all users for
 * one — this service is called *directly* by GitHub and GitLab from the
 * public internet. Source IP is a real, meaningful identity here, and it
 * is the only one available: there is no session and no user.
 *
 * Two limiters, because legitimate and hostile traffic look nothing alike:
 *
 *   • `webhookLimiter` is a generous ceiling on all traffic from one IP.
 *     Providers genuinely burst — a push touching several open pull
 *     requests fires several deliveries at once — and a delivery we reject
 *     gets retried later, so a limit tuned too tightly turns into lost
 *     events rather than protection.
 *
 *   • `failedVerificationLimiter` counts only requests rejected as
 *     unauthenticated (401), cutting an attacker's throughput roughly 15x
 *     below the general ceiling. It deliberately does *not* count 400 or
 *     413: a provider can legitimately send a payload we consider
 *     malformed or oversized, and that shouldn't consume an auth budget.
 *
 *     One honest caveat, verified rather than assumed: once this budget is
 *     exhausted for an IP, *every* request from that IP is throttled for
 *     the rest of the window — including correctly signed ones.
 *     `skipSuccessfulRequests` stops successes being counted; it does not
 *     exempt them from an already-tripped limit. The asymmetry is
 *     therefore across IPs (an attacker's address versus a provider's),
 *     not within one. The case that matters in practice is a secret
 *     rotated on only one side: deliveries start failing, burn the budget,
 *     and are briefly throttled even after the secret is fixed. Providers
 *     retry, so it self-heals within the window — but the limit is set
 *     well above any plausible burst of genuine failures for that reason.
 *
 * `ipKeyGenerator` rather than `req.ip` directly: it normalises IPv6 to a
 * subnet, so a single IPv6 host can't rotate through its own /64 to get a
 * fresh bucket per request.
 */

function ipKey(req: Request): string {
    return ipKeyGenerator(req.ip ?? "");
}

function tooManyRequests(message: string) {
    return { success: false, message };
}

/** Health and readiness probes must never be throttled — monitoring polls them constantly. */
function isProbe(req: Request): boolean {
    return req.path === "/health" || req.path === "/ready";
}

export const webhookLimiter = rateLimit({
    windowMs: MINUTE,
    limit: 300,
    keyGenerator: ipKey,
    skip: isProbe,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooManyRequests("Too many requests."),
});

export const failedVerificationLimiter = rateLimit({
    windowMs: MINUTE,
    limit: 50,
    keyGenerator: ipKey,
    skip: isProbe,
    skipSuccessfulRequests: true,
    // Narrows "failure" to authentication failure specifically. Without
    // this, a 400 (malformed payload) or 413 (oversized) would count, and
    // a provider sending a payload shape we reject could throttle its own
    // legitimate deliveries.
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooManyRequests("Too many rejected requests."),
});
