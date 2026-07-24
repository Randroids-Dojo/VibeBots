import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function assertCleanCheckout(status) {
  if (status.trim()) {
    throw new Error(
      `Build artifacts require a clean checkout; dirty paths:\n${status.trim()}`,
    );
  }
}

export function assertSafeExtractionTarget(
  output,
  workspace = process.cwd(),
  tempRoots = [os.tmpdir(), "/tmp"],
) {
  const resolvedOutput = path.resolve(output);
  if (resolvedOutput === path.resolve(workspace)) return;
  const inSafeTempDirectory = tempRoots.some((root) => {
    const relative = path.relative(path.resolve(root), resolvedOutput);
    return (
      relative.length > 0 &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  });
  if (!inSafeTempDirectory) {
    throw new Error(
      "Build artifact extraction target must be the workspace or a temp directory",
    );
  }
}

export function isUnderNextCache(
  source,
  nextCache = path.resolve(".next/cache"),
) {
  const resolvedSource = path.resolve(source);
  const resolvedCache = path.resolve(nextCache);
  return (
    resolvedSource === resolvedCache ||
    resolvedSource.startsWith(`${resolvedCache}${path.sep}`)
  );
}

export function verifyBuildManifest(
  manifest,
  { expectedSha, lockfileHash, imageDigest },
) {
  if (manifest.schemaVersion !== 1) {
    throw new Error("Build manifest must use schema version 1");
  }
  if (manifest.commitSha !== expectedSha) {
    throw new Error(
      `Build artifact SHA ${manifest.commitSha ?? "missing"} does not match workflow SHA ${expectedSha}`,
    );
  }
  if (manifest.lockfileSha256 !== lockfileHash) {
    throw new Error("Build artifact lockfile hash does not match the checkout");
  }
  if (manifest.browserRuntime?.imageDigest !== imageDigest) {
    throw new Error(
      "Build artifact browser image digest does not match runtime.json",
    );
  }
  return manifest;
}

export function compareBundleOutput(routeStats, baseline) {
  if (
    baseline?.schemaVersion !== 1 ||
    typeof baseline.routes !== "object" ||
    baseline.routes === null ||
    Array.isArray(baseline.routes) ||
    !Number.isInteger(baseline.totalFirstLoadUncompressedJsBytes) ||
    baseline.totalFirstLoadUncompressedJsBytes < 0
  ) {
    throw new Error("Bundle baseline must use schema version 1");
  }
  const baselineEntries = Object.entries(baseline.routes);
  if (
    baselineEntries.some(
      ([route, bytes]) => !route || !Number.isInteger(bytes) || bytes < 0,
    ) ||
    baselineEntries.reduce((sum, [, bytes]) => sum + bytes, 0) !==
      baseline.totalFirstLoadUncompressedJsBytes
  ) {
    throw new Error("Bundle baseline contains invalid route byte totals");
  }
  if (!Array.isArray(routeStats)) {
    throw new Error("Bundle diagnostics must be an array");
  }
  const seenRoutes = new Set();
  for (const [index, entry] of routeStats.entries()) {
    if (
      typeof entry?.route !== "string" ||
      entry.route.length === 0 ||
      !Number.isInteger(entry.firstLoadUncompressedJsBytes) ||
      entry.firstLoadUncompressedJsBytes < 0
    ) {
      throw new Error(`Bundle diagnostics entry ${index} is invalid`);
    }
    if (seenRoutes.has(entry.route)) {
      throw new Error(`Bundle diagnostics repeat route ${entry.route}`);
    }
    seenRoutes.add(entry.route);
  }
  const currentRoutes = Object.fromEntries(
    routeStats
      .map((entry) => [entry.route, entry.firstLoadUncompressedJsBytes])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const currentTotal = Object.values(currentRoutes).reduce(
    (sum, bytes) => sum + bytes,
    0,
  );
  const routeNames = [
    ...new Set([
      ...Object.keys(baseline.routes),
      ...Object.keys(currentRoutes),
    ]),
  ].sort();
  return {
    baselineCommit: baseline.sourceCommit,
    baselineTotalFirstLoadUncompressedJsBytes:
      baseline.totalFirstLoadUncompressedJsBytes,
    currentTotalFirstLoadUncompressedJsBytes: currentTotal,
    totalDeltaBytes: currentTotal - baseline.totalFirstLoadUncompressedJsBytes,
    addedRoutes: routeNames.filter(
      (route) => !(route in baseline.routes) && route in currentRoutes,
    ),
    removedRoutes: routeNames.filter(
      (route) => route in baseline.routes && !(route in currentRoutes),
    ),
    routes: Object.fromEntries(
      routeNames.map((route) => [
        route,
        {
          baselineBytes: baseline.routes[route] ?? null,
          currentBytes: currentRoutes[route] ?? null,
          deltaBytes:
            route in baseline.routes && route in currentRoutes
              ? currentRoutes[route] - baseline.routes[route]
              : null,
        },
      ]),
    ),
  };
}

export function directoryBytes(root) {
  let total = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    total += entry.isDirectory()
      ? directoryBytes(candidate)
      : statSync(candidate).size;
  }
  return total;
}
