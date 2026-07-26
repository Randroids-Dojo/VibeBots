#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import {
  isExactPreviewDeployment,
  isTrustedPreviewPullRequest,
  successfulExactPreview,
  validatePreviewInputs,
} from "./ci-preview-deployment-lib.mjs";

const MAX_PREVIEW_DEPLOYMENTS = 10;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const repository = argument("--repository", process.env.GITHUB_REPOSITORY);
const sha = argument("--sha");
const timeoutMs = Number(argument("--timeout-ms", "540000"));
const intervalMs = Number(argument("--interval-ms", "10000"));
const token = process.env.GITHUB_TOKEN;

validatePreviewInputs({ repository, sha });
if (!token) throw new Error("GITHUB_TOKEN is required to discover deployments");
if (!process.env.GITHUB_EVENT_PATH) {
  throw new Error("GITHUB_EVENT_PATH is required to validate the pull request");
}
const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
if (!isTrustedPreviewPullRequest(event, repository, sha)) {
  throw new Error(
    "Preview smoke is restricted to the exact head of a same-repository pull request",
  );
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
  throw new Error("Preview timeout must be a positive integer");
}
if (!Number.isInteger(intervalMs) || intervalMs < 1) {
  throw new Error("Preview interval must be a positive integer");
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub deployment request failed with ${response.status}`);
  }
  return response.json();
}

const deadline = Date.now() + timeoutMs;
let lastObserved = "no exact-SHA preview deployment";
while (Date.now() < deadline) {
  const deployments = await github(
    `/repos/${repository}/deployments?sha=${sha}&per_page=100`,
  );
  const exact = deployments
    .filter((deployment) => isExactPreviewDeployment(deployment, sha))
    .sort((left, right) => Number(right.id) - Number(left.id))
    .slice(0, MAX_PREVIEW_DEPLOYMENTS);
  const statuses = new Map();
  for (const deployment of exact) {
    statuses.set(
      deployment.id,
      await github(
        `/repos/${repository}/deployments/${deployment.id}/statuses?per_page=100`,
      ),
    );
  }
  const found = successfulExactPreview({ deployments: exact, statuses, sha });
  if (found) {
    console.log(
      `Found successful preview deployment ${found.deploymentId} for exact SHA ${sha}`,
    );
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `deployment_id=${found.deploymentId}\nsha=${found.sha}\nurl=${found.url}\n`,
      );
    }
    process.exit(0);
  }
  lastObserved = exact.length
    ? `${exact.length} exact-SHA deployment(s), none successful with a Vercel URL`
    : "no exact-SHA preview deployment";
  console.log(`Waiting for ${sha}: ${lastObserved}`);
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

throw new Error(
  `Timed out waiting for a successful Vercel preview for exact SHA ${sha}: ${lastObserved}`,
);
