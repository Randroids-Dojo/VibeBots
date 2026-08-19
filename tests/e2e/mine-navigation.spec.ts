import { expect, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";
import {
  bypassMineRenderer,
  createMine,
  DEFAULT_GEAR,
  dismissReleaseNotes,
  enterBuilding,
  expectSurfacePromptBottomClearance,
  exportDiff,
  openSettings,
  openStall,
  pressMineKey,
  routeStarterMineWorld,
  STARTING_CONSUMABLES,
  walkToStallPrompt,
  walkUntilBaseIndicator,
} from "./support/mine-helpers";

test(
  "village buildings enter the workshop and arena (REQ-021)",
  ciCase("E2E-MINE-NAVIGATION-0001", "@functional"),
  async ({ page }) => {
    await bypassMineRenderer(page);
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    // The Workshop building stands left of the shaft; standing on it offers
    // an Enter prompt that routes there (not a stall sheet).
    await enterBuilding(page, "ArrowLeft", "Workshop");
    await expect(page).toHaveURL(/\/workshop$/);
    // The workshop returns to the mine hub.
    await page.getByRole("link", { name: "Back to mine" }).click();
    await expect(page).toHaveURL(/\/mine$/);

    // The Battles building stands right of the shaft. A fresh load resets the
    // miner to the shaft so the walk starts from a known spot.
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await expect(status).toHaveAttribute("data-depth", "0");
    await enterBuilding(page, "ArrowRight", "Battles");
    await expect(page).toHaveURL(/\/arena$/);
  },
);

test(
  "surface base indicator offers a paid return",
  ciCase("E2E-MINE-NAVIGATION-0002", "@functional"),
  async ({ page }) => {
    await bypassMineRenderer(page);
    let chargedCost = 0;
    await routeStarterMineWorld(page, 2026062701);
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 6,
        },
      });
    });
    await page.route("**/api/mine/base-teleport", async (route) => {
      const body = route.request().postDataJSON() as { cost: number };
      chargedCost = body.cost;
      await route.fulfill({ json: { balance: 6 - body.cost } });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");
    await expect(status).toHaveAttribute("data-wallet", "6");

    const indicator = await walkUntilBaseIndicator(page);
    await expect(indicator).toHaveAttribute("data-base-direction", "left");
    await indicator.click();

    const menu = page.getByRole("region", { name: "Base return" });
    await expect(menu).toBeVisible();
    const teleport = menu.getByRole("button");
    await expect(teleport).toContainText(/Teleport for \d+ vibes/);
    await expect(teleport).toBeEnabled();
    await teleport.click();
    await expect(teleport).toContainText("Confirm for");
    await expect(teleport).toHaveCSS("background-color", "rgb(74, 31, 40)");
    await expect(teleport).toHaveCSS("color", "rgb(255, 217, 217)");
    await teleport.click();

    await expect(page.locator(".mine-base-teleport-burst")).toBeVisible();
    // The authoritative functional contract is the store position. The
    // hardware render tier separately owns the visible glide to center.
    await expect(status).toHaveAttribute("data-horizontal-distance", "0", {
      timeout: 15_000,
    });
    await expect(indicator).not.toBeVisible();
    expect(chargedCost).toBeGreaterThanOrEqual(1);
    await expect(status).toHaveAttribute(
      "data-wallet",
      String(6 - chargedCost),
    );
  },
);

