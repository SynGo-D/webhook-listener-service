/* Checks the real webhook routes through the Express app. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import app from "../dist/app.js";

const body = JSON.stringify({ action: "opened" });
const signature =
    "sha256=" + createHmac("sha256", "dev-github-secret").update(body).digest("hex");

function request(server, path, headers, requestBody = body) {
    return new Promise((resolve, reject) => {
        const { port } = server.address();
        const request = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...headers,
                },
            },
            (response) => {
                let responseBody = "";
                response.on("data", (chunk) => {
                    responseBody += chunk;
                });
                response.on("end", () => {
                    resolve({ statusCode: response.statusCode, body: responseBody });
                });
            }
        );

        request.on("error", reject);
        request.end(requestBody);
    });
}

const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
});

try {
    const accepted = await request(server, "/webhooks/github", {
        "x-hub-signature-256": signature,
    });
    assert.equal(accepted.statusCode, 202);
    assert.deepEqual(JSON.parse(accepted.body), {
        accepted: true,
        provider: "github",
    });

    const rejected = await request(server, "/webhooks/github", {
        "x-hub-signature-256": "sha256=wrong",
    });
    assert.equal(rejected.statusCode, 401);

    const missingGithubSignature = await request(server, "/webhooks/github", {});
    assert.equal(missingGithubSignature.statusCode, 401);

    const gitlabAccepted = await request(server, "/webhooks/gitlab", {
        "x-gitlab-token": "dev-gitlab-secret",
    });
    assert.equal(gitlabAccepted.statusCode, 202);
    assert.deepEqual(JSON.parse(gitlabAccepted.body), {
        accepted: true,
        provider: "gitlab",
    });

    const gitlabRejected = await request(server, "/webhooks/gitlab", {
        "x-gitlab-token": "wrong-token",
    });
    assert.equal(gitlabRejected.statusCode, 401);

    const missingGitlabToken = await request(server, "/webhooks/gitlab", {});
    assert.equal(missingGitlabToken.statusCode, 401);

    const emptyBody = await request(
        server,
        "/webhooks/github",
        { "x-hub-signature-256": signature },
        ""
    );
    assert.equal(emptyBody.statusCode, 400);

    const unknownRoute = await request(server, "/webhooks/unknown", {});
    assert.equal(unknownRoute.statusCode, 404);

    console.log("Phase 5 route checks passed.");
} finally {
    await new Promise((resolve) => server.close(resolve));
}
