import { defineConfig } from "@playwright/test";

const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const defaultPort = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: configuredBaseUrl ?? `http://localhost:${defaultPort}`,
    trace: "on-first-retry",
  },
  webServer: configuredBaseUrl
    ? undefined
    : {
        command: `pnpm exec next start -p ${defaultPort}`,
        port: defaultPort,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
