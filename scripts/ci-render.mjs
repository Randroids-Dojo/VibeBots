#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  acquireRenderLock,
  localDateKey,
  missedDateKeys,
  parseRenderArgs,
  renderEnvironment,
  renderTierStatus,
  scheduledHeartbeatDateKey,
  selectedRenderTiers,
  summarizeTierResults,
} from "./ci-render-lib.mjs";

const TIME_ZONE = "America/Chicago";
const options = parseRenderArgs(process.argv.slice(2));
const sourceRoot = process.cwd();
const renderRoot =
  options.root ??
  path.join(os.homedir(), ".codex", "ci-render", "vibebots-real-render");
const checkout = path.join(renderRoot, "checkout");
const resultsRoot = path.join(renderRoot, "results");
const heartbeatPath = path.join(renderRoot, "heartbeat.json");

function run(command, args, runOptions = {}) {
  const result = spawnSync(command, args, {
    cwd: runOptions.cwd ?? sourceRoot,
    env: runOptions.env ?? process.env,
    encoding: runOptions.capture ? "utf8" : undefined,
    stdio: runOptions.capture ? "pipe" : "inherit",
  });
  if (result.error) {
    throw new Error(`Could not run ${command}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (runOptions.allowFailure) return result;
  if (result.status !== 0) {
    const detail = runOptions.capture
      ? result.stderr?.trim() || result.stdout?.trim() || "no output"
      : `exit ${result.status ?? "unknown"}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function output(command, args, cwd = sourceRoot) {
  return run(command, args, { cwd, capture: true }).stdout.trim();
}

function assertClean(cwd, label) {
  const status = output("git", ["status", "--porcelain"], cwd);
  if (status) {
    throw new Error(`${label} must be clean before a real-render run`);
  }
}

function jsonFile(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

async function environmentFingerprint() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-gpu"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    await page.setContent('<canvas id="fingerprint"></canvas>');
    const graphics = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl =
        canvas?.getContext("webgl2") ?? canvas?.getContext("webgl") ?? null;
      const debug = gl?.getExtension("WEBGL_debug_renderer_info") ?? null;
      return {
        devicePixelRatio: window.devicePixelRatio,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        webgpuExposed: "gpu" in navigator,
        webglVersion: gl ? gl.getParameter(gl.VERSION) : null,
        webglVendor:
          gl && debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        webglRenderer:
          gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      };
    });
    return {
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      osVersion: output("sw_vers", ["-productVersion"]),
      browserVersion: browser.version(),
      ...graphics,
    };
  } finally {
    await browser.close();
  }
}

function prepareCheckout(fullSha) {
  mkdirSync(renderRoot, { recursive: true });
  const created = !existsSync(path.join(checkout, ".git"));
  if (created) {
    const remote = output("git", ["config", "--get", "remote.origin.url"]);
    run("git", ["clone", "--no-checkout", remote, checkout]);
  }
  if (!created) {
    assertClean(checkout, "Dedicated render checkout");
  }
  run("git", ["fetch", "--prune", "origin", "main"], { cwd: checkout });
  run("git", ["fetch", sourceRoot, fullSha], { cwd: checkout });
  run("git", ["switch", "--detach", fullSha], { cwd: checkout });
  assertClean(checkout, "Dedicated render checkout");
  const resolved = output("git", ["rev-parse", "HEAD"], checkout);
  if (resolved !== fullSha) {
    throw new Error(
      `Dedicated checkout resolved ${resolved}, expected ${fullSha}`,
    );
  }
  const secretFiles = [
    ".env",
    ".env.local",
    ".env.development.local",
    ".env.production.local",
    ".env.test.local",
  ].filter((file) => existsSync(path.join(checkout, file)));
  if (secretFiles.length > 0) {
    throw new Error(
      `Dedicated render checkout contains forbidden env files: ${secretFiles.join(", ")}`,
    );
  }
}

