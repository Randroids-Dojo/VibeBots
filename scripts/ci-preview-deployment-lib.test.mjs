import { describe, expect, test } from "vitest";
import {
  isTrustedPreviewPullRequest,
  previewDeploymentUrl,
  successfulExactPreview,
  validatePreviewInputs,
} from "./ci-preview-deployment-lib.mjs";

const exactSha = "a".repeat(40);
const wrongSha = "b".repeat(40);

describe("preview deployment policy", () => {
  test("permits only an exact-head same-repository pull request", () => {
    const trusted = {
      after: exactSha,
      pull_request: {
        head: {
          sha: exactSha,
          repo: { full_name: "Randroids-Dojo/VibeBots" },
        },
      },
    };
    expect(
      isTrustedPreviewPullRequest(trusted, "Randroids-Dojo/VibeBots", exactSha),
    ).toBe(true);
    expect(
      isTrustedPreviewPullRequest(
        {
          ...trusted,
          pull_request: {
            head: {
              ...trusted.pull_request.head,
              repo: { full_name: "someone/VibeBots" },
            },
          },
        },
        "Randroids-Dojo/VibeBots",
        exactSha,
      ),
    ).toBe(false);
    expect(
      isTrustedPreviewPullRequest(trusted, "Randroids-Dojo/VibeBots", wrongSha),
    ).toBe(false);
  });

  test("refuses a successful deployment for the wrong SHA", () => {
    const deployments = [{ id: 9, sha: wrongSha, environment: "Preview" }];
    const statuses = new Map([
      [
        9,
        [
          {
            state: "success",
            environment_url: "https://wrong-sha.vercel.app",
          },
        ],
      ],
    ]);
    expect(
      successfulExactPreview({ deployments, statuses, sha: exactSha }),
    ).toBe(null);
  });

  test("accepts only a successful exact-SHA Vercel preview URL", () => {
    const deployments = [
      { id: 10, sha: exactSha, environment: "Preview" },
      { id: 9, sha: wrongSha, environment: "Preview" },
    ];
    const statuses = new Map([
      [
        10,
        [
          {
            state: "success",
            environment_url: "https://exact-sha.vercel.app/path",
          },
        ],
      ],
    ]);
    expect(
      successfulExactPreview({ deployments, statuses, sha: exactSha }),
    ).toEqual({
      deploymentId: 10,
      sha: exactSha,
      url: "https://exact-sha.vercel.app",
    });
    expect(previewDeploymentUrl("https://example.com")).toBe(null);
    expect(previewDeploymentUrl("http://exact-sha.vercel.app")).toBe(null);
  });

  test("validates repository and complete commit SHA inputs", () => {
    expect(() =>
      validatePreviewInputs({
        repository: "Randroids-Dojo/VibeBots",
        sha: exactSha,
      }),
    ).not.toThrow();
    expect(() =>
      validatePreviewInputs({ repository: "VibeBots", sha: exactSha }),
    ).toThrow("owner/name");
    expect(() =>
      validatePreviewInputs({
        repository: "Randroids-Dojo/VibeBots",
        sha: "abc123",
      }),
    ).toThrow("complete lowercase commit SHA");
  });
});
