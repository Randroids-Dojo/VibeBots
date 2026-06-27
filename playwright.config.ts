import { createHash } from "node:crypto";
import { defineConfig } from "@playwright/test";

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
const workerCount =
  configuredWorkers === undefined
    ? 2
    : /^[1-9]\d*$/.test(configuredWorkers)
      ? Number(configuredWorkers)
      : Number.NaN;

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
  fullyParallel: process.env.CI === "true",
  workers: workerCount,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
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
      },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