test(
  "surface base return skips checkpoint for a touched surface mine",
  ciCase("E2E-MINE-NAVIGATION-0003", "@functional"),
  async ({ page }) => {
    await bypassMineRenderer(page);
    let bankRequests = 0;
    let chargedCost = 0;
    await routeStarterMineWorld(page, 2026062702);
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 6,
        },
      });
    });
    await page.route("**/api/mine/bank", async (route) => {
      bankRequests++;
      await route.fulfill({ status: 500, json: { error: "unexpected bank" } });
    });
    await page.route("**/api/mine/base-teleport", async (route) => {
      const body = route.request().postDataJSON() as { cost: number };
      chargedCost = body.cost;
      await route.fulfill({ json: { balance: 6 - body.cost } });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    await pressMineKey(page, "ArrowDown");
    await expect(status).toHaveAttribute("data-depth", "0");

    const indicator = await walkUntilBaseIndicator(page);
    await indicator.click();
    const teleport = page
      .getByRole("region", { name: "Base return" })
      .getByRole("button");
    await teleport.click();
    await expect(teleport).toContainText("Confirm for");
    await teleport.click();

    await expect(status).toHaveAttribute("data-horizontal-distance", "0", {
      timeout: 15_000,
    });
    expect(bankRequests).toBe(0);
    expect(chargedCost).toBeGreaterThanOrEqual(1);
    await expect(status).toHaveAttribute(
      "data-wallet",
      String(6 - chargedCost),
    );
  },
);

test(
  "surface base return visibly glides the miner to center",
  ciCase("E2E-MINE-NAVIGATION-0010", "@render"),
  async ({ page }) => {
    test.setTimeout(120_000);
    await routeStarterMineWorld(page, 2026072501);
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 6,
        },
      });
    });
    await page.route("**/api/mine/base-teleport", async (route) => {
      const body = route.request().postDataJSON() as { cost: number };
      await route.fulfill({ json: { balance: 6 - body.cost } });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-scene-painted", "true", {
      timeout: 30_000,
    });

    const indicator = await walkUntilBaseIndicator(page);
    await indicator.click();
    const teleport = page
      .getByRole("region", { name: "Base return" })
      .getByRole("button");
    await teleport.click();
    await expect(teleport).toContainText("Confirm for");
    await teleport.click();

    await expect(page.locator(".mine-base-teleport-burst")).toBeVisible();
    await expect(status).toHaveAttribute("data-horizontal-distance", "0", {
      timeout: 15_000,
    });
    await expect
      .poll(
        async () => Math.abs(Number(await canvas.getAttribute("data-miner-x"))),
        { timeout: 15_000 },
      )
      .toBeLessThan(0.6);
  },
);

test(
  "surface base return disables when vibes are short",
  ciCase("E2E-MINE-NAVIGATION-0004", "@functional"),
  async ({ page }) => {
    await routeStarterMineWorld(page, 2026062703);
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 0,
        },
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-wallet", "0");

    const indicator = await walkUntilBaseIndicator(page);
    await indicator.click();

    const menu = page.getByRole("region", { name: "Base return" });
    const teleport = menu.getByRole("button");
    await expect(teleport).toBeDisabled();
    await expect(teleport).toContainText("Need");
  },
);

