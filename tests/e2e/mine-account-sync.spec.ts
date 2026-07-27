import { expect, test } from "@playwright/test";
import { MINE_VERSION } from "../../src/sim/mine";
import { FRESHNESS_PROBE_MIN_INTERVAL_MS } from "../../src/state/mine-store";
import { ciCase } from "./support/ci-case";
import {
  createMine,
  DEFAULT_GEAR,
  dismissReleaseNotes,
  exportDiff,
  installGamepadBackControl,
  openSettings,
  pressGamepadBack,
  STARTING_CONSUMABLES,
} from "./support/mine-helpers";

const saveSummary = {
  exists: true,
  createdAt: "2026-07-04T00:00:00.000Z",
  balance: 12,
  deepestDepth: 8,
  partsOwned: 3,
  designs: 1,
  stamps: 2,
};

const cloudSummary = {
  exists: true,
  createdAt: "2026-07-03T00:00:00.000Z",
  balance: 42,
  deepestDepth: 30,
  partsOwned: 9,
  designs: 4,
  stamps: 5,
};

test(
  "fresh guest play stays account-free until the Account dialog is opened",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0001", "@functional"),
  async ({ page }) => {
    const mine = createMine(4141, DEFAULT_GEAR, STARTING_CONSUMABLES);
    let accountStatusRequests = 0;

    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 4141,
          tripIndex: 0,
          diff: exportDiff(mine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 12,
          playerLevel: 1,
          deepestDepth: 8,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/account/status", async (route) => {
      accountStatusRequests += 1;
      await route.fulfill({
        status: 500,
        body: "{}",
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);

    await expect(page.locator("canvas")).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Account" }),
    ).not.toBeVisible();
    await expect(page.getByText("Sign in with Google")).not.toBeVisible();
    await expect(page.getByText("Google sign-in pending")).not.toBeVisible();
    expect(accountStatusRequests).toBe(0);
  },
);

test(
  "mine account deep link opens the account dialog without sign-in",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0002", "@functional"),
  async ({ page }) => {
    const mine = createMine(4444, DEFAULT_GEAR, STARTING_CONSUMABLES);

    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 4444,
          tripIndex: 0,
          diff: exportDiff(mine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 12,
          playerLevel: 1,
          deepestDepth: 8,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/account/status", async (route) => {
      await route.fulfill({
        json: {
          mode: "guest",
          activeSlot: 1,
          account: null,
          currentSave: saveSummary,
          accountSave: null,
        },
      });
    });

    await page.goto("/mine?account=1");
    await dismissReleaseNotes(page);

    const account = page.getByRole("dialog", { name: "Account" });
    await expect(account).toBeVisible();
    await expect(account).toContainText("Guest save is local to this device.");
    await expect(account).toContainText("12 vibes");
    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .not.toContain("account=1");
  },
);

