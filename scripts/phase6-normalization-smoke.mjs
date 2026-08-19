import assert from "node:assert/strict";
import { GitHubAdapter } from "../dist/adapters/GitHubAdapter.js";
import { GitLabAdapter } from "../dist/adapters/GitLabAdapter.js";

const github = new GitHubAdapter();
const gitlab = new GitLabAdapter();

const githubEvent = github.normalize(
    {
        action: "synchronize",
        number: 7,
        pull_request: {
            title: "Update dependencies",
            head: { ref: "deps", sha: "github-sha" },
            base: { ref: "main" },
            user: { login: "octocat" },
            html_url: "https://github.com/octocat/repo/pull/7",
        },
        repository: {
            full_name: "octocat/repo",
            clone_url: "https://github.com/octocat/repo.git",
            default_branch: "main",
        },
    },
    {
        "x-github-event": "pull_request",
        "x-github-delivery": "github-7",
    }
);

assert.deepEqual(
    {
        provider: githubEvent.provider,
        eventType: githubEvent.eventType,
        action: githubEvent.action,
        deliveryId: githubEvent.deliveryId,
        sourceBranch: githubEvent.sourceBranch,
        targetBranch: githubEvent.targetBranch,
        headSha: githubEvent.headSha,
    },
    {
        provider: "github",
        eventType: "pull_request",
        action: "synchronize",
        deliveryId: "github-7",
        sourceBranch: "deps",
        targetBranch: "main",
        headSha: "github-sha",
    }
);

const gitlabEvent = gitlab.normalize(
    {
        object_attributes: {
            action: "update",
            iid: 8,
            title: "Fix pipeline",
            source_branch: "fix-pipeline",
            target_branch: "main",
            last_commit: { id: "gitlab-sha" },
            url: "https://gitlab.com/octocat/repo/-/merge_requests/8",
        },
        user: { username: "octocat" },
        project: {
            path_with_namespace: "octocat/repo",
            http_url_to_repo: "https://gitlab.com/octocat/repo.git",
            default_branch: "main",
        },
    },
    {
        "x-gitlab-event": "Merge Request Hook",
        "x-gitlab-event-uuid": "gitlab-8",
    }
);

assert.deepEqual(
    {
        provider: gitlabEvent.provider,
        eventType: gitlabEvent.eventType,
        action: gitlabEvent.action,
        deliveryId: gitlabEvent.deliveryId,
        sourceBranch: gitlabEvent.sourceBranch,
        targetBranch: gitlabEvent.targetBranch,
        headSha: gitlabEvent.headSha,
    },
    {
        provider: "gitlab",
        eventType: "pull_request",
        action: "synchronize",
        deliveryId: "gitlab-8",
        sourceBranch: "fix-pipeline",
        targetBranch: "main",
        headSha: "gitlab-sha",
    }
);

console.log("Phase 6 normalization checks passed.");