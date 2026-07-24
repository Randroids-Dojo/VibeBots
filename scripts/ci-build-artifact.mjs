#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertCleanCheckout,
  assertSafeExtractionTarget,
  compareBundleOutput,
  directoryBytes,
  sha256File,
  verifyBuildManifest,
} from "./ci-build-artifact-lib.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`);
  return process.argv[index + 1];
}

function required(name) {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  const invocation = [command, ...args].join(" ");
  if (result.error) {
    throw new Error(`Failed to start ${invocation}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(
      `${invocation} exited with status ${result.status ?? "unknown"}`,
    );
  }
}

function resolvePackage(specifier, searchPath) {
  const script = [
    "const path=require('path');",
    `process.stdout.write(require.resolve(${JSON.stringify(specifier)},`,
    searchPath ? `{paths:[${JSON.stringify(searchPath)}]}));` : "{}));",
  ].join("");
  return execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
  });
}

function toolchainMetadata() {
  const playwrightPackagePath = resolvePackage("@playwright/test/package.json");
  const playwrightPath = resolvePackage(
    "playwright/package.json",
    path.dirname(playwrightPackagePath),
  );
  const playwrightCorePath = resolvePackage(
    "playwright-core/package.json",
    path.dirname(playwrightPath),
  );
  const browsers = json(
    path.join(path.dirname(playwrightCorePath), "browsers.json"),
  );
  const chromium = browsers.browsers.find(
    (browser) => browser.name === "chromium",
  );
  if (!chromium) throw new Error("Playwright Chromium metadata is missing");
  const appPackage = json("package.json");
  return {
    node: process.version,
    pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
    next: json(resolvePackage("next/package.json")).version,
    playwright: json(playwrightPackagePath).version,
    chromium: {
      revision: chromium.revision,
      version: chromium.browserVersion,
    },
    packageManager: appPackage.packageManager,
  };
}

function safeArchiveEntries(archive) {
  const listing = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
  });
  const archivePaths = new Set();
  for (const entry of listing.split("\n").filter(Boolean)) {
    const normalized = entry.replace(/^\.\//, "");
    if (
      path.posix.isAbsolute(normalized) ||
      normalized.split("/").includes("..")
    ) {
      throw new Error(`Build artifact contains unsafe path ${entry}`);
    }
    const canonical = path.posix.normalize(normalized).replace(/\/+$/, "");
    if (archivePaths.has(canonical)) {
      throw new Error(`Build artifact repeats path ${entry}`);
    }
    archivePaths.add(canonical);
  }
  const verboseListing = execFileSync("tar", ["-tvzf", archive], {
    encoding: "utf8",
  });
  for (const entry of verboseListing.split("\n").filter(Boolean)) {
    if (!entry.startsWith("-") && !entry.startsWith("d")) {
      throw new Error("Build artifact contains a link or special entry");
    }
  }
}

function manifestFromArchive(archive) {
  return JSON.parse(
    execFileSync("tar", ["-xOzf", archive, "./ci-build-manifest.json"], {
      encoding: "utf8",
    }),
  );
}

function createArtifact() {
  const expectedSha = required("--sha");
  const output = path.resolve(required("--output"));
  const inventoryPath = path.resolve(required("--inventory"));
  const shardPlanPath = path.resolve(required("--shards"));
  const baseline = json(required("--baseline"));
  const runtime = json("ci/browser-runtime/runtime.json");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (head !== expectedSha) {
    throw new Error(
      `Checkout SHA ${head} does not match workflow SHA ${expectedSha}`,
    );
  }
  assertCleanCheckout(
    execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      encoding: "utf8",
    }),
  );
  const startedAtMs = Date.now();
  run("pnpm", ["build"]);
  const finishedAtMs = Date.now();
  const routeStats = json(".next/diagnostics/route-bundle-stats.json");
  const routeManifest = json(".next/app-path-routes-manifest.json");
  const manifest = {
    schemaVersion: 1,
    commitSha: expectedSha,
    dirtyCheckout: false,
    lockfileSha256: sha256File("pnpm-lock.yaml"),
    browserRuntime: {
      imageRepository: runtime.imageRepository,
      imageDigest: runtime.imageDigest,
    },
    toolchain: toolchainMetadata(),
    build: {
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      nextBytes: directoryBytes(".next"),
    },
    routeOutput: {
      count: Object.keys(routeManifest).length,
      routes: Object.values(routeManifest).sort(),
    },
    bundleComparison: compareBundleOutput(routeStats, baseline),
    functionalPlan: {
      inventoryFile: "case-inventory.json",
      shardPlanFile: "functional-shards.json",
      caseCount: json(inventoryPath).summary.capabilities["@functional"],
      shardCount: json(shardPlanPath).shardCount,
    },
    contents: [
      ".next",
      "public",
      "package.json",
      "pnpm-lock.yaml",
      "case-inventory.json",
      "functional-shards.json",
      "ci-build-manifest.json",
    ],
  };
  mkdirSync(path.dirname(output), { recursive: true });
  const staging = mkdtempSync(path.join(os.tmpdir(), "vibebots-ci-build-"));
  try {
    cpSync(".next", path.join(staging, ".next"), {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}.next${path.sep}cache`),
    });
    cpSync("public", path.join(staging, "public"), { recursive: true });
    for (const file of ["package.json", "pnpm-lock.yaml"]) {
      cpSync(file, path.join(staging, file));
    }
    cpSync(inventoryPath, path.join(staging, "case-inventory.json"));
    cpSync(shardPlanPath, path.join(staging, "functional-shards.json"));
    writeFileSync(
      path.join(staging, "ci-build-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    run("tar", ["-czf", output, "-C", staging, "."]);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(
    `Created ${output} for ${expectedSha}; build ${manifest.build.durationMs}ms, ` +
      `${manifest.routeOutput.count} routes`,
  );
}

function verifyArtifact() {
  const archive = path.resolve(required("--archive"));
  const expectedSha = required("--sha");
  const output = path.resolve(required("--extract"));
  assertSafeExtractionTarget(output);
  if (!existsSync(archive))
    throw new Error(`Build artifact ${archive} is missing`);
  safeArchiveEntries(archive);
  const runtime = json("ci/browser-runtime/runtime.json");
  const manifest = verifyBuildManifest(manifestFromArchive(archive), {
    expectedSha,
    lockfileHash: sha256File("pnpm-lock.yaml"),
    imageDigest: runtime.imageDigest,
  });
  const staging = mkdtempSync(
    path.join(os.tmpdir(), "vibebots-ci-build-verify-"),
  );
  try {
    run("tar", ["-xzf", archive, "-C", staging]);
    if (output !== process.cwd()) {
      rmSync(output, { recursive: true, force: true });
      mkdirSync(output, { recursive: true });
    }
    const entries = [
      ".next",
      ...(output === process.cwd() ? [] : ["public"]),
      "case-inventory.json",
      "functional-shards.json",
      "ci-build-manifest.json",
    ];
    for (const entry of entries) {
      const source = path.join(staging, entry);
      const destination = path.join(output, entry);
      rmSync(destination, { recursive: true, force: true });
      cpSync(source, destination, { recursive: true });
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(
    `Verified and extracted build artifact ${manifest.commitSha} to ${output}`,
  );
}

const command = process.argv[2];
if (command === "create") createArtifact();
else if (command === "verify") verifyArtifact();
else throw new Error("Usage: ci-build-artifact.mjs <create|verify> [options]");