function runTier(tier, fullSha, resultDirectory, baseEnv) {
  const reportDirectory = path.join(resultDirectory, tier);
  mkdirSync(reportDirectory, { recursive: true });
  const startedAt = new Date();
  const testResult = run(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--grep",
      `@${tier}`,
      "--project=chromium",
      "--workers=1",
    ],
    {
      cwd: checkout,
      env: {
        ...baseEnv,
        CI: "true",
        CI_CASE_COMMIT_SHA: fullSha,
        CI_CASE_RESULTS_PATH: path.join(
          reportDirectory,
          "ci-case-results.json",
        ),
        CI_REPRO_REPORT_DIR: reportDirectory,
        PLAYWRIGHT_PORT: String(32_000 + (process.pid % 20_000)),
      },
      allowFailure: true,
    },
  );
  const records =
    jsonFile(path.join(reportDirectory, "ci-case-results.json"), {}).records ??
    [];
  const status = renderTierStatus(
    testResult.status,
    records.map((record) => record.outcome),
  );
  return {
    tier,
    status,
    exitCode: testResult.status,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    attemptCount: records.length,
    observedCaseIds: [
      ...new Set(records.map((record) => record.caseId)),
    ].sort(),
    reportDirectory,
  };
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("ci:render requires the development Mac");
  }

  mkdirSync(renderRoot, { recursive: true });
  const releaseLock = acquireRenderLock(path.join(renderRoot, "runner.lock"));
  // Setup runs inside the result-building try so a failure to resolve, clean,
  // or fetch still publishes a bounded failure record. A run that produces no
  // evidence at all is indistinguishable from a run that never started.
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replaceAll(":", "-");
  const dateKey = localDateKey(startedAt, TIME_ZONE);
  const source = options.scheduled ? "scheduled" : "manual";
  let fullSha = options.sha;
  let missedWindows = [];
  let resultDirectory = path.join(resultsRoot, "unresolved", stamp);
  try {
    let result;
    try {
      assertClean(sourceRoot, "Source checkout");
      run("git", ["fetch", "--prune", "origin", "main"]);
      fullSha = output("git", ["rev-parse", `${options.sha}^{commit}`]);
      if (options.scheduled) {
        const ancestry = run(
          "git",
          ["merge-base", "--is-ancestor", fullSha, "origin/main"],
          { allowFailure: true, capture: true },
        );
        if (ancestry.status !== 0) {
          throw new Error(
            "Scheduled render SHA must be contained in origin/main",
          );
        }
      }

      const priorHeartbeat = jsonFile(heartbeatPath, {});
      const previousScheduledDate = scheduledHeartbeatDateKey(priorHeartbeat);
      missedWindows = options.scheduled
        ? missedDateKeys(previousScheduledDate, dateKey)
        : [];
      resultDirectory = path.join(resultsRoot, fullSha, stamp);

      prepareCheckout(fullSha);
      const baseEnv = renderEnvironment(process.env);
      run("pnpm", ["install", "--frozen-lockfile"], {
        cwd: checkout,
        env: baseEnv,
      });
      run("pnpm", ["build"], { cwd: checkout, env: baseEnv });
      run("pnpm", ["exec", "playwright", "install", "chromium"], {
        cwd: checkout,
        env: baseEnv,
      });
      const fingerprint = await environmentFingerprint();
      const tiers = selectedRenderTiers(options.tier).map((tier) =>
        runTier(tier, fullSha, resultDirectory, baseEnv),
      );
      result = {
        schemaVersion: 1,
        commitSha: fullSha,
        source,
        status: summarizeTierResults(tiers),
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        timeZone: TIME_ZONE,
        dateKey,
        missedWindows,
        caughtUp: options.scheduled && missedWindows.length > 0,
        fingerprint,
        tiers,
      };
    } catch (error) {
      result = {
        schemaVersion: 1,
        commitSha: fullSha,
        source,
        status: "failure",
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        timeZone: TIME_ZONE,
        dateKey,
        missedWindows,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    mkdirSync(resultDirectory, { recursive: true });
    const resultPath = path.join(resultDirectory, "result.json");
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    if (options.scheduled) {
      writeFileSync(heartbeatPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    cpSync(resultPath, path.join(renderRoot, "latest.json"));
    console.log(`Real-render result: ${resultPath}`);
    console.log(`Commit: ${fullSha}`);
    console.log(`Status: ${result.status}`);
    if (result.missedWindows?.length) {
      console.log(`Missed windows: ${result.missedWindows.join(", ")}`);
    }
    if (result.status === "failure") process.exitCode = 1;
  } finally {
    releaseLock();
  }
}

await main();
