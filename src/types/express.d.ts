// Augments Express's Request type with the raw request body buffer,
// captured in app.ts's express.json({ verify }) hook. Signature
// verification (GitHub HMAC-SHA256 / GitLab secret token, added in a
// later phase) must run against these exact bytes — not the parsed and
// re-serialized JSON object, which is not guaranteed to be byte-identical
// to what the provider actually sent and signed.
declare namespace Express {
    interface Request {
        rawBody?: Buffer;
    }
}
