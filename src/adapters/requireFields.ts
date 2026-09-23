import { WebhookValidationError } from "../errors/WebhookValidationError.js";

/**
 * Asserts that every dotted path exists (and is not null) on a webhook
 * payload, before the caller starts dereferencing it.
 *
 * Why this exists: a shallow "are the top-level keys present" check passes
 * for a payload like `{action, number, pull_request: {}, repository: {}}`,
 * and normalize() then throws a raw TypeError on `repository.id.toString()`.
 * That surfaces as a 500, which GitHub treats as retryable — so it
 * redelivers a payload that can never succeed, forever. A shape problem is
 * permanent and belongs in the 4xx family.
 *
 * Paths use dots for nesting (`pull_request.head.sha`). Only presence is
 * checked, not type: the goal is to fail with a useful message instead of
 * a TypeError, not to reimplement a schema validator.
 */
export function requireFields(
    payload: unknown,
    paths: readonly string[],
    providerLabel: string
): void {
    if (!payload || typeof payload !== "object") {
        throw new WebhookValidationError(`${providerLabel} payload is not an object.`);
    }

    const missing = paths.filter((path) => !hasPath(payload, path));

    if (missing.length > 0) {
        throw new WebhookValidationError(
            `${providerLabel} payload is missing required field(s): ${missing.join(", ")}.`
        );
    }
}

function hasPath(root: object, path: string): boolean {
    let current: unknown = root;

    for (const segment of path.split(".")) {
        if (current === null || current === undefined || typeof current !== "object") {
            return false;
        }
        if (!(segment in (current as Record<string, unknown>))) {
            return false;
        }
        current = (current as Record<string, unknown>)[segment];
    }

    // A present-but-null field is as unusable as an absent one — every
    // caller of this helper goes on to dereference or stringify the value.
    return current !== null && current !== undefined;
}
