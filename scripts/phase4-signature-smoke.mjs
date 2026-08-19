import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { GitHubAdapter } from "../dist/adapters/GitHubAdapter.js";
import { GitLabAdapter } from "../dist/adapters/GitLabAdapter.js";

const body = Buffer.from('{"action":"opened"}');
const changedBody = Buffer.from('{"action":"closed"}');

const github = new GitHubAdapter();
const gitlab = new GitLabAdapter();
const githubSignature =
    "sha256=" + createHmac("sha256", "dev-github-secret").update(body).digest("hex");

assert.equal(
    github.verifySignature(body, {
        "x-hub-signature-256": githubSignature,
    }),
    true
);
assert.equal(
    github.verifySignature(changedBody, {
        "x-hub-signature-256": githubSignature,
    }),
    false
);
assert.equal(github.verifySignature(body, {}), false);


assert.equal(
    gitlab.verifySignature(body, {
        "x-gitlab-token": "dev-gitlab-secret",
    }),
    true
);
assert.equal(
    gitlab.verifySignature(body, {
        "x-gitlab-token": "wrong-token",
    }),
    false
);
assert.equal(gitlab.verifySignature(body, {}), false);

console.log("Phase 4 signature verification checks passed.");
