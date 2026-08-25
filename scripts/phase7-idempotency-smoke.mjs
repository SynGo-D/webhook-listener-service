import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import app from "../dist/app.js";

const deliveryId = `phase7-github-${Date.now()}`;
const body = JSON.stringify({
    action: "opened",
    number: 77,
    pull_request: {
        title: "Idempotency check",
        head: { ref: "feature/dedup", sha: "phase7sha" },
        base: { ref: "main" },
        user: { login: "octocat" },
        html_url: "https://github.com/octocat/hello-world/pull/77",
    },
    repository: {
        full_name: "octocat/hello-world",
        clone_url: "https://github.com/octocat/hello-world.git",
        default_branch: "main",
    },
});

const signature =
    "sha256=" + createHmac("sha256", "dev-github-secret").update(body).digest("hex");

function request(server) {
    return new Promise((resolve, reject) => {
        const { port } = server.address();
        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path: "/webhooks/github",
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-github-event": "pull_request",
                    "x-github-delivery": deliveryId,
                    "x-hub-signature-256": signature,
                },
            },
            (res) => {
                let responseBody = "";
                res.on("data", (chunk) => {
                    responseBody += chunk;
                });
                res.on("end", () => {
                    resolve({ statusCode: res.statusCode, body: responseBody });
                });
            }
        );

        req.on("error", reject);
        req.end(body);
    });
}

const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
});

try {
    const first = await request(server);
    assert.equal(first.statusCode, 202);

    const second = await request(server);
    assert.equal(second.statusCode, 200);

    const secondBody = JSON.parse(second.body);
    assert.equal(secondBody.accepted, true);
    assert.equal(secondBody.duplicate, true);
    assert.equal(secondBody.deliveryId, deliveryId);

    console.log("Phase 7 idempotency checks passed.");
} finally {
    await new Promise((resolve) => server.close(resolve));
}
