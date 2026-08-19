/* Checks the real webhook routes through the Express app. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import app from "../dist/app.js";

const githubBody = JSON.stringify({
    action: "opened",
    number: 42,
    pull_request: {
        title: "Add webhook support",
        head: { ref: "feature/webhooks", sha: "abc123" },
        base: { ref: "main" },
        user: { login: "octocat" },
        html_url: "https://github.com/octocat/hello-world/pull/42",
    },
    repository: {
        full_name: "octocat/hello-world",
        clone_url: "https://github.com/octocat/hello-world.git",
        default_branch: "main",
    },
});
const gitlabBody = JSON.stringify({
    object_attributes: {
        action: "open",
        iid: 42,
        title: "Add webhook support",
        source_branch: "feature/webhooks",
        target_branch: "main",
        last_commit: { id: "def456" },
        url: "https://gitlab.com/octocat/hello-world/-/merge_requests/42",
    },
    user: { username: "octocat" },
    project: {
        path_with_namespace: "octocat/hello-world",
        http_url_to_repo: "https://gitlab.com/octocat/hello-world.git",
        default_branch: "main",
    },
});
const signature =
    "sha256=" + createHmac("sha256", "dev-github-secret").update(githubBody).digest("hex");

function request(server, path, headers, requestBody = githubBody) {
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
        "x-github-event": "pull_request",
        "x-github-delivery": "github-delivery-42",
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(JSON.parse(accepted.body).event.provider, "github");
    assert.equal(JSON.parse(accepted.body).event.eventType, "pull_request");

    const rejected = await request(server, "/webhooks/github", {
        "x-hub-signature-256": "sha256=wrong",
    });
    assert.equal(rejected.statusCode, 401);

    const missingGithubSignature = await request(server, "/webhooks/github", {});
    assert.equal(missingGithubSignature.statusCode, 401);

    const gitlabAccepted = await request(server, "/webhooks/gitlab", {
        "x-gitlab-token": "dev-gitlab-secret",
        "x-gitlab-event": "Merge Request Hook",
        "x-gitlab-event-uuid": "gitlab-delivery-42",
    }, gitlabBody);
    assert.equal(gitlabAccepted.statusCode, 202);
    assert.equal(JSON.parse(gitlabAccepted.body).event.provider, "gitlab");
    assert.equal(JSON.parse(gitlabAccepted.body).event.eventType, "pull_request");

    const gitlabRejected = await request(server, "/webhooks/gitlab", {
        "x-gitlab-token": "wrong-token",
    });
    assert.equal(gitlabRejected.statusCode, 401);

    const missingGitlabToken = await request(server, "/webhooks/gitlab", {});
    assert.equal(missingGitlabToken.statusCode, 401);

    const emptyBody = await request(
        server,
        "/webhooks/github",
        {
            "x-hub-signature-256": signature,
            "x-github-event": "pull_request",
        },
        ""
    );
    assert.equal(emptyBody.statusCode, 400);

    const unknownRoute = await request(server, "/webhooks/unknown", {});
    assert.equal(unknownRoute.statusCode, 404);

    console.log("Phase 5 route checks passed.");
} finally {
    await new Promise((resolve) => server.close(resolve));
}