test(
  "mine account fallback checks account before creating a guest world",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0003", "@functional"),
  async ({ page }) => {
    const cloudMine = createMine(5151, DEFAULT_GEAR, STARTING_CONSUMABLES);
    const requestOrder: string[] = [];

    await page.route("**/api/account/status", async (route) => {
      requestOrder.push("account-status");
      await route.fulfill({
        json: {
          mode: "cloud_loaded",
          activeSlot: 1,
          providerStatus: {
            provider: "clerk",
            ready: true,
            reason: null,
            issues: [],
          },
          account: { provider: "clerk", email: "pilot@example.com" },
          currentSave: cloudSummary,
          accountSave: cloudSummary,
        },
      });
    });
    await page.route("**/api/mine/world", async (route) => {
      requestOrder.push("mine-world");
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 5151,
          tripIndex: 4,
          diff: exportDiff(cloudMine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 42,
          playerLevel: 3,
          deepestDepth: 30,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });

    await page.goto("/mine?account=1");
    await dismissReleaseNotes(page);

    await expect
      .poll(() => requestOrder.slice(0, 2))
      .toEqual(["account-status", "mine-world"]);
    const account = page.getByRole("dialog", { name: "Account" });
    await expect(account).toBeVisible();
    await expect(account).toContainText("Cloud save loaded.");
    await expect(account).toContainText("pilot@example.com");
    await expect(account).toContainText("42 vibes");
  },
);

test(
  "mine account dialog dismisses from outside tap, Escape, and gamepad back",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0004", "@functional"),
  async ({ page }) => {
    await installGamepadBackControl(page);
    const mine = createMine(4545, DEFAULT_GEAR, STARTING_CONSUMABLES);

    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 4545,
          tripIndex: 0,
          diff: exportDiff(mine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 12,
          playerLevel: 1,
          deepestDepth: 8,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/account/status", async (route) => {
      await route.fulfill({
        json: {
          mode: "guest",
          activeSlot: 1,
          account: null,
          currentSave: saveSummary,
          accountSave: null,
        },
      });
    });

    await page.goto("/mine?account=1");
    await dismissReleaseNotes(page);

    const account = page.getByRole("dialog", { name: "Account" });
    await expect(account).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(account).not.toBeVisible();

    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Account" }).click();
    await expect(account).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(account).not.toBeVisible();

    const settingsAgain = await openSettings(page);
    await settingsAgain.getByRole("button", { name: "Account" }).click();
    await expect(account).toBeVisible();
    await pressGamepadBack(page);
    await expect(account).not.toBeVisible();
  },
);

test(
  "mine account handoff return finishes and clears the callback query",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0005", "@functional"),
  async ({ page }) => {
    const mine = createMine(4242, DEFAULT_GEAR, STARTING_CONSUMABLES);
    let finishRequests = 0;

    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 4242,
          tripIndex: 0,
          diff: exportDiff(mine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 12,
          playerLevel: 1,
          deepestDepth: 8,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/account/status", async (route) => {
      await route.fulfill({
        json: {
          mode: "cloud_loaded",
          activeSlot: 1,
          account: { provider: "clerk", email: "pilot@example.com" },
          currentSave: saveSummary,
          accountSave: saveSummary,
        },
      });
    });
    await page.route("**/api/save-slots", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              ...saveSummary,
            },
          ],
        },
      });
    });
    await page.route("**/api/account/handoff/finish", async (route) => {
      finishRequests += 1;
      expect(route.request().postDataJSON()).toEqual({
        handoffId: "handoff-1",
      });
      await route.fulfill({
        json: {
          mode: "cloud_loaded",
          result: "claimed",
          activeSlot: 1,
          returnTo: "/mine",
          accountSave: saveSummary,
        },
      });
    });

    await page.goto("/mine?accountHandoff=handoff-1");
    await dismissReleaseNotes(page);

    await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
    await expect(page.getByText("Cloud save loaded.")).toBeVisible();
    await expect(page.getByText("pilot@example.com")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .not.toContain("accountHandoff");
    expect(finishRequests).toBe(1);
  },
);

test(
  "mine account handoff retries when Clerk session settles late",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0006", "@functional"),
  async ({ page }) => {
    const mine = createMine(4243, DEFAULT_GEAR, STARTING_CONSUMABLES);
    let finishRequests = 0;

    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 4243,
          tripIndex: 0,
          diff: exportDiff(mine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 12,
          playerLevel: 1,
          deepestDepth: 8,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/account/status", async (route) => {
      await route.fulfill({
        json:
          finishRequests >= 2
            ? {
                mode: "cloud_loaded",
                activeSlot: 1,
                account: { provider: "clerk", email: "pilot@example.com" },
                currentSave: saveSummary,
                accountSave: saveSummary,
              }
            : {
                mode: "guest",
                activeSlot: 1,
                account: null,
                currentSave: saveSummary,
                accountSave: null,
              },
      });
    });
    await page.route("**/api/save-slots", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [{ slot: 1, active: true, ...saveSummary }],
        },
      });
    });
    await page.route("**/api/account/handoff/finish", async (route) => {
      finishRequests += 1;
      if (finishRequests === 1) {
        await route.fulfill({
          status: 401,
          json: { error: "account sign-in required" },
        });
        return;
      }
      await route.fulfill({
        json: {
          mode: "cloud_loaded",
          result: "claimed",
          activeSlot: 1,
          returnTo: "/mine",
          accountSave: saveSummary,
        },
      });
    });

    await page.goto("/mine?accountHandoff=handoff-late");
    await dismissReleaseNotes(page);

    await expect
      .poll(() => finishRequests, { timeout: 15000 })
      .toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();
    await expect(page.getByText("Cloud save loaded.")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .not.toContain("accountHandoff");
  },
);