test(
  "surface village stalls open their menus on tap (REQ-021)",
  ciCase("E2E-MINE-NAVIGATION-0005", "@functional"),
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Walk left from the shaft to the Hardware Store; the menu does not pop
    // on walk-by, the prompt does, and tapping it opens the menu.
    await walkToStallPrompt(page, "ArrowLeft", "Hardware Store");
    await expect(
      page.getByRole("region", { name: "Hardware Store", exact: true }),
    ).not.toBeVisible();
    const buyer = await openStall(page, "Hardware Store");
    await expect(buyer).toContainText("Wall");
    await expect(buyer).toContainText("Floor");
    await expect(buyer).toContainText("Roof");
    await expect(buyer).toContainText("Door");
    await expect(buyer).toContainText("Basic Turret");
    // The lock reads "Needs lv 2" on the button face; the accessible name
    // names the part it belongs to.
    await expect(
      buyer.getByRole("button", { name: "Basic Turret requires level 2" }),
    ).toBeVisible();
    await expect(buyer).toContainText("3 shots, breaks after 5 hits");
    await expect(buyer).toContainText("Floor Spikes");
    await expect(buyer).toContainText("breaks after 3 steps");
    // The per-level cap lives in the row badge, not in a second sentence.
    await expect(buyer).toContainText("have 0 / 4");
    await expect(buyer).not.toContainText("Limit 4 at your level");
    await expect(buyer).not.toContainText("Base stock unlocks by player level");
    await expect(buyer).not.toContainText("New claims start with");

    // Walk right to the Supply Depot: consumables with prices.
    await walkToStallPrompt(page, "ArrowRight", "Supply Depot");
    const depot = await openStall(page, "Supply Depot");
    await expect(depot).toContainText("supplies for digging deeper");
    await expect(depot).toContainText("Ladder");
    await expect(depot).toContainText("have");
    await expect(
      depot.getByRole("button", { name: "Buy 1 Ladder for 2 vibes" }),
    ).toBeVisible();
    await expect(depot).not.toContainText("best for");
    await expect(depot).not.toContainText("vibes left");
    await expect(depot).not.toContainText("current trip");
    await expect(depot).not.toContainText("purchases pack");
    await expect(depot).not.toContainText("Basic Turret");
    await expect(depot).not.toContainText("Floor Spikes");
    await depot.getByRole("button", { name: "x5" }).click();
    await expect(
      depot.getByRole("button", { name: "Buy 5 Ladder for 10 vibes" }),
    ).toBeVisible();

    // And on to the Upgrades stall: the gear tracks.
    await walkToStallPrompt(page, "ArrowRight", "Upgrades");
    const upgrades = await openStall(page, "Upgrades");
    await expect(upgrades).toContainText("Pickaxe");
    await expect(upgrades).toContainText("Cargo Hold");
    await expect(upgrades).toContainText("Fall Harness");
    await expect(upgrades).toContainText("Recall Rope");
    await expect(upgrades).toContainText("row 12");
    await expect(upgrades).not.toContainText("best for");
    await expect(upgrades).not.toContainText("vibes after");

    // Walking off the stall column closes the menu.
    await pressMineKey(page, "ArrowLeft");
    await expect(upgrades).not.toBeVisible();
  },
);

