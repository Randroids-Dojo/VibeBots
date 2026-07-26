import { expect, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";

const PREVIEW_READY_TIMEOUT_MS = 30_000;

test(
  "preview app shell redirects into the mine",
  ciCase("E2E-PREVIEW-0001", "@functional", ["@preview"]),
  async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/mine$/);
    await expect(page.locator("[data-mine-shell]")).toBeVisible({
      timeout: PREVIEW_READY_TIMEOUT_MS,
    });
  },
);

test(
  "preview publishes the latest release note",
  ciCase("E2E-PREVIEW-0002", "@functional", ["@preview"]),
  async ({ page }) => {
    await page.goto("/mine");
    const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-app-version", /\d+\.\d+\.\d+/);
    await expect(dialog).toHaveAttribute("data-release-note-id", /\S+/);
    await expect(dialog.locator("li")).not.toHaveCount(0);
  },
);

test(
  "preview boots a storage-independent guest mine",
  ciCase("E2E-PREVIEW-0003", "@functional", ["@preview"]),
  async ({ page }) => {
    await page.goto("/mine");
    await expect(page.locator("[data-mine-shell]")).toBeVisible({
      timeout: PREVIEW_READY_TIMEOUT_MS,
    });
    await page.mouse.click(8, 8);
    const status = page.getByLabel("Mine status");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("data-depth", "0");
    await expect(status).toHaveAttribute("data-col", /\d+/);
  },
);

test(
  "preview deterministic probe repeats the same action hash",
  ciCase("E2E-PREVIEW-0004", "@functional", ["@preview"]),
  async ({ request }) => {
    const path = "/api/sim/verify?seed=42&steps=300";
    const first = await request.get(path);
    expect(first.ok()).toBeTruthy();
    const firstResult = await first.json();
    expect(firstResult.hash).toMatch(/^[0-9a-f]{16}$/);
    const second = await request.get(path);
    expect(second.ok()).toBeTruthy();
    expect((await second.json()).hash).toBe(firstResult.hash);
  },
);

test(
  "preview version API reports a no-store release",
  ciCase("E2E-PREVIEW-0005", "@functional", ["@preview"]),
  async ({ request }) => {
    const response = await request.get("/api/version");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect((await response.json()).version).toMatch(/^\d+\.\d+\.\d+/);
  },
);

test(
  "preview serves a static application asset",
  ciCase("E2E-PREVIEW-0006", "@functional", ["@preview"]),
  async ({ request }) => {
    const assetPath = process.env.PREVIEW_STATIC_ASSET_PATH ?? "/icon.svg";
    const response = await request.get(assetPath);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  },
);

test(
  "preview keeps the release notification route protected",
  ciCase("E2E-PREVIEW-0007", "@functional", ["@preview"]),
  async ({ request }) => {
    const response = await request.post("/api/notifications/release");
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  },
);
