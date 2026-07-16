import { createHash } from "node:crypto";
import { defineConfig } from "@playwright/test";
import { parseE2EGlobalTimeout } from "./src/lib/playwright-global-timeout";
import { parsePlaywrightWorkerCount } from "./src/lib/playwright-workers";

const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const configuredPort = process.env.PLAYWRIGHT_PORT ?? process.env.PORT;
const configuredWorkers = process.env.PLAYWRIGHT_WORKERS;
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

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  // A whole-suite deadline that ends before the CI job deadline so a slow or
  // hung shard fails (and uploads its report) instead of being cancelled with no
  // evidence (F-131). Unset locally and for Critical E2E, so those run
  // unbounded. The scheduled Full E2E job computes and injects this per shard.
  globalTimeout: parseE2EGlobalTimeout(process.env.E2E_GLOBAL_TIMEOUT_MS),
  fullyParallel: process.env.CI === "true",
  workers: workerCount,
  retries: process.env.CI ? 1 : 0,
  // The JSON reporter gives a bounded machine-readable partial result for a
  // timed-out shard; the HTML report and traces carry the full evidence (F-131).
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { open: "never" }],
        ["json", { outputFile: "playwright-report/results.json" }],
      ]
    : "list",
  use: {
    baseURL: configuredBaseUrl ?? localBaseUrl,
    trace: "on-first-retry",
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
        },
      },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
