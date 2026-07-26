import { createHash } from "node:crypto";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import { parseE2EGlobalTimeout } from "./src/lib/playwright-global-timeout";
import { parsePlaywrightWorkerCount } from "./src/lib/playwright-workers";

const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const configuredPort = process.env.PLAYWRIGHT_PORT ?? process.env.PORT;
const configuredWorkers = process.env.PLAYWRIGHT_WORKERS;
const ciCaseResultsPath = process.env.CI_CASE_RESULTS_PATH;
const reproReportDirectory = process.env.CI_REPRO_REPORT_DIR;
const previewSmoke = process.env.CI_PREVIEW_SMOKE === "1";
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
let previewExtraHTTPHeaders: Record<string, string> | undefined;
const defaultPort =
  3100 +
  (Number.parseInt(
    createHash("sha256").update(process.cwd()).digest("hex").slice(0, 6),
    16,
  ) %
    3000);
const localPort = Number(configuredPort ?? defaultPort);
const localHost = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const localBaseUrl = `http://${localHost}:${localPort}`;
const workerCount = parsePlaywrightWorkerCount(configuredWorkers);
const ciReporters: (readonly [string] | readonly [string, unknown])[] = [
  ["list"],
  [
    "html",
    {
      open: "never",
      outputFolder: reproReportDirectory
        ? path.join(reproReportDirectory, "html")
        : "playwright-report",
    },
  ],
  [
    "json",
    {
      outputFile: reproReportDirectory
        ? path.join(reproReportDirectory, "results.json")
        : "playwright-report/results.json",
    },
  ],
];
if (ciCaseResultsPath) {
  ciReporters.push([
    "./tests/e2e/support/ci-case-reporter.ts",
    { outputFile: ciCaseResultsPath },
  ]);
}

if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
  throw new Error(
    `Invalid Playwright port "${configuredPort}". Use PLAYWRIGHT_PORT or PORT with a valid TCP port.`,
  );
}

if (!Number.isInteger(workerCount) || workerCount < 1) {
  throw new Error(
    `Invalid Playwright worker count "${configuredWorkers}". Use PLAYWRIGHT_WORKERS with a positive integer.`,
  );
}

if (previewSmoke && !previewBypassSecret) {
  throw new Error(
    "VERCEL_AUTOMATION_BYPASS_SECRET is required for preview smoke",
  );
}
if (previewSmoke && !configuredBaseUrl) {
  throw new Error("PLAYWRIGHT_BASE_URL is required for preview smoke");
}
if (previewSmoke && previewBypassSecret) {
  previewExtraHTTPHeaders = {
    "x-vercel-protection-bypass": previewBypassSecret,
    "x-vercel-set-bypass-cookie": "true",
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  // The per-test cap stays at 60s. Raising it to 120s on CI was measured to
  // backfire: a few slow-but-correct software renders passed, but the two
  // shards holding clusters of slow tests then let each linger to 120s and
  // ran past the 35-minute shard budget into a global timeout, re-masking
  // their real results. Keeping 60s means every shard completes; the handful
  // of genuinely-slow renders stay with F-132 (per-test or more-shards work),
  // where the fix does not risk timing out a whole shard.
  timeout: 60_000,
  // A whole-suite deadline that ends before the CI job deadline so a slow or
  // hung shard fails (and uploads its report) instead of being cancelled with no
  // evidence (F-131). Unset locally and for Critical E2E, so those run
  // unbounded. The scheduled Full E2E job computes and injects this per shard.
  globalTimeout: parseE2EGlobalTimeout(process.env.E2E_GLOBAL_TIMEOUT_MS),
  fullyParallel: process.env.CI === "true",
  workers: workerCount,
  retries: previewSmoke ? 0 : process.env.CI ? 1 : 0,
  // The JSON reporter gives a bounded machine-readable partial result for a
  // timed-out shard; the HTML report and traces carry the full evidence (F-131).
  reporter: process.env.CI ? ciReporters : "list",
  outputDir: reproReportDirectory
    ? path.join(reproReportDirectory, "test-results")
    : "test-results",
  use: {
    baseURL: configuredBaseUrl ?? localBaseUrl,
    // Trace is captured on the retry of a failed test; a screenshot is captured
    // at the moment of failure on the FIRST attempt too, so a shard that fails
    // (including one stopped by the F-131 global deadline) leaves per-test
    // evidence without the whole-suite cost of tracing every test. A test still
    // mid-run when the global deadline interrupts it may have neither, which is
    // an inherent limit of a hard whole-suite stop, not something a trace mode
    // can guarantee.
    trace: previewSmoke ? "off" : "on-first-retry",
    screenshot: "only-on-failure",
    ...(previewExtraHTTPHeaders
      ? { extraHTTPHeaders: previewExtraHTTPHeaders }
      : {}),
  },
  webServer: configuredBaseUrl
    ? undefined
    : {
        command: `pnpm exec next start -H ${localHost} -p ${localPort}`,
        url: localBaseUrl,
        reuseExistingServer: false,
        timeout: 120_000,
        // The managed server always starts storage-off so a checkout with
        // a real .env.local produces the same results as CI, where none of
        // these secrets exist (F-048: guest saves served from Postgres made
        // the workshop suite diverge locally). Blank strings beat Next's
        // env-file loading because Next never overrides variables that are
        // already set. To test against real storage, start your own server
        // and point PLAYWRIGHT_BASE_URL at it.
        env: {
          DATABASE_URL: "",
          AUTH_SECRET: "",
          VAPID_PUBLIC_KEY: "",
          VAPID_PRIVATE_KEY: "",
          WEB_PUSH_CONTACT_EMAIL: "",
          CLERK_SECRET_KEY: "",
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
          VIBEBOTS_E2E_MODE: "1",
        },
      },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // Chromium launch args:
        // - On CI, --disable-dev-shm-usage: the runner's /dev/shm is small, and
        //   the SwiftShader software renderer exhausts it and crashes the GPU
        //   process under the 3D scenes; writing shared memory to /tmp instead
        //   trades a little speed for stability (this was crashing shards).
        // - E2E_SOFTWARE_GL forces the SwiftShader path locally so the CI-only
        //   software-rendering behavior can be reproduced and fixed without a
        //   30-minute dispatch (F-132). Off by default.
        ...(() => {
          const args = [
            ...(process.env.CI ? ["--disable-dev-shm-usage"] : []),
            ...(process.env.E2E_SOFTWARE_GL
              ? ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu"]
              : []),
          ];
          return args.length ? { launchOptions: { args } } : {};
        })(),
      },
    },
  ],
});