test(
  "mine account signed-in device save claims to cloud from the dialog",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0007", "@functional"),
  async ({ page }) => {
    const mine = createMine(4244, DEFAULT_GEAR, STARTING_CONSUMABLES);
    let claimRequests = 0;

    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 4244,
          tripIndex: 0,
          diff: exportDiff(mine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 12,
          playerLevel: 1,
          deepestDepth: 8,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/account/status", async (route) => {
      await route.fulfill({
        json:
          claimRequests > 0
            ? {
                mode: "cloud_loaded",
                activeSlot: 1,
                account: { provider: "clerk", email: "pilot@example.com" },
                currentSave: saveSummary,
                accountSave: saveSummary,
              }
            : {
                mode: "signed_in",
                activeSlot: 1,
                account: { provider: "clerk", email: "pilot@example.com" },
                currentSave: saveSummary,
                accountSave: null,
              },
      });
    });
    await page.route("**/api/account/trip", async (route) => {
      await route.fulfill({ json: { stored: true } });
    });
    await page.route("**/api/account/claim", async (route) => {
      claimRequests += 1;
      await route.fulfill({
        json: {
          mode: "cloud_loaded",
          result: "claimed",
          accountSave: saveSummary,
        },
      });
    });
    await page.route("**/api/save-slots", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [{ slot: 1, active: true, ...saveSummary }],
        },
      });
    });

    await page.goto("/mine?account=1");
    await dismissReleaseNotes(page);

    const account = page.getByRole("dialog", { name: "Account" });
    await expect(account).toBeVisible();
    await expect(account).toContainText("Ready to save this run.");
    // Claiming is an explicit choice (the review hardening removed
    // auto-claim); nothing is claimed until the player clicks.
    expect(claimRequests).toBe(0);

    await account.getByRole("button", { name: "Save this run" }).click();

    await expect.poll(() => claimRequests).toBe(1);
    await expect(account).toContainText("Cloud save loaded.");
    await expect(account).toContainText("pilot@example.com");
  },
);

test(
  "mine account handoff conflict shows the cloud-save choice",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0008", "@functional"),
  async ({ page }) => {
    const mine = createMine(4343, DEFAULT_GEAR, STARTING_CONSUMABLES);
    let finishRequests = 0;
    let statusRequests = 0;
    let loadRequests = 0;

    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 4343,
          tripIndex: 0,
          diff: exportDiff(mine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 12,
          playerLevel: 1,
          deepestDepth: 8,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/account/status", async (route) => {
      statusRequests += 1;
      await route.fulfill({
        json: {
          mode: "conflict",
          activeSlot: 1,
          account: { provider: "clerk", email: "pilot@example.com" },
          currentSave: saveSummary,
          accountSave: cloudSummary,
        },
      });
    });
    await page.route("**/api/account/handoff/finish", async (route) => {
      finishRequests += 1;
      expect(route.request().postDataJSON()).toEqual({
        handoffId: "handoff-conflict",
      });
      await route.fulfill({
        status: 409,
        json: {
          error: "account already has a cloud save",
          code: "account_cloud_save_exists",
          mode: "conflict",
          returnTo: "/mine",
          accountSave: cloudSummary,
        },
      });
    });
    await page.route("**/api/account/load", async (route) => {
      loadRequests += 1;
      await route.fulfill({ status: 500, body: "{}" });
    });

    await page.goto("/mine?accountHandoff=handoff-conflict");
    await dismissReleaseNotes(page);

    const account = page.getByRole("dialog", { name: "Account" });
    await expect(account).toBeVisible();
    await expect(account).toContainText("Choose which save to use.");
    await expect(account).toContainText("pilot@example.com");
    await expect(account).toContainText("12 vibes");
    await expect(account).toContainText("42 vibes");
    await expect(
      account.getByRole("button", { name: "Load cloud save" }),
    ).toBeEnabled();
    await expect(
      account.getByRole("button", { name: "Keep this device save" }),
    ).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.location.search))
      .not.toContain("accountHandoff");
    await account
      .getByRole("button", { name: "Keep this device save" })
      .click();
    await expect(account).not.toBeVisible();
    expect(finishRequests).toBe(1);
    expect(statusRequests).toBeGreaterThanOrEqual(1);
    expect(loadRequests).toBe(0);
  },
);

