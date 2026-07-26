const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERCEL_HOST_PATTERN = /.+\.vercel\.app$/;

export function isTrustedPreviewPullRequest(event, repository, expectedSha) {
  return (
    event?.pull_request?.head?.repo?.full_name === repository &&
    event?.pull_request?.head?.sha === expectedSha
  );
}

export function validatePreviewInputs({ repository, sha }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("Preview repository must use the owner/name form");
  }
  if (!SHA_PATTERN.test(sha ?? "")) {
    throw new Error("Preview SHA must be a complete lowercase commit SHA");
  }
}

export function previewDeploymentUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !VERCEL_HOST_PATTERN.test(url.hostname)) {
    return null;
  }
  return url.origin;
}

export function isExactPreviewDeployment(deployment, sha) {
  return (
    deployment?.sha === sha &&
    /^preview(?:\b|$)/i.test(deployment?.environment ?? "")
  );
}

function statusTimestamp(status) {
  const timestamp = Date.parse(status?.created_at ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function successfulExactPreview({ deployments, statuses, sha }) {
  const exact = deployments
    .filter((deployment) => isExactPreviewDeployment(deployment, sha))
    .sort((left, right) => Number(right.id) - Number(left.id));

  for (const deployment of exact) {
    const [latestStatus] = [...(statuses.get(deployment.id) ?? [])].sort(
      (left, right) =>
        statusTimestamp(right) - statusTimestamp(left) ||
        Number(right?.id ?? 0) - Number(left?.id ?? 0),
    );
    if (latestStatus?.state !== "success") continue;
    const url = previewDeploymentUrl(
      latestStatus.environment_url ?? latestStatus.target_url,
    );
    if (url) return { deploymentId: deployment.id, sha, url };
  }
  return null;
}