test(
  "Hardware Store purchases update the visible vibe balance",
  ciCase("E2E-MINE-NAVIGATION-0009", "@functional"),
  async ({ page }) => {
    const inventory = {
      "wall-panel": 0,
      "floor-panel": 0,
      "roof-panel": 0,
      "door-panel": 0,
      "basic-turret": 0,
      "floor-spikes": 0,
      "stair-panel": 0,
    };
    const player = {
      balance: 50,
      trackXp: 0,
      defenseXp: 0,
      overallLevel: 1,
      levelCap: 100,
      progressXp: 0,
      neededXp: 100,
      nextLevelXp: 100,
      beaconLimit: 2,
    };
    await routeStarterMineWorld(page, 2026072501);
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 50,
          playerLevel: 1,
          deepestDepth: 0,
        },
      });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        json: {
          bunker: null,
          inventory,
          player,
          revision: 0,
        },
      });
    });
    await page.route("**/api/bunker/parts/buy", async (route) => {
      await route.fulfill({
        json: {
          bunker: null,
          inventory: { ...inventory, "wall-panel": 1 },
          player: { ...player, balance: 44 },
          revision: 0,
        },
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-wallet", "50");
    await walkToStallPrompt(page, "ArrowLeft", "Hardware Store");
    const hardware = await openStall(page, "Hardware Store");
    await expect(hardware).toContainText("50 vibes");

    await hardware
      .getByRole("button", { name: "Buy 1 Wall for 6 vibes" })
      .click();

    await expect(status).toHaveAttribute("data-wallet", "44");
    await expect(hardware).toContainText("44 vibes");
    await expect(hardware).toContainText("have 1");
  },
);

test(
  "upgrade buys require a completed hold",
  ciCase("E2E-MINE-NAVIGATION-0006", "@functional"),
  async ({ page }) => {
    let upgradeRequests = 0;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "vibrate", {
        configurable: true,
        value: (pattern: VibratePattern) => {
          const target = window as Window & {
            __vibebotsVibrations?: VibratePattern[];
          };
          target.__vibebotsVibrations ??= [];
          target.__vibebotsVibrations.push(pattern);
          return true;
        },
      });
    });
    const mine = createMine(7193, DEFAULT_GEAR, STARTING_CONSUMABLES);
    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        json: { seed: 7193, diff: exportDiff(mine), tripIndex: 0 },
      });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({
        json: {
          gear: DEFAULT_GEAR,
          consumables: STARTING_CONSUMABLES,
          balance: 120,
          playerLevel: 1,
          deepestDepth: 0,
        },
      });
    });
    await page.route("**/api/gear/upgrade", async (route) => {
      upgradeRequests++;
      await route.fulfill({
        json: { track: "pickaxe", level: 2, balance: 75 },
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await walkToStallPrompt(page, "ArrowRight", "Upgrades");
    const upgrades = await openStall(page, "Upgrades");
    await expect(upgrades).toContainText("Pickaxe");
    await expect(upgrades).not.toContainText("best for");
    await expect(upgrades).not.toContainText("vibes after");

    const buyPickaxe = upgrades.getByRole("button", {
      name: "Hold to buy Pickaxe for 45 vibes",
    });
    await expect(buyPickaxe).toBeEnabled();
    const buyBox = await buyPickaxe.boundingBox();
    if (!buyBox) throw new Error("buy button has no bounding box");
    await page.mouse.move(
      buyBox.x + buyBox.width / 2,
      buyBox.y + buyBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(180);
    await page.mouse.up();
    await page.waitForTimeout(650);
    expect(upgradeRequests).toBe(0);
    await expect(page.getByText("pickaxe is now level 2")).toHaveCount(0);

    const activeUpgrades = (await upgrades.isVisible().catch(() => false))
      ? upgrades
      : await openStall(page, "Upgrades");
    const activeBuyPickaxe = activeUpgrades.getByRole("button", {
      name: "Hold to buy Pickaxe for 45 vibes",
    });
    const activeBuyBox = await activeBuyPickaxe.boundingBox();
    if (!activeBuyBox) throw new Error("active buy button has no bounding box");
    await page.mouse.move(
      activeBuyBox.x + activeBuyBox.width / 2,
      activeBuyBox.y + activeBuyBox.height / 2,
    );
    await page.mouse.down();
    await expect.poll(() => upgradeRequests, { timeout: 4_000 }).toBe(1);
    await page.mouse.up();
    await expect(activeUpgrades).toContainText("pickaxe is now level 2");
    await expect(page.getByLabel("Mine status")).toHaveAttribute(
      "data-wallet",
      "75",
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const target = window as Window & {
            __vibebotsVibrations?: VibratePattern[];
          };
          return target.__vibebotsVibrations?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(3);
  },
);

test(
  "a stall opens on tap and closes back to the prompt",
  ciCase("E2E-MINE-NAVIGATION-0007", "@functional"),
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Stand at the Hardware Store (three columns left of the shaft).
    await walkToStallPrompt(page, "ArrowLeft", "Hardware Store");
    const prompt = page.getByRole("button", { name: "Open Hardware Store" });
    const buyer = page.getByRole("region", {
      name: "Hardware Store",
      exact: true,
    });
    await expect(prompt).toBeVisible();
    await expectSurfacePromptBottomClearance(page, "Open Hardware Store");
    await expect(buyer).not.toBeVisible();

    // Tap opens; the close button dismisses without walking away (still on
    // the column at depth 0) and the prompt comes back.
    await prompt.click();
    await expect(buyer).toBeVisible();
    await buyer.getByRole("button", { name: "Close shop" }).click();
    await expect(buyer).not.toBeVisible();
    await expect(prompt).toBeVisible();
    await expectSurfacePromptBottomClearance(page, "Open Hardware Store");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Tapping the prompt again reopens it.
    await prompt.click();
    await expect(buyer).toBeVisible();
    await buyer.getByRole("button", { name: "Close shop" }).click();
    await expect(buyer).not.toBeVisible();

    // The reported phone layout was at the Supply Depot. The same raised
    // prompt slot applies to every stall.
    await walkToStallPrompt(page, "ArrowRight", "Supply Depot");
    await expectSurfacePromptBottomClearance(page, "Open Supply Depot");
  },
);

test(
  "floating mine menus dismiss from outside taps",
  ciCase("E2E-MINE-NAVIGATION-0008", "@functional"),
  async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const outsidePoint = { x: 18, y: 220 };

    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.getByRole("region", { name: "Settings" });
    await expect(settings).toBeVisible();
    await page.mouse.click(outsidePoint.x, outsidePoint.y);
    await expect(settings).not.toBeVisible();

    await page.getByRole("button", { name: /Dynamite .*\(/ }).click();
    const dynamiteMenu = page.getByRole("menu", { name: "Dynamite tiers" });
    await expect(dynamiteMenu).toBeVisible();
    await page.mouse.click(outsidePoint.x, outsidePoint.y);
    await expect(dynamiteMenu).not.toBeVisible();

    await page.getByRole("button", { name: "Recovery options" }).click();
    const recoveryMenu = page.getByRole("menu", { name: "Recovery actions" });
    await expect(recoveryMenu).toBeVisible();
    await page.mouse.click(outsidePoint.x, outsidePoint.y);
    await expect(recoveryMenu).not.toBeVisible();

    for (let i = 0; i < 3; i++) {
      await pressMineKey(page, "ArrowLeft");
    }
    const hardware = await openStall(page, "Hardware Store", "ArrowLeft");
    await page.mouse.click(outsidePoint.x, outsidePoint.y);
    await expect(hardware).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open Hardware Store" }),
    ).toBeVisible();

    const indicator = await walkUntilBaseIndicator(page);
    await indicator.click();
    const baseReturn = page.getByRole("region", { name: "Base return" });
    await expect(baseReturn).toBeVisible();
    await page.mouse.click(outsidePoint.x, outsidePoint.y);
    await expect(baseReturn).not.toBeVisible();
  },
);

test(
  "the options menu drills into a folder and backs out one level at a time",
  ciCase("E2E-MINE-NAVIGATION-0011", "@functional"),
  async ({ page }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);

    const settings = await openSettings(page);
    await expect(settings).toHaveAttribute("data-options-folder", "root");
    // The root fits without scrolling, which is the point of the folders:
    // nothing below the fold means nothing unreachable on a phone.
    expect(
      await settings.evaluate((el) => el.scrollHeight <= el.clientHeight),
    ).toBe(true);
    // Credits lives a level down, so it is not reachable from the root.
    // Exact, because the folder row names Credits in its own label.
    await expect(
      settings.getByRole("button", { name: "Credits", exact: true }),
    ).toHaveCount(0);

    // The folder row advertises what it holds, per the nested-doll fix.
    const about = settings.getByRole("button", { name: /^About and help\./ });
    await expect(about).toContainText("Credits");
    await about.click();
    await expect(settings).toHaveAttribute("data-options-folder", "about");
    await expect(
      settings.getByRole("button", { name: "Credits", exact: true }),
    ).toBeVisible();

    // Escape steps up one level before it closes anything.
    await page.keyboard.press("Escape");
    await expect(settings).toHaveAttribute("data-options-folder", "root");
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).not.toBeVisible();

    // Reopening lands at the root, never back inside the last folder.
    const reopened = await openSettings(page);
    await expect(reopened).toHaveAttribute("data-options-folder", "root");

    // An outside tap still means "away", not "up one level".
    await reopened.getByRole("button", { name: /^About and help\./ }).click();
    await expect(reopened).toHaveAttribute("data-options-folder", "about");
    await page.mouse.click(18, 220);
    await expect(reopened).not.toBeVisible();
  },
);