test(
  "mine account conflict loads the cloud save only after player choice",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0009", "@functional"),
  async ({ page }) => {
    const localMine = createMine(4444, DEFAULT_GEAR, STARTING_CONSUMABLES);
    const cloudMine = createMine(5555, DEFAULT_GEAR, STARTING_CONSUMABLES);
    let loadRequests = 0;
    let worldRequests = 0;
    let gearRequests = 0;
    let statusRequests = 0;
    let tripRequests = 0;

    await page.route("**/api/mine/world", async (route) => {
      worldRequests += 1;
      await route.fulfill({
        json:
          loadRequests > 0
            ? {
                activeSlot: 1,
                seed: 5555,
                tripIndex: 6,
                diff: exportDiff(cloudMine),
              }
            : {
                activeSlot: 1,
                seed: 4444,
                tripIndex: 0,
                diff: exportDiff(localMine),
              },
      });
    });
    await page.route("**/api/gear", async (route) => {
      gearRequests += 1;
      await route.fulfill({
        json:
          loadRequests > 0
            ? {
                gear: { ...DEFAULT_GEAR, pickaxe: 2 },
                consumables: STARTING_CONSUMABLES,
                balance: 42,
                playerLevel: 1,
                deepestDepth: 30,
              }
            : {
                gear: DEFAULT_GEAR,
                consumables: STARTING_CONSUMABLES,
                balance: 12,
                playerLevel: 1,
                deepestDepth: 8,
              },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/account/status", async (route) => {
      statusRequests += 1;
      await route.fulfill({
        json:
          loadRequests > 0
            ? {
                mode: "cloud_loaded",
                activeSlot: 1,
                providerStatus: {
                  provider: "clerk",
                  ready: true,
                  reason: null,
                  issues: [],
                },
                account: { provider: "clerk", email: "pilot@example.com" },
                currentSave: cloudSummary,
                accountSave: cloudSummary,
              }
            : {
                mode: "conflict",
                activeSlot: 1,
                providerStatus: {
                  provider: "clerk",
                  ready: true,
                  reason: null,
                  issues: [],
                },
                account: { provider: "clerk", email: "pilot@example.com" },
                currentSave: saveSummary,
                accountSave: cloudSummary,
              },
      });
    });
    await page.route("**/api/account/load", async (route) => {
      loadRequests += 1;
      await route.fulfill({
        json: {
          mode: "cloud_loaded",
          activeSlot: 1,
          accountSave: cloudSummary,
        },
      });
    });
    await page.route("**/api/account/trip", async (route) => {
      tripRequests += 1;
      await route.fulfill({
        json: {
          trip: {
            mineVersion: MINE_VERSION,
            seed: 5555,
            tripIndex: 6,
            gear: { ...DEFAULT_GEAR, pickaxe: 2 },
            consumables: STARTING_CONSUMABLES,
            baseDiff: exportDiff(cloudMine),
            moves: ["down"],
          },
        },
      });
    });
    await page.route("**/api/save-slots", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              ...(loadRequests > 0 ? cloudSummary : saveSummary),
            },
          ],
        },
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Account" }).click();

    const account = page.getByRole("dialog", { name: "Account" });
    await expect(account).toBeVisible();
    await expect(account).toContainText("Choose which save to use.");
    expect(loadRequests).toBe(0);

    await account.getByRole("button", { name: "Load cloud save" }).click();

    await expect(account).not.toBeVisible();
    await expect.poll(() => loadRequests).toBe(1);
    await expect.poll(() => tripRequests).toBe(1);
    await expect.poll(() => worldRequests).toBeGreaterThanOrEqual(2);
    await expect.poll(() => gearRequests).toBeGreaterThanOrEqual(2);

    const reopenedSettings = await openSettings(page);
    await reopenedSettings.getByRole("button", { name: "Account" }).click();
    const reopenedAccount = page.getByRole("dialog", { name: "Account" });
    await expect(reopenedAccount).toBeVisible();
    await expect(reopenedAccount).toContainText("Cloud save loaded.");
    await expect(reopenedAccount).toContainText("pilot@example.com");
    await expect(reopenedAccount).toContainText("42 vibes");
    expect(statusRequests).toBeGreaterThanOrEqual(2);
  },
);

test(
  "mine warns when the cloud save advances on another device",
  ciCase("E2E-MINE-ACCOUNT-SYNC-0010", "@functional"),
  async ({ page }) => {
    const mine = createMine(4646, DEFAULT_GEAR, STARTING_CONSUMABLES);
    let worldRequests = 0;
    let versionRequests = 0;
    let staleVersion = false;

    await page.route("**/api/mine/world/version", async (route) => {
      versionRequests += 1;
      await route.fulfill({
        json: { world: { seed: 4646, tripCount: staleVersion ? 1 : 0 } },
      });
    });
    await page.route("**/api/mine/world", async (route) => {
      worldRequests += 1;
      await route.fulfill({
        json: {
          activeSlot: 1,
          seed: 4646,
          tripIndex: staleVersion ? 1 : 0,
          diff: exportDiff(mine),
        },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 12,
          playerLevel: 1,
          deepestDepth: 8,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/save-slots", async (route) => {
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [{ slot: 1, active: true, ...saveSummary }],
        },
      });
    });
    await page.route("**/api/account/trip", async (route) => {
      await route.fulfill({ json: { trip: null } });
    });
    await page.route("**/api/account/status", async (route) => {
      await route.fulfill({
        json: {
          mode: "cloud_loaded",
          activeSlot: 1,
          providerStatus: {
            provider: "clerk",
            ready: true,
            reason: null,
            issues: [],
          },
          account: { provider: "clerk", email: "pilot@example.com" },
          currentSave: saveSummary,
          accountSave: saveSummary,
        },
      });
    });

    // Let the test skew Date.now so the probe throttle can be stepped past
    // without burning real wall-clock time.
    await page.addInitScript(() => {
      const realNow = Date.now.bind(Date);
      const clocked = window as unknown as { __vbClockOffsetMs?: number };
      Date.now = () => realNow() + (clocked.__vbClockOffsetMs ?? 0);
    });

    await page.goto("/mine?account=1");
    await dismissReleaseNotes(page);
    const account = page.getByRole("dialog", { name: "Account" });
    await expect(account).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(account).not.toBeVisible();

    // Dig one real move so this device holds progress worth prompting over.
    await page.keyboard.press("ArrowDown");
    // The first-move probe must finish before the stale flip; a probe still
    // in flight would swallow the forced focus probe via the in-flight guard.
    await expect.poll(() => versionRequests).toBeGreaterThanOrEqual(1);

    const conflict = page.getByRole("dialog", {
      name: "Save updated on another device",
    });
    await expect(conflict).not.toBeVisible();

    // Step past the probe throttle before the other device's bank becomes
    // visible.
    await page.evaluate((offsetMs) => {
      (window as unknown as { __vbClockOffsetMs?: number }).__vbClockOffsetMs =
        offsetMs;
    }, FRESHNESS_PROBE_MIN_INTERVAL_MS + 1_000);
    staleVersion = true;
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });

    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText("cannot be merged");

    await conflict
      .getByRole("button", { name: "Sync now (discard this run)" })
      .click();
    await expect(conflict).not.toBeVisible();
    await expect.poll(() => worldRequests).toBeGreaterThanOrEqual(2);
  },
);
