import { expect, type Page, test } from "@playwright/test";
import packageJson from "../../package.json";

const MINE_KEY_CADENCE_MS = 190;
const APP_VERSION_PATTERN = new RegExp(
  `^${packageJson.version.replaceAll(".", "\\.")}([.+]|$)`,
);

async function pressMineKey(
  page: Page,
  key: "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight",
): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(MINE_KEY_CADENCE_MS);
}

/** Multi-hit digging (REQ-013): swing down until the depth is reached. */
async function digTo(page: Page, depth: number): Promise<void> {
  const status = page.getByLabel("Mine status");
  for (let i = 0; i < 8 * depth + 8; i++) {
    if (Number(await status.getAttribute("data-depth")) >= depth) return;
    await pressMineKey(page, "ArrowDown");
  }
}

/** Standing on a stall shows a prompt; tap it to open the menu. Returns
 * the menu region. Stalls no longer auto-open on walk-by. */
async function openStall(page: Page, name: string) {
  const prompt = page.getByRole("button", { name: `Open ${name}` });
  await expect(prompt).toBeVisible();
  await prompt.click();
  const sheet = page.getByRole("region", { name, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Walk the surface toward a destination building until its Enter prompt
 * appears, then tap it. Presses are paced past the glide and the loop
 * tolerates the odd dropped synthetic key (it stops on the prompt, not a
 * fixed step count). */
async function enterBuilding(
  page: Page,
  key: "ArrowLeft" | "ArrowRight",
  name: string,
): Promise<void> {
  const prompt = page.getByRole("button", { name: `Enter ${name}` });
  for (let i = 0; i < 16; i++) {
    if (await prompt.isVisible().catch(() => false)) break;
    await pressMineKey(page, key);
  }
  await expect(prompt).toBeVisible();
  await prompt.click();
}

async function walkUntilBaseIndicator(page: Page) {
  const indicator = page.getByRole("button", { name: "Base is left" });
  for (let i = 0; i < 28; i++) {
    if (await indicator.isVisible().catch(() => false)) break;
    await pressMineKey(page, "ArrowRight");
  }
  await expect(indicator).toBeVisible();
  return indicator;
}

/** Swing a lateral direction until the rendered miner crosses targetX. */
async function digLateral(
  page: Page,
  key: "ArrowLeft" | "ArrowRight",
  pastX: number,
): Promise<void> {
  const canvas = page.locator("canvas");
  for (let i = 0; i < 10; i++) {
    await pressMineKey(page, key);
    const x = Number(await canvas.getAttribute("data-miner-x"));
    if (key === "ArrowLeft" ? x < pastX : x > pastX) return;
  }
}

async function dismissReleaseNotes(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
  const button = dialog.getByRole("button", { name: "Got it" });
  await dialog.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  for (let i = 0; i < 6; i++) {
    if (!(await dialog.isVisible().catch(() => false))) return;
    await button.click();
    await page.waitForTimeout(250);
  }
  await expect(dialog).not.toBeVisible();
}

async function openSettings(page: Page) {
  const settings = page.getByRole("region", { name: "Settings" });
  if (!(await settings.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open settings" }).click();
  }
  await expect(settings).toBeVisible();
  return settings;
}

async function speedUpVersionRefreshChecks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const realSetTimeout = window.setTimeout;
    const realSetInterval = window.setInterval;
    window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => {
      const [handler, timeout, ...rest] = args;
      return realSetTimeout(
        handler,
        timeout === 30_000 ? 20 : timeout,
        ...rest,
      );
    }) as typeof window.setTimeout;
    window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
      const [handler, timeout, ...rest] = args;
      return realSetInterval(
        handler,
        timeout === 60_000 ? 20 : timeout,
        ...rest,
      );
    }) as typeof window.setInterval;
  });
}

async function installGamepadBackControl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let backPressed = false;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        {
          buttons: Array.from({ length: 17 }, (_, index) => ({
            pressed: (index === 1 || index === 8) && backPressed,
            touched: (index === 1 || index === 8) && backPressed,
            value: (index === 1 || index === 8) && backPressed ? 1 : 0,
          })),
        },
      ],
    });
    Object.defineProperty(window, "__setGamepadBackPressed", {
      configurable: true,
      value: (pressed: boolean) => {
        backPressed = pressed;
      },
    });
  });
}

async function pressGamepadBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as Window & {
        __setGamepadBackPressed: (pressed: boolean) => void;
      }
    ).__setGamepadBackPressed(true);
  });
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    (
      window as unknown as Window & {
        __setGamepadBackPressed: (pressed: boolean) => void;
      }
    ).__setGamepadBackPressed(false);
  });
  await page.waitForTimeout(80);
}

async function countCanvasRedPixels(
  page: Page,
  image: Buffer,
): Promise<number> {
  return page.evaluate(async (base64) => {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("canvas screenshot decode failed"));
      img.src = `data:image/png;base64,${base64}`;
    });
    const scratch = document.createElement("canvas");
    scratch.width = img.width;
    scratch.height = img.height;
    const ctx = scratch.getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (r > 210 && g < 90 && b < 90 && a > 180) count++;
    }
    return count;
  }, image.toString("base64"));
}

import { SIM_VERSION } from "../../src/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "../../src/sim/design";
import {
  createMine,
  DEFAULT_GEAR,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  exportDiff,
  MINE_VERSION,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "../../src/sim/mine";

test("arena page renders a moving match (Rule 10 motion QA)", async ({
  page,
}) => {
  await page.goto("/arena");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // The match HUD must render alongside the arena.
  await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
  await expect(page.getByText("Rammer", { exact: true })).toBeVisible();

  // Every entered screen returns to the mine hub (the top nav is gone).
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();

  const stage = page.locator("[data-sim-tick]");
  await expect
    .poll(async () => Number(await stage.getAttribute("data-sim-tick")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const tickBefore = Number(await stage.getAttribute("data-sim-tick"));
  const shotBefore = await canvas.screenshot();

  await page.waitForTimeout(700);

  // Assumes the match outlasts the sample window (matches run ~60s and the
  // test samples within the first seconds). If tuning ever makes matches end
  // near-instantly, the exhibition restart resets the tick and this flakes.
  const tickAfter = Number(await stage.getAttribute("data-sim-tick"));
  const shotAfter = await canvas.screenshot();

  // The sim tick must advance and the visible pixels must actually change.
  expect(tickAfter).toBeGreaterThan(tickBefore);
  expect(Buffer.compare(shotBefore, shotAfter)).not.toBe(0);
});

test("workshop builds and undoes parts", async ({ page }) => {
  await page.goto("/workshop");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to mine" })).toBeVisible();
  await expect(page.getByText("My Bot: 1 part", { exact: true })).toBeVisible();

  const palette = page.getByLabel("Part palette");
  const driveWheelAdd = palette
    .locator("div")
    .filter({ hasText: "Drive Wheel" })
    .getByRole("button", { name: "Add" });
  await expect(driveWheelAdd).toBeEnabled();
  await driveWheelAdd.click();
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(page.getByText("level 2")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("My Bot: 2 parts")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("My Bot: 1 part", { exact: true })).toBeVisible();

  // Test arena (REQ-009): fight the current bot against the CPU Brawler.
  await page.getByRole("button", { name: "Test fight vs Brawler" }).click();
  await expect(page.getByText("My Bot", { exact: true })).toBeVisible();
  await expect(page.getByText("Brawler", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to build" }).click();
  await expect(page.getByLabel("Part palette")).toBeVisible();
});

test("workshop panels stack on portrait phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workshop");
  const controls = page.getByLabel("Workshop build controls");
  const shop = page.getByLabel("Parts shop");
  await expect(controls).toBeVisible();
  await expect(shop).toBeVisible();

  const controlsBox = await controls.boundingBox();
  const shopBox = await shop.boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(shopBox).not.toBeNull();
  if (!controlsBox || !shopBox) return;

  expect(controlsBox.x).toBeGreaterThanOrEqual(0);
  expect(shopBox.x).toBeGreaterThanOrEqual(0);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(390);
  expect(shopBox.x + shopBox.width).toBeLessThanOrEqual(390);
  expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(shopBox.y + 1);
});

test("mine digs and tracks depth and energy", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.locator("canvas")).toBeVisible();
  // The HUD exposes the sim numbers as data attributes (REQ-024): the
  // chip copy can change, the test surface cannot.
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toHaveAttribute("data-horizontal-distance", "0");
  await expect(status).toContainText("Depth 0");
  await expect(status).toContainText("Base 0");
  await expect(status).toContainText("Topsoil");
  // The wallet is always on the HUD now (exposed for tests; empty when
  // storage is offline, a number otherwise).
  expect(await status.getAttribute("data-wallet")).not.toBeNull();

  await pressMineKey(page, "ArrowRight");
  await expect(status).toHaveAttribute("data-horizontal-distance", "1");
  await expect(status).toContainText("Base +1");
  await pressMineKey(page, "ArrowLeft");
  await expect(status).toHaveAttribute("data-horizontal-distance", "0");

  // Blocks soak multiple swings now (REQ-013); dig through row 1.
  await digTo(page, 1);
  await expect(status).toHaveAttribute("data-depth", "1");
  await expect(status).toContainText("Depth 1");
  // The block's swing total preserves the old economy: a dirt or ore
  // block costs 1.0 in total (a rare cache costs 1.5).
  const energy = Number(await status.getAttribute("data-energy"));
  expect(energy).toBeLessThanOrEqual(59.0);
  expect(energy).toBeGreaterThanOrEqual(58.5);
  // The climb estimate prices ladders as well as energy (REQ-020).
  await expect(status).toHaveAttribute("data-climb-ladders", "1");

  // Climbing out consumes a provisioned ladder (REQ-020).
  await pressMineKey(page, "ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "0");
  // Banking on the surface recharges the robot battery.
  await expect(status).toHaveAttribute("data-energy", "60.0");

  // Consumable controls exist even when empty (REQ-016); a scripted
  // edit once shipped without them, so the smoke pins their presence.
  const dynamiteButton = page.getByRole("button", {
    name: /Dynamite .*\(\d+\)/,
  });
  await expect(dynamiteButton).toBeVisible();
  await dynamiteButton.click();
  await expect(
    page.getByRole("menu", { name: "Dynamite tiers" }),
  ).toBeVisible();
  for (const name of [/T1 Pulse/, /T2 Bore/, /T3 Block/, /T4 Lamp wipe/]) {
    await expect(page.getByRole("menuitemradio", { name })).toBeVisible();
  }
  await page.getByRole("menuitemradio", { name: /T4 Lamp wipe/ }).click();
  await expect(
    page.getByText("Locked. Buy this dynamite tier at the Upgrades stall."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Deploy tier 4 dynamite" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /Recall \(\d+\)/ }),
  ).toBeVisible();
  const placePlankLeft = page.getByRole("button", {
    name: "Place plank left",
  });
  const placePlankRight = page.getByRole("button", {
    name: "Place plank right",
  });
  await expect(placePlankLeft).toBeVisible();
  await expect(placePlankRight).toBeVisible();
  await expect(placePlankLeft).toBeDisabled();
  await expect(placePlankRight).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit placed pickups" }),
  ).toBeVisible();
  await expect(status).toHaveAttribute("data-ladders", /\d+/);
});

test("mine bunker builder starts a Clanker raid", async ({ page }) => {
  const bunkerView = {
    bunker: {
      footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
      core: { col: START_COL, row: 3, durability: 160 },
      parts: [
        {
          partId: "wall-panel",
          col: START_COL - 3,
          row: 1,
          durability: 90,
        },
      ],
    },
    inventory: {
      "wall-panel": 2,
      "floor-panel": 3,
      "roof-panel": 3,
      "door-panel": 1,
      "basic-turret": 0,
      "floor-spikes": 0,
    },
    activeRaid: null,
    player: {
      balance: 120,
      trackXp: 40,
      defenseXp: 120,
      overallLevel: 2,
      levelCap: 2,
      progressXp: 100,
      neededXp: 0,
      nextLevelXp: null,
      beaconLimit: 3,
    },
  };
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bunkerView),
    });
  });
  await page.route("**/api/bunker/raid/start", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...bunkerView,
        activeRaid: {
          raidId: "raid-smoke",
          tier: 1,
          durationSeconds: 180,
          startedAtMs: Date.now(),
          clankers: [
            {
              id: "clanker-1",
              col: START_COL - 6,
              row: 0,
              targetCol: START_COL - 3,
              targetRow: 1,
              path: [
                { col: START_COL - 6, row: 0 },
                { col: START_COL - 5, row: 0 },
                { col: START_COL - 4, row: 0 },
                { col: START_COL - 3, row: 0 },
                { col: START_COL - 3, row: 1 },
              ],
            },
          ],
          turretShots: 0,
          turretDamage: 0,
          spikeTriggers: 0,
          spikeDamage: 0,
          totalPartDurability: 90,
          incomingDamage: 40,
          breached: false,
          survived: true,
          reward: { vibes: 30, defenseXp: 60 },
        },
        raid: {
          raidId: "raid-smoke",
          tier: 1,
          durationSeconds: 180,
          startedAtMs: Date.now(),
          clankers: [],
          turretShots: 0,
          turretDamage: 0,
          spikeTriggers: 0,
          spikeDamage: 0,
          totalPartDurability: 90,
          incomingDamage: 40,
          breached: false,
          survived: true,
          reward: { vibes: 30, defenseXp: 60 },
        },
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Player level 2/2",
  );
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Beacon cap 3",
  );
  await expect(builder).toContainText("Wall x2");
  await expect(builder).toContainText("Floor x3");
  await expect(builder).toContainText("Roof x3");
  await builder.getByRole("button", { name: "Start Clanker raid" }).click();
  await expect(builder).toContainText("Clankers attacking for 180 seconds");
});

test("mine requires an explicit bunker claim mode before showing the claim panel", async ({
  page,
}) => {
  await installGamepadBackControl(page);
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bunker: null,
        inventory: {
          "wall-panel": 2,
          "floor-panel": 3,
          "roof-panel": 3,
          "door-panel": 1,
          "basic-turret": 0,
          "floor-spikes": 0,
        },
        activeRaid: null,
        player: {
          balance: 120,
          trackXp: 0,
          defenseXp: 0,
          overallLevel: 1,
          levelCap: 2,
          progressXp: 0,
          neededXp: 100,
          nextLevelXp: 100,
          beaconLimit: 2,
        },
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);

  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).not.toBeVisible();
  const claimButton = page.getByRole("button", { name: "Start bunker claim" });
  await expect(claimButton).toBeVisible();
  const claimButtonBox = await claimButton.boundingBox();
  const viewport = page.viewportSize();
  if (!claimButtonBox || !viewport) {
    throw new Error("claim button position could not be measured");
  }
  expect(claimButtonBox.y + claimButtonBox.height).toBeLessThan(
    viewport.height - 128,
  );
  await claimButton.click();
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Player level 1/2",
  );
  await expect(
    builder.getByRole("button", { name: "Claim 7x5 bunker" }),
  ).toBeVisible();
  await pressGamepadBack(page);
  await expect(builder).not.toBeVisible();
  await expect(claimButton).toBeVisible();
  await claimButton.click();
  await expect(builder).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(builder).not.toBeVisible();
  await expect(claimButton).toBeVisible();
  await claimButton.click();
  await expect(builder).toBeVisible();
  await builder.getByRole("button", { name: "Cancel claim" }).click();
  await expect(builder).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start bunker claim" }),
  ).toBeVisible();
});

test("bunker claim mode highlights uncleared claim cells in red", async ({
  page,
}) => {
  const mine = createMine(6060, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 6; row++) {
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed: 6060,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bunker: null,
        inventory: {
          "wall-panel": 2,
          "floor-panel": 3,
          "roof-panel": 3,
          "door-panel": 1,
          "basic-turret": 0,
          "floor-spikes": 0,
        },
        activeRaid: null,
        player: {
          balance: 120,
          trackXp: 0,
          defenseXp: 0,
          overallLevel: 1,
          levelCap: 2,
          progressXp: 0,
          neededXp: 100,
          nextLevelXp: 100,
          beaconLimit: 2,
        },
      }),
    });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem(
        "vibebots-mine-trip-v2-slot-1",
        JSON.stringify(trip),
      );
    },
    {
      seed: 6060,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down", "down", "down", "down", "down", "down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "6",
  );

  await page.getByRole("button", { name: "Start bunker claim" }).click();
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toContainText(/Clear \d+ red cells/);
  await expect(
    builder.getByRole("button", { name: "Claim 7x5 bunker" }),
  ).toBeDisabled();

  const redPixels = await countCanvasRedPixels(
    page,
    await page.locator("canvas").screenshot(),
  );
  expect(redPixels).toBeGreaterThan(50);
});

test("fatal free fall stays on camera until impact", async ({ page }) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(6161, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 6; row++) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  setCell(mine, START_COL, 7, { kind: "dirt" });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 6161,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: [],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  const beforeFallShot = await canvas.screenshot();
  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(async () => canvas.getAttribute("data-fall-visual-active"), {
      timeout: 5_000,
    })
    .toBe("true");
  const fallActiveShot = await canvas.screenshot();
  expect(Buffer.compare(beforeFallShot, fallActiveShot)).not.toBe(0);

  const report = page.getByRole("button", { name: "Dismiss trip report" });
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(report).toContainText("Fell too far");
  await expect(report).not.toContainText("Crushed by a boulder");
});

test("falling-rock crush stays on camera before the report", async ({
  page,
}) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
  const mine = createMine(6262, gear, STARTING_CONSUMABLES);
  const c = START_COL;
  for (let row = 1; row <= 6; row++) {
    setCell(mine, c, row, { kind: "empty" });
  }
  setCell(mine, c, 7, { kind: "dirt" });
  setCell(mine, c + 1, 5, { kind: "rock", rockTier: 1 });
  setCell(mine, c + 1, 6, { kind: "dirt" });
  setCell(mine, c + 1, 7, { kind: "dirt" });
  setCell(mine, c + 1, 8, { kind: "dirt" });
  setCell(mine, c + 1, 9, { kind: "dirt" });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-falling-rock-alert-dismissed", "true");
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 6262,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  await pressMineKey(page, "ArrowRight");
  await pressMineKey(page, "ArrowDown");
  const beforeCrushShot = await canvas.screenshot();
  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(async () => canvas.getAttribute("data-fall-visual-active"), {
      timeout: 5_000,
    })
    .toBe("true");
  await expect(
    page.getByRole("button", { name: "Dismiss trip report" }),
  ).not.toBeVisible();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-y")), {
      timeout: 5_000,
    })
    .toBeLessThan(-7);
  await expect
    .poll(async () => canvas.getAttribute("data-fall-visual-impact"), {
      timeout: 5_000,
    })
    .toBe("true");
  const activeCrushShot = await canvas.screenshot();
  expect(Buffer.compare(beforeCrushShot, activeCrushShot)).not.toBe(0);

  const report = page.getByRole("button", { name: "Dismiss trip report" });
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(report).toContainText("Crushed by a boulder");
});

test("edit pickup selection outlines selected cells in red", async ({
  page,
}) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(7171, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "empty", ladder: true });
  setCell(mine, START_COL + 1, 1, { kind: "empty", plank: true });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 7171,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: [],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit placed pickups" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Edit placed pickups" }).click();
  const salvage = page.getByRole("region", { name: "Edit pickups" });
  await expect(salvage).toBeVisible();
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await canvas.click({
    position: { x: box.width / 2, y: box.height / 2 + 75 },
  });
  await expect(salvage).toContainText("1 selected");
  await canvas.click({
    position: { x: box.width / 2 + 54, y: box.height / 2 + 105 },
  });
  await expect(salvage).toContainText("2 selected");

  const after = await canvas.screenshot();
  expect(await countCanvasRedPixels(page, after)).toBeGreaterThan(
    (await countCanvasRedPixels(page, before)) + 80,
  );
});

test("standing on a ladder uses edit pickups for removal", async ({ page }) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(7172, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "empty", ladder: true });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 7172,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "1",
  );
  await expect(
    page.getByRole("button", { name: "Salvage ladder" }),
  ).toHaveCount(0);

  const editPickups = page.getByRole("button", {
    name: "Edit placed pickups",
  });
  await expect(editPickups).toBeEnabled();
  await editPickups.click();
  await expect(
    page.getByRole("region", { name: "Edit pickups" }),
  ).toBeVisible();
});

test("home redirects to the mine hub", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/mine$/);
});

test("village buildings enter the workshop and arena (REQ-021)", async ({
  page,
}) => {
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
});

test("surface base indicator offers a paid return", async ({ page }) => {
  let chargedCost = 0;
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
  const canvas = page.locator("canvas");
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
  await expect
    .poll(async () =>
      Math.abs(Number(await canvas.getAttribute("data-miner-x"))),
    )
    .toBeLessThan(0.6);
  await expect(indicator).not.toBeVisible();
  expect(chargedCost).toBeGreaterThanOrEqual(1);
  await expect(status).toHaveAttribute("data-wallet", String(6 - chargedCost));
});

test("surface base return skips checkpoint for a touched surface mine", async ({
  page,
}) => {
  let bankRequests = 0;
  let chargedCost = 0;
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
  const canvas = page.locator("canvas");
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

  await expect
    .poll(async () =>
      Math.abs(Number(await canvas.getAttribute("data-miner-x"))),
    )
    .toBeLessThan(0.6);
  expect(bankRequests).toBe(0);
  expect(chargedCost).toBeGreaterThanOrEqual(1);
  await expect(status).toHaveAttribute("data-wallet", String(6 - chargedCost));
});

test("surface base return disables when vibes are short", async ({ page }) => {
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
});

test("mine shows the latest release note once to a fresh browser", async ({
  page,
}) => {
  await page.goto("/mine");
  const dialog = page.getByRole("dialog", { name: "New in VibeBots" });
  await expect(dialog).toBeVisible();
  const version = await dialog.getAttribute("data-app-version");
  const noteId = await dialog.getAttribute("data-release-note-id");
  expect(version).toBeTruthy();
  expect(noteId).toBeTruthy();
  await expect(dialog).toContainText(
    "Bunker claim mode now marks blockers in red.",
  );
  await expect(dialog.locator("li")).toHaveCount(3);
  await expect(dialog.locator("li").first()).toContainText(
    "highlighted in red",
  );
  await expect(dialog.locator("li").nth(1)).toContainText("miner's row");
  await expect(dialog.locator("li").nth(2)).toContainText("failing claim");

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-release-notes-dismissed-id"),
    ),
  ).toBe(noteId);

  await page.reload();
  await expect(dialog).not.toBeVisible();

  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Release notes" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Release notes")).toBeVisible();
  const notes = dialog.locator("[data-release-note]");
  const recentReleaseNotes = [
    ["0.1.81", "Bunker claim clarity"],
    ["0.1.80", "Bag stacks and ore rebalance"],
    ["0.1.79", "Stamp catalog refresh"],
    ["0.1.78", "Falling rock durability"],
    ["0.1.77", "Upward mining warning"],
    ["0.1.76", "Surface tip rotation"],
    ["0.1.75", "Mine performance samples"],
    ["0.1.74", "Stale trip recovery"],
    ["0.1.73", "Falling rock crush"],
    ["0.1.72", "Plank side buttons"],
    ["0.1.71", "Ore yield tuning"],
    ["0.1.70", "Biome portal beacons"],
    ["0.1.69", "Installed app refresh"],
    ["0.1.68", "Ladder removal cleanup"],
    ["0.1.67", "Release note accuracy"],
    ["0.1.66", "Bag drop controls"],
    ["0.1.65", "Tool satchel bag"],
    ["0.1.64", "Feedback window"],
    ["0.1.63", "Native release alerts"],
    ["0.1.62", "Refresh availability guard"],
    ["0.1.61", "Ladder gravity"],
    ["0.1.60", "Dismissible windows"],
    ["0.1.59", "Bunker claim HUD"],
    ["0.1.58", "Dropped bag gravity"],
    ["0.1.57", "Bag grid"],
    ["0.1.56", "Version refresh prompt"],
    ["0.1.55", "Mine metal floor"],
    ["0.1.54", "Death bag recovery"],
  ] as const;
  expect(await notes.count()).toBeGreaterThanOrEqual(recentReleaseNotes.length);
  for (const [
    index,
    [noteVersion, noteTitle],
  ] of recentReleaseNotes.entries()) {
    await expect(notes.nth(index)).toHaveAttribute(
      "data-release-note",
      noteVersion,
    );
    await expect(notes.nth(index)).toContainText(noteTitle);
  }
  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).not.toBeVisible();

  const settingsAgain = await openSettings(page);
  await expect(settingsAgain.getByLabel("Update alerts")).toBeVisible();
  await expect(
    settingsAgain.getByRole("button", { name: "Enable update alerts" }),
  ).toBeDisabled();
  await expect(settingsAgain).toContainText(
    /Notification keys are not set on this deploy\.|Notifications are blocked in browser settings\./,
  );
});

test("mine prompts to refresh when the deployed version changes", async ({
  page,
}) => {
  await speedUpVersionRefreshChecks(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "vibebots-release-notes-dismissed-id",
      "2026-06-20-0.1.81-bunker-claim-clarity",
    );
  });
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.0-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="999.0.0-test"></span>',
    });
  });
  await page.route("**/mine?vibebots_refresh=999.0.0-test", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
        <html>
          <body>
            <script>
              document.body.setAttribute(
                "data-dismissed-release-note",
                localStorage.getItem("vibebots-release-notes-dismissed-id") ?? ""
              );
            </script>
          </body>
        </html>`,
    });
  });

  await page.goto("/mine");
  const dismissedBeforeRefresh = await page.evaluate(() =>
    localStorage.getItem("vibebots-release-notes-dismissed-id"),
  );
  expect(dismissedBeforeRefresh).toBeTruthy();

  const prompt = page.getByRole("dialog", {
    name: "New version available",
  });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(
    "Refresh to load the latest VibeBots build.",
  );
  await expect(prompt).toHaveAttribute(
    "data-version-refresh-prompt",
    "999.0.0-test",
  );
  await prompt.getByRole("button", { name: "Refresh" }).click();
  await page.waitForURL("**/mine?vibebots_refresh=999.0.0-test");
  await expect(page.locator("body")).toHaveAttribute(
    "data-dismissed-release-note",
    dismissedBeforeRefresh ?? "",
  );
});

test("mine waits to show refresh prompt until the new page is refreshable", async ({
  page,
}) => {
  await speedUpVersionRefreshChecks(page);
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.0-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="0.1.59.old"></span>',
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await page.waitForTimeout(120);

  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).not.toBeVisible();
});

test("mine rechecks stale installed app shells when the app returns to foreground", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).not.toBeVisible();

  const version = "999.0.1-test";
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<span hidden data-vibebots-app-version="${version}"></span>`,
    });
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    window.dispatchEvent(new Event("focus"));
  });

  await expect(
    page.getByRole("dialog", { name: "New version available" }),
  ).toBeVisible();
});

test("mine refresh prompt dismisses from an outside tap", async ({ page }) => {
  await speedUpVersionRefreshChecks(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "vibebots-release-notes-dismissed-id",
      "2026-06-20-0.1.81-bunker-claim-clarity",
    );
  });
  await page.route("**/api/version", async (route) => {
    await route.fulfill({ json: { version: "999.0.2-test" } });
  });
  await page.route("**/mine?vibebots_version_probe=*", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<span hidden data-vibebots-app-version="999.0.2-test"></span>',
    });
  });

  await page.goto("/mine");

  const prompt = page.getByRole("dialog", {
    name: "New version available",
  });
  await expect(prompt).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(prompt).not.toBeVisible();
});

test("mine asks mobile Safari users to add the Home Screen app for alerts", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  await page.goto("/mine");
  await dismissReleaseNotes(page);

  const dialog = page.getByRole("dialog", {
    name: "Add VibeBots to Home Screen",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Mobile Safari needs the Home Screen app before notifications can work.",
  );
  await expect(dialog).toContainText(
    "Safari does not let websites open that sheet automatically.",
  );

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Ok" }).click();
  await expect(dialog).not.toBeVisible();

  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Never show again" }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("vibebots-ios-home-screen-prompt-never"),
    ),
  ).toBe("1");

  await page.reload();
  await expect(dialog).not.toBeVisible();
  await context.close();
});

test("mine falling-rock alert can be dismissed or permanently hidden", async ({
  page,
}) => {
  await installGamepadBackControl(page);
  const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
  const mine = createMine(8080, gear, STARTING_CONSUMABLES);
  const c = START_COL;
  for (let row = 1; row <= 6; row++) {
    setCell(mine, c, row, { kind: "empty" });
  }
  setCell(mine, c, 7, { kind: "dirt" });
  for (let dc = 1; dc <= 3; dc++) {
    setCell(mine, c + dc, 5, { kind: "rock", rockTier: 1 });
    setCell(mine, c + dc, 6, { kind: "dirt" });
    setCell(mine, c + dc, 7, { kind: "dirt" });
  }

  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 8080,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "6",
  );

  await pressMineKey(page, "ArrowRight");
  const alert = page.getByRole("dialog", { name: "Falling rock" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(
    "The miner must avoid being under the rock in the next 2 turns.",
  );
  await pressGamepadBack(page);
  await expect(alert).not.toBeVisible();

  await pressMineKey(page, "ArrowRight");
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Never Show Again" }).click();
  await expect(alert).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("vibebots-falling-rock-alert-dismissed"),
      ),
    )
    .toBe("true");

  await page.reload();
  await dismissReleaseNotes(page);
  await pressMineKey(page, "ArrowRight");
  await expect(alert).not.toBeVisible();
});

test("upward mining warns when it starts a falling rock", async ({ page }) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
  const mine = createMine(8180, gear, STARTING_CONSUMABLES);
  const c = START_COL - 1;
  for (let row = 1; row <= 9; row++) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  setCell(mine, START_COL, 10, { kind: "dirt" });
  setCell(mine, c, 9, { kind: "empty" });
  setCell(mine, c, 10, { kind: "dirt" });
  setCell(mine, c, 8, { kind: "dirt" });
  setCell(mine, c, 7, { kind: "rock", rockTier: 1 });

  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-falling-rock-alert-dismissed", "true");
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      mineVersion: MINE_VERSION,
      seed: 8180,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down", "left"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  const status = page.getByLabel("Mine status");
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "9",
  );
  await expect(status).toHaveAttribute("data-ladders", "8");
  const before = await canvas.screenshot();
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(async () => canvas.getAttribute("data-falling-rock-warning"), {
      timeout: 5_000,
    })
    .toBe("true");
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        repeat: true,
        bubbles: true,
      }),
    );
  });
  await page.waitForTimeout(120);
  await expect(status).toHaveAttribute("data-depth", "9");
  await expect(status).toHaveAttribute("data-ladders", "8");
  await page.keyboard.up("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "8");
  await expect(status).toHaveAttribute("data-ladders", "7");
  const after = await canvas.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  await expect(page.getByRole("dialog", { name: "Falling rock" })).toBeHidden();
});

test("mine feedback form submits from settings and closes with gamepad back", async ({
  page,
}) => {
  await installGamepadBackControl(page);
  let feedbackBody: unknown = null;
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/feedback", async (route) => {
    feedbackBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ saved: true }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Feedback" });
  await expect(dialog).toBeVisible();
  await dialog.locator("select").selectOption("balance");
  await dialog.getByLabel("Comment").fill("The new support rule feels fair.");
  await dialog.getByLabel("Email (optional)").fill("miner@example.test");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog.getByRole("status")).toContainText("Feedback saved.");
  expect(feedbackBody).toMatchObject({
    category: "balance",
    comment: "The new support rule feels fair.",
    email: "miner@example.test",
    context: {
      source: "pause",
      mineVersion: MINE_VERSION,
    },
  });

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const settingsAgain = await openSettings(page);
  await settingsAgain.getByRole("button", { name: "Feedback" }).click();
  await expect(dialog).toBeVisible();
  await pressGamepadBack(page);
  await expect(dialog).not.toBeVisible();
});

test("ladder gravity prompt opens mechanic feedback after the fall settles", async ({
  page,
}) => {
  const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
  const mine = createMine(8282, gear, STARTING_CONSUMABLES);
  const c = START_COL;
  mine.miner.col = c;
  mine.miner.row = 2;
  setCell(mine, c, 2, { kind: "empty" });
  setCell(mine, c, 3, { kind: "dirt" });
  setCell(mine, c + 1, 1, { kind: "empty", ladder: true });
  setCell(mine, c + 1, 2, { kind: "dirt" });
  setCell(mine, c + 1, 3, { kind: "empty" });
  setCell(mine, c + 1, 4, { kind: "dirt" });
  let feedbackBody: unknown = null;

  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/feedback", async (route) => {
    feedbackBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ saved: true }),
    });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 8282,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "2",
  );
  await pressMineKey(page, "ArrowRight");

  const prompt = page.getByRole("dialog", {
    name: "Ladders can fall now",
  });
  await expect(prompt).toBeVisible({ timeout: 3_000 });
  await expect(prompt.getByRole("button", { name: "Ok" })).toBeVisible();
  await expect(
    prompt.getByRole("button", { name: "Give Feedback Now" }),
  ).toBeVisible();
  await expect(
    prompt.getByRole("button", { name: "Never Show Again" }),
  ).toBeVisible();

  await prompt.getByRole("button", { name: "Give Feedback Now" }).click();
  const dialog = page.getByRole("dialog", { name: "Feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Ladder gravity mechanic");
  await dialog.getByLabel("Comment").fill("The slide made the shaft clearer.");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(dialog.getByRole("status")).toContainText("Feedback saved.");
  expect(feedbackBody).toMatchObject({
    category: "confusing",
    comment: "The slide made the shaft clearer.",
    email: "",
    context: {
      source: "ladder-gravity",
      prompt: "ladder-fall-after-mining-support",
      mineVersion: MINE_VERSION,
      depth: 2,
      column: 1,
    },
  });
});

test("mine bag chip opens a scrollable capacity grid", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  const gear = { ...DEFAULT_GEAR, battery: 4, cargo: 4 };
  const mine = createMine(8181, gear, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, {
    kind: "empty",
    drop: { coal: 5, diamond: 2 },
  });

  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
      let cancelPressed = false;
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [
          {
            buttons: Array.from({ length: 17 }, (_, index) => ({
              pressed: index === 1 && cancelPressed,
              touched: index === 1 && cancelPressed,
              value: index === 1 && cancelPressed ? 1 : 0,
            })),
          },
        ],
      });
      Object.defineProperty(window, "__setBagCancelPressed", {
        configurable: true,
        value: (pressed: boolean) => {
          cancelPressed = pressed;
        },
      });
    },
    {
      seed: 8181,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "1",
  );

  const bagButton = page.getByRole("button", { name: "Open bag" });
  await expect(bagButton).toBeVisible();
  await expect(bagButton).toContainText("7 ore (2/32)");
  await expect(page.getByLabel("Mine status").getByText("Coal x5")).toHaveCount(
    0,
  );

  await bagButton.click();
  await expect(page.getByRole("dialog", { name: "Bag 2/32" })).toBeVisible();
  const dialog = page.locator("#mine-bag-panel");
  await expect(dialog).toHaveAttribute("data-bag-variant", "tool-satchel");
  await expect(dialog).toHaveAttribute("data-bag-capacity", "32");
  await expect(dialog).toHaveAttribute("data-bag-filled", "2");
  await expect(dialog).toHaveAttribute("data-bag-ore-count", "7");
  await expect(dialog).toHaveAttribute("data-bag-stack-limit", "5");
  await expect(dialog.locator("[data-bag-lid='true']")).toBeVisible();
  await expect(dialog.locator("[data-bag-tray='true']")).toBeVisible();
  await expect(dialog.getByText("Stack slots", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Ore chunks", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Scrap", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Parts", { exact: true })).toBeVisible();
  const coalStack = dialog.locator("[data-ore='coal']");
  const diamondStack = dialog.locator("[data-ore='diamond']");
  await expect(coalStack).toHaveCount(1);
  await expect(coalStack).toHaveAttribute("data-stack-count", "5");
  await expect(coalStack).toHaveAttribute("data-stack-full", "true");
  await expect(
    coalStack.locator("[data-stack-full-overlay='true']"),
  ).toBeVisible();
  await expect(diamondStack).toHaveCount(1);
  await expect(diamondStack).toHaveAttribute("data-stack-count", "2");
  await expect(diamondStack).toHaveAttribute("data-stack-full", "false");
  await expect(
    diamondStack.locator("[data-resource-graphic='true']"),
  ).toBeVisible();
  await expect(dialog.locator("[data-empty-cell='true']")).toHaveCount(30);
  const dropButton = dialog.getByRole("button", { name: "Drop selected" });
  await expect(dropButton).toBeDisabled();
  await coalStack
    .getByRole("button", { name: "Select Coal stack of 5 for dropping" })
    .click();
  await expect(dropButton).toContainText("5");
  await expect(dropButton).toBeEnabled();
  await dropButton.click();
  await expect(dialog).toHaveAttribute("data-bag-filled", "1");
  await expect(dialog).toHaveAttribute("data-bag-ore-count", "2");
  await expect(dialog.locator("[data-ore='coal']")).toHaveCount(0);
  await expect(dialog.locator("[data-empty-cell='true']")).toHaveCount(31);
  const scrollState = await dialog
    .locator("[data-bag-scroll='true']")
    .evaluate((node) => {
      const element = node as HTMLElement;
      return {
        clientHeight: element.clientHeight,
        overflowY: window.getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
      };
    });
  expect(scrollState.overflowY).toBe("auto");
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);

  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();

  await bagButton.click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const setter = (
      window as unknown as Window & {
        __setBagCancelPressed: (pressed: boolean) => void;
      }
    ).__setBagCancelPressed;
    setter(true);
  });
  await expect(dialog).not.toBeVisible();
});

test("save slot deletion requires a destructive double confirmation", async ({
  page,
}) => {
  let deleteRequests = 0;
  await page.route("**/api/save-slots", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 12,
              deepestDepth: 5,
              partsOwned: 2,
              designs: 1,
              stamps: 3,
            },
            {
              slot: 2,
              active: false,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 4,
              deepestDepth: 2,
              partsOwned: 1,
              designs: 1,
              stamps: 1,
            },
            {
              slot: 3,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
          ],
        },
      });
      return;
    }
    if (request.method() === "DELETE") {
      deleteRequests++;
      expect(request.postDataJSON()).toEqual({
        slot: 2,
        confirm: "DELETE SLOT 2",
      });
      await route.fulfill({
        json: {
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 12,
              deepestDepth: 5,
              partsOwned: 2,
              designs: 1,
              stamps: 3,
            },
            {
              slot: 2,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
            {
              slot: 3,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
          ],
        },
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Load game" }).click();
  const saveSlots = page.getByRole("dialog", { name: "Load Save Slot" });
  await expect(saveSlots).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(saveSlots).not.toBeVisible();
  const settingsAgain = await openSettings(page);
  await settingsAgain.getByRole("button", { name: "Load game" }).click();
  await expect(saveSlots).toBeVisible();

  const slotTwo = saveSlots.getByRole("group", { name: "Slot 2" });
  await slotTwo.getByRole("button", { name: "Delete" }).click();
  expect(deleteRequests).toBe(0);
  await expect(slotTwo).toContainText("Destructive action");
  await expect(slotTwo).toContainText("cannot be restored");

  await slotTwo.getByRole("button", { name: "Delete Slot 2 Forever" }).click();
  await expect(slotTwo).toContainText("New game");
  expect(deleteRequests).toBe(1);
});

test("mine rotates surface game tips and sometimes leaves the slot empty", async ({
  page,
}) => {
  await page.setViewportSize({ width: 575, height: 1280 });
  await page.addInitScript(() => {
    const w = window as typeof window & {
      __vibebotsSurfaceTipSequence?: (string | null)[];
      __vibebotsSurfaceTipRotationMs?: number;
    };
    w.__vibebotsSurfaceTipSequence = [
      "Tip: rich ore can burst for bigger chunks, but a dry strike still drains battery.",
      "Tip: press up into a solid block to mine overhead without spending a ladder.",
      null,
    ];
    w.__vibebotsSurfaceTipRotationMs = 5_000;
  });
  await page.goto("/mine");
  await dismissReleaseNotes(page);

  const status = page.getByLabel("Mine status");
  await expect(status).toContainText(
    "Tip: rich ore can burst for bigger chunks, but a dry strike still drains battery.",
  );
  const longTip = page.getByText(
    "Tip: rich ore can burst for bigger chunks, but a dry strike still drains battery.",
    { exact: true },
  );
  await expect(longTip).toBeVisible();
  const box = await longTip.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(575 - 12);
  expect(box?.height ?? 0).toBeGreaterThan(22);
  await expect(status).toContainText(
    "Tip: press up into a solid block to mine overhead without spending a ladder.",
    { timeout: 8_000 },
  );
  await expect(status).not.toContainText("Tip:", { timeout: 8_000 });
});

test("ladders count as support: no plank spent crossing the shaft mouth (REQ-022)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  // A fresh player starts with the one-time plank gift.
  await expect(status).toHaveAttribute("data-planks", "4");

  // Dig a two-deep shaft, climb out one (planting a ladder in the cell
  // below), tunnel one cell left, then step back across the shaft
  // mouth: the ladder top under the step is support, so the crossing
  // must NOT consume a plank (the reported bug burned one here).
  await digTo(page, 2);
  await expect(status).toHaveAttribute("data-depth", "2");
  await pressMineKey(page, "ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "1");
  await digLateral(page, "ArrowLeft", -0.8);
  await pressMineKey(page, "ArrowRight");
  await expect(status).toHaveAttribute("data-ladders", "7");
  await expect(status).toHaveAttribute("data-planks", "4");
});

test("plank controls always show both sides with side-specific disabled state", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const placePlankLeft = page.getByRole("button", {
    name: "Place plank left",
  });
  const placePlankRight = page.getByRole("button", {
    name: "Place plank right",
  });

  await expect(placePlankLeft).toBeVisible();
  await expect(placePlankRight).toBeVisible();
  await expect(placePlankLeft).toBeDisabled();
  await expect(placePlankRight).toBeDisabled();

  await digTo(page, 2);
  await digLateral(page, "ArrowRight", 0.8);
  await pressMineKey(page, "ArrowLeft");
  await pressMineKey(page, "ArrowUp");
  await expect(status).toHaveAttribute("data-depth", "1");
  await expect(placePlankLeft).toBeVisible();
  await expect(placePlankRight).toBeVisible();
  await expect(placePlankLeft).toBeDisabled();
  await expect(placePlankRight).toBeEnabled();
});

test("mine actions begin immediately and settle smoothly (REQ-018, REQ-023)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => canvas.getAttribute("data-miner-x"), { timeout: 5_000 })
    .not.toBeNull();

  const initialX = Number(await canvas.getAttribute("data-miner-x"));
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 1_000,
    })
    .toBeGreaterThan(initialX + 0.05);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 600,
    })
    .toBeGreaterThan(initialX + 0.85);

  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 1_000,
    })
    .toBeGreaterThan(initialX + 1.05);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 600,
    })
    .toBeGreaterThan(initialX + 1.85);

  const beforeStrike = await canvas.screenshot();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(90);
  const afterStrike = await canvas.screenshot();
  expect(Buffer.compare(beforeStrike, afterStrike)).not.toBe(0);
});

test("thumbstick spawns where pressed and drives digging (REQ-023)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Game text never selects (the mobile long-press copy/share bug).
  expect(
    await page.evaluate(() => getComputedStyle(document.body).userSelect),
  ).toBe("none");

  // Fine-pointer devices keep the keyboard mention in the hint.
  await expect(page.getByText(/drag anywhere to move/)).toContainText("WASD");

  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-miner-x"), { timeout: 5_000 })
    .not.toBeNull();

  const initialX = Number(await canvas.getAttribute("data-miner-x"));
  await page.mouse.move(760, 380);
  await page.mouse.down();
  await page.mouse.move(860, 380, { steps: 5 });
  await expect(page.locator("[data-joystick]")).toBeVisible();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 3_500,
    })
    .toBeGreaterThan(initialX + 3.75);
  await page.mouse.up();
  await expect(page.locator("[data-joystick]")).not.toBeVisible();

  // Press on open ground right of the panels: the stick appears there.
  await page.mouse.move(900, 380);
  await page.mouse.down();
  await page.mouse.move(900, 450, { steps: 5 });
  await expect(page.locator("[data-joystick]")).toBeVisible();

  // Holding past the deadzone fires immediately, then auto-repeats.
  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")), {
      timeout: 12_000,
    })
    .toBeGreaterThanOrEqual(2);

  await page.mouse.up();
  await expect(page.locator("[data-joystick]")).not.toBeVisible();
});

test("abandoning a stuck trip hauls up and forfeits the carry (REQ-025)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");
  const abandon = page.getByRole("button", { name: "Abandon trip" });
  await expect(abandon).toBeDisabled();

  await digTo(page, 1);
  await expect(status).toHaveAttribute("data-depth", "1");
  await expect(abandon).toBeEnabled();

  // Two-tap confirm: the first tap arms, the second fires (the window
  // is 8s, which covers slow CI between two awaited clicks).
  await abandon.click();
  await expect(abandon).toContainText("Sure?");
  await abandon.click();
  await expect(status).toHaveAttribute("data-depth", "0", {
    timeout: 15_000,
  });
  await expect(
    page.getByLabel("Dismiss trip report").getByText("Abandoned the dig"),
  ).toBeVisible();
  // Dismiss the trip report.
  await page.getByLabel("Dismiss trip report").click();
});

test.describe("phone viewport", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

  test("control copy never mentions the keyboard on touch devices", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const hint = page.getByText(/drag anywhere to move/);
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText("WASD");
  });

  test("camera pans laterally so mining left stays on screen", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Dig down one, then tunnel left three: on a 390px-wide portrait
    // viewport the half-width is ~2.6 world units, so without lateral
    // camera tracking the bot at x=-3 left the screen entirely (the
    // reported "horizontal mining does not update the screen").
    await digTo(page, 1);
    await expect(status).toHaveAttribute("data-depth", "1");
    for (let i = 0; i < 18; i++) {
      await pressMineKey(page, "ArrowLeft");
      if (Number(await canvas.getAttribute("data-cam-x")) < -1.5) break;
    }
    // The rig pans toward the miner; the bot stays in frame.
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeLessThan(-1.5);
    // And the visible pixels actually changed across the lateral digs
    // (Rule 10): two frames straddling one more lateral dig differ.
    const before = await canvas.screenshot();
    await pressMineKey(page, "ArrowRight");
    await page.waitForTimeout(250);
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test("walking the surface shop row stays responsive", async ({ page }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-depth", "0");
    await page.waitForTimeout(800);

    // Walk left across the shops (the elevator is five columns out) and confirm
    // the camera actually tracks the whole way: the static village (no
    // per-step reconciliation) must not stall input. Absolute frame time
    // is not asserted here, since CI's software renderer is far slower
    // than any device; data-frame-ms exists for manual perf probing.
    for (let i = 0; i < 8; i++) {
      await pressMineKey(page, "ArrowLeft");
    }
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeLessThan(-3);
    // The frame-time stat is wired up (a real number, not NaN/absent).
    expect(Number(await canvas.getAttribute("data-frame-ms"))).toBeGreaterThan(
      0,
    );
    // Walking back the other way still tracks, so input never wedged.
    for (let i = 0; i < 10; i++) {
      await pressMineKey(page, "ArrowRight");
    }
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-cam-x")), {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);
  });

  test("mine posts a compact performance sample", async ({ page }) => {
    const samples: unknown[] = [];
    await page.route("**/api/performance", async (route) => {
      samples.push(route.request().postDataJSON());
      await route.fulfill({ json: { saved: true } });
    });
    await page.addInitScript(() => {
      const w = window as typeof window & {
        __vibebotsPerfInitialDelayMs?: number;
        __vibebotsPerfSampleMs?: number;
        __vibebotsPerfRepeatMs?: number;
        __vibebotsPerfMinSendIntervalMs?: number;
      };
      w.__vibebotsPerfInitialDelayMs = 0;
      w.__vibebotsPerfSampleMs = 2_000;
      w.__vibebotsPerfRepeatMs = 60_000;
      w.__vibebotsPerfMinSendIntervalMs = 0;
    });

    await page.goto("/mine");
    await expect(page.locator("canvas")).toBeVisible();
    await dismissReleaseNotes(page);
    await expect.poll(() => samples.length, { timeout: 15_000 }).toBe(1);
    const payload = samples[0] as Record<string, unknown>;
    expect(payload.source).toBe("mine");
    expect(String(payload.appVersion)).toMatch(APP_VERSION_PATTERN);
    expect(payload.mineVersion).toBe(MINE_VERSION);
    expect(payload.frameCount).toBeGreaterThan(5);
    expect(payload.p95FrameMs).toBeGreaterThan(0);
    expect(payload.viewportWidth).toBeGreaterThan(0);
    expect(payload.devicePixelRatio).toBeGreaterThan(0);
  });

  test("a downward drag on the sheet handle dismisses it", async ({ page }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Stand at the Supply Depot (two columns right of the shaft) and
    // tap the prompt to open the sheet.
    for (let i = 0; i < 2; i++) {
      await pressMineKey(page, "ArrowRight");
    }
    const depot = await openStall(page, "Supply Depot");
    // Let the slide-up entrance (0.28s) settle so the docked baseline
    // is the resting position, not a mid-animation frame.
    await page.waitForTimeout(450);

    // Grab the top of the sheet (the drag handle).
    const box = await depot.boundingBox();
    if (!box) throw new Error("sheet has no bounding box");
    const x = box.x + box.width / 2;
    const y = box.y + 8;
    await page.mouse.move(x, y);
    await page.mouse.down();

    // Rule 10: the sheet visibly follows the finger before release. Pull
    // partway (under the close threshold) and confirm it actually moved
    // down, then that a short pull snaps back to its docked position.
    await page.mouse.move(x, y + 40);
    await page.waitForTimeout(30);
    const dragged = await depot.boundingBox();
    if (!dragged) throw new Error("sheet vanished mid-drag");
    expect(dragged.y).toBeGreaterThan(box.y + 15);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const snapped = await depot.boundingBox();
    if (!snapped) throw new Error("sheet dismissed on a sub-threshold drag");
    expect(snapped.y).toBeLessThan(dragged.y - 10);
    await expect(depot).toBeVisible();

    // Now a full pull past the threshold dismisses, still on the column.
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x, y + i * 25);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await expect(depot).not.toBeVisible();
    await expect(status).toHaveAttribute("data-depth", "0");
  });
});

test("mine wheel zoom extends into the starter lantern falloff", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => canvas.getAttribute("data-cam-zoom"), {
      timeout: 5_000,
    })
    .not.toBeNull();

  const startZoom = Number(await canvas.getAttribute("data-cam-zoom"));
  await page.mouse.move(500, 380);
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeLessThan(startZoom);

  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 600);
  }
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeGreaterThan(startZoom);
  await expect(canvas).toHaveAttribute("data-lit-below", "3");
  await expect(canvas).toHaveAttribute("data-render-below", "5");
  await expect(canvas).toHaveAttribute("data-render-radius", "5");
  await expect(canvas).toHaveAttribute(
    "data-render-min-col",
    String(START_COL - 5),
  );
  await expect(canvas).toHaveAttribute(
    "data-render-max-col",
    String(START_COL + 5),
  );
});

test("the carved world survives a reload (REQ-026)", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Dig a two-deep shaft, then abandon (a trip-ending moment, which
  // checkpoints the guest world to local storage).
  await digTo(page, 2);
  const abandon = page.getByRole("button", { name: "Abandon trip" });
  await abandon.click();
  await expect(abandon).toContainText("Sure?");
  await abandon.click();
  await expect(status).toHaveAttribute("data-depth", "0", {
    timeout: 15_000,
  });
  await page.getByLabel("Dismiss trip report").click();

  // Reload: the mine must still be carved. Descending the old shaft
  // is one paid walk, then gravity settles the miner through empty cells.
  await page.reload();
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "0");
  await pressMineKey(page, "ArrowDown");
  await expect(status).toHaveAttribute("data-depth", "2");
  await expect(status).toHaveAttribute("data-energy", "59.5");

  // And a MID-TRIP reload resumes exactly where the trip stood: the
  // in-flight log replays over the trip-start checkpoint, so depth and
  // energy come back identical (carry included).
  const energyBefore = await status.getAttribute("data-energy");
  await page.reload();
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "2");
  await expect(status).toHaveAttribute("data-energy", energyBefore ?? "");
});

test("surface village stalls open their menus on tap (REQ-021)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Walk left from the shaft to the Hardware Store; the menu does not pop
  // on walk-by, the prompt does, and tapping it opens the menu.
  for (let i = 0; i < 3; i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  await expect(
    page.getByRole("region", { name: "Hardware Store", exact: true }),
  ).not.toBeVisible();
  const buyer = await openStall(page, "Hardware Store");
  await expect(buyer).toContainText("Wall");
  await expect(buyer).toContainText("Floor");
  await expect(buyer).toContainText("Roof");
  await expect(buyer).toContainText("Door");
  await expect(buyer).toContainText("Basic Turret");
  await expect(buyer).toContainText("Requires level 2");
  await expect(buyer).toContainText("3 shots per raid");
  await expect(buyer).toContainText("Breaks after 5 Clanker hits");
  await expect(buyer).toContainText("Floor Spikes");
  await expect(buyer).toContainText("Breaks after 3 steps");
  await expect(buyer).toContainText("Limit 4 at your level");

  // Walk right to the Supply Depot: consumables with prices.
  for (let i = 0; i < 5; i++) {
    await pressMineKey(page, "ArrowRight");
  }
  const depot = await openStall(page, "Supply Depot");
  await expect(depot).toContainText("Ladder");
  await expect(depot).toContainText("have");
  await expect(depot).toContainText("Buy 1 for 2 vibes");
  await expect(depot).not.toContainText("Basic Turret");
  await expect(depot).not.toContainText("Floor Spikes");
  await depot.getByRole("button", { name: "x5" }).click();
  await expect(depot).toContainText("Buy 5 for 10 vibes");

  // And on to the Upgrades stall: the gear tracks.
  for (let i = 0; i < 2; i++) {
    await pressMineKey(page, "ArrowRight");
  }
  const upgrades = await openStall(page, "Upgrades");
  await expect(upgrades).toContainText("Pickaxe");
  await expect(upgrades).toContainText("Cargo Hold");
  await expect(upgrades).toContainText("Fall Harness");

  // Walking off the stall column closes the menu.
  await pressMineKey(page, "ArrowLeft");
  await expect(upgrades).not.toBeVisible();
});

test("a stall opens on tap and closes back to the prompt", async ({ page }) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // Stand at the Hardware Store (three columns left of the shaft).
  for (let i = 0; i < 3; i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  const prompt = page.getByRole("button", { name: "Open Hardware Store" });
  const buyer = page.getByRole("region", {
    name: "Hardware Store",
    exact: true,
  });
  await expect(prompt).toBeVisible();
  await expect(buyer).not.toBeVisible();

  // Tap opens; the close button dismisses without walking away (still on
  // the column at depth 0) and the prompt comes back.
  await prompt.click();
  await expect(buyer).toBeVisible();
  await buyer.getByRole("button", { name: "Close shop" }).click();
  await expect(buyer).not.toBeVisible();
  await expect(prompt).toBeVisible();
  await expect(status).toHaveAttribute("data-depth", "0");

  // Tapping the prompt again reopens it.
  await prompt.click();
  await expect(buyer).toBeVisible();
});

test("the warp pad gates jumps on a planted beacon (REQ-029)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // The pad stands six columns right of the shaft.
  for (let i = 0; i < 6; i++) {
    await pressMineKey(page, "ArrowRight");
  }
  const pad = await openStall(page, "Warp Pad");
  await expect(pad).toContainText("no beacon planted");
  await expect(pad).toContainText("range 60 rows");
  await expect(
    pad.getByRole("button", { name: "Warp to beacon" }),
  ).toBeDisabled();
});

test("biome portal beacons activate and appear at the Warp Pad", async ({
  page,
}) => {
  const trip = {
    seed: 20260619,
    mineVersion: MINE_VERSION,
    tripIndex: 0,
    gear: DEFAULT_GEAR,
    consumables: STARTING_CONSUMABLES,
    baseDiff: [],
    moves: Array.from({ length: 75 }, () => "left"),
  };
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.addInitScript((savedTrip) => {
    localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(savedTrip));
  }, trip);
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  const activate = page.getByRole("button", {
    name: "Activate Winter Beacon",
  });
  await expect(activate).toBeVisible();
  const canvas = page.locator("canvas");
  const before = await canvas.screenshot();
  await activate.click();
  const portal = page.getByRole("region", { name: "Winter Beacon portal" });
  await expect(portal).toBeVisible();
  const after = await canvas.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);

  await portal.getByRole("button", { name: "Base" }).click();
  await expect(status).toHaveAttribute("data-depth", "0");
  for (let i = 0; i < 6; i++) await pressMineKey(page, "ArrowRight");
  const pad = await openStall(page, "Warp Pad");
  await expect(pad).toContainText("Winter Beacon");
  await expect(pad).toContainText("portals are free");
});

test("deep dropped ore markers do not create a white text card", async ({
  page,
}) => {
  const gear = {
    ...DEFAULT_GEAR,
    pickaxe: 5,
    battery: 5,
    cargo: 5,
    lantern: 4,
    warpcoil: 4,
  };
  const consumables = { ...STARTING_CONSUMABLES, beacon: 0 };
  const trip = {
    seed: 12345,
    mineVersion: MINE_VERSION,
    tripIndex: 0,
    gear,
    consumables,
    baseDiff: [
      [0, 665, { kind: "empty", beacon: true, drop: { coal: 12 } }],
      [1, 665, { kind: "rock", rockTier: 3, fallen: true }],
      [1, 664, { kind: "rock", rockTier: 3, fallen: true }],
      [0, 666, { kind: "rock", rockTier: 3, fallen: true }],
      [-1, 665, { kind: "empty" }],
      [0, 664, { kind: "empty" }],
    ],
    moves: ["right", "right", "right", "right", "right", "right", "warp-down"],
  };
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.addInitScript((savedTrip) => {
    localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(savedTrip));
  }, trip);
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "665");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute("data-miner-x", "-1.00");
  const brightPixels = await canvas.evaluate((node) => {
    const source = node as HTMLCanvasElement;
    const sample = document.createElement("canvas");
    sample.width = source.width;
    sample.height = source.height;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    if (!ctx) return Number.POSITIVE_INFINITY;
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
    let bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        data[i] > 245 &&
        data[i + 1] > 245 &&
        data[i + 2] > 245 &&
        data[i + 3] > 180
      ) {
        bright++;
      }
    }
    return bright;
  });
  expect(brightPixels).toBeLessThan(800);
});

test("the warp pad lists beacons newest first (REQ-029)", async ({ page }) => {
  const mine = createMine(9797, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 3, {
    kind: "empty",
    beacon: true,
    beaconOrder: 1,
  });
  setCell(mine, START_COL - 2, 70, {
    kind: "empty",
    beacon: true,
    beaconOrder: 2,
  });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        balance: 0,
      },
    });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 9797,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: [],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  for (let i = 0; i < 6; i++) {
    await pressMineKey(page, "ArrowRight");
  }
  const pad = await openStall(page, "Warp Pad");
  await expect(pad).toContainText("2 destinations online");
  await expect(pad).toContainText("row 70, col -2 out of range");
  await expect(pad).toContainText("row 3, col 0");
  await expect(
    pad.getByRole("button", { name: "Warp" }).first(),
  ).toBeDisabled();
  await expect(pad.getByRole("button", { name: "Warp" }).nth(1)).toBeEnabled();
  await pad.getByLabel("Rename Newest beacon").fill("Deep Door");
  await pad.getByRole("button", { name: "Rename" }).first().click();
  await expect(pad).toContainText("Deep Door");
});

test("the elevator sells rail and gates rides on it (REQ-028)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  // The tower stands five columns left of the shaft.
  for (let i = 0; i < 5; i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  const elevator = await openStall(page, "Elevator");
  await expect(elevator).toContainText("no rail yet");
  await expect(elevator).toContainText("45 vibes");
  // Without rail the ride is disabled; without storage so is the buy.
  await expect(
    elevator.getByRole("button", { name: /Ride down|Auto ride/ }),
  ).toBeDisabled();
});

test("elevator controls work from any elevator floor", async ({ page }) => {
  const gear = { ...DEFAULT_GEAR, elevator: ELEVATOR_SEGMENT_ROWS };
  const mine = createMine(9292, gear, STARTING_CONSUMABLES);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear,
        consumables: STARTING_CONSUMABLES,
        balance: 0,
      },
    });
  });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 9292,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: [],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(canvas).toHaveAttribute("data-miner-x", "0.00");
  await expect(
    page.getByRole("button", { name: "Ride elevator down" }),
  ).not.toBeVisible();

  for (let i = 0; i < Math.abs(ELEVATOR_COL - START_COL); i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  await expect(canvas).toHaveAttribute("data-miner-x", "-5.00");

  const rideDown = page.getByRole("button", { name: "Ride elevator down" });
  await expect(rideDown).toBeVisible();
  await rideDown.click();

  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")), {
      timeout: 5_000,
    })
    .toBe(ELEVATOR_SEGMENT_ROWS);
  await expect(canvas).toHaveAttribute("data-miner-x", "-5.00");

  const rideUp = page.getByRole("button", { name: "Ride elevator up" });
  await expect(rideUp).toBeVisible();
  await expect(rideUp).toBeEnabled();
});

test("miner stays at depth when walking sideways (lateral teleport regression)", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  // Rows 1-2 are rock-free and hazard-free, so digging down and one
  // lateral dig are guaranteed to succeed regardless of the session seed.
  await digTo(page, 2);
  await expect(status).toHaveAttribute("data-depth", "2");

  // Wait for the eased render position to settle at the dug depth.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-y")), {
      timeout: 15_000,
    })
    .toBeLessThan(-1.8);

  // Record the highest rendered Y across every frame of the lateral step.
  await page.evaluate(() => {
    const el = document.querySelector("canvas");
    const w = window as unknown as { __maxMinerY: number; __minerRaf: number };
    w.__maxMinerY = Number.NEGATIVE_INFINITY;
    const sample = () => {
      const y = Number(el?.getAttribute("data-miner-y"));
      if (!Number.isNaN(y)) w.__maxMinerY = Math.max(w.__maxMinerY, y);
      w.__minerRaf = requestAnimationFrame(sample);
    };
    sample();
  });

  for (let i = 0; i < 6; i++) {
    await pressMineKey(page, "ArrowLeft");
  }
  // The miner glides one cell left (start col 4 renders at x=0, col 3 at -1)...
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 15_000,
    })
    .toBeLessThan(-0.8);

  const maxY = await page.evaluate(() => {
    const w = window as unknown as { __maxMinerY: number; __minerRaf: number };
    cancelAnimationFrame(w.__minerRaf);
    return w.__maxMinerY;
  });
  // ...without ever lifting toward the surface. The old bug re-applied the
  // JSX position prop on column changes, snapping the rendered Y to 0.
  expect(maxY).toBeLessThan(-1.5);
});

test("workshop sells parts and shows balance (needs storage)", async ({
  page,
  request,
}) => {
  const probe = await request.get("/api/shop");
  test.skip(
    probe.status() === 503,
    "storage not configured in this environment",
  );

  // Parts buying lives inside the Workshop now; the standalone /shop is gone.
  await page.goto("/workshop");
  const shop = page.getByLabel("Parts shop");
  await expect(shop).toBeVisible();
  await expect(shop.getByText("vibes").first()).toBeVisible();
  await expect(shop.getByText("Drive Wheel")).toBeVisible();
});

test("garage saves and lists designs (needs storage)", async ({
  page,
  request,
}) => {
  const probe = await request.get("/api/designs");
  test.skip(
    probe.status() === 503,
    "storage not configured in this environment",
  );

  await page.goto("/workshop");
  const garage = page.getByLabel("Saved designs");
  await expect(garage).toBeVisible();
  const name = `E2E Bot ${Date.now()}`;
  await garage.getByLabel("Design name").fill(name);
  await garage.getByLabel("Design name").blur();
  await garage.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("saved to the garage")).toBeVisible();
  await expect(garage.getByRole("button", { name })).toBeVisible();
});

test("match resolve API returns a deterministic official result", async ({
  request,
}) => {
  const payload = {
    designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
    simVersion: SIM_VERSION,
    timeLimitTicks: 600,
  };
  const first = await request.post("/api/match/resolve", { data: payload });
  expect(first.ok()).toBeTruthy();
  const a = await first.json();
  expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(a.status.over).toBe(true);

  const second = await request.post("/api/match/resolve", { data: payload });
  const b = await second.json();
  expect(b.hash).toBe(a.hash);
});

test("sim verify API returns a stable deterministic hash", async ({
  request,
}) => {
  const first = await request.get("/api/sim/verify?seed=42&steps=300");
  expect(first.ok()).toBeTruthy();
  const a = await first.json();
  expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(a.simVersion).toBe(SIM_VERSION);

  const second = await request.get("/api/sim/verify?seed=42&steps=300");
  const b = await second.json();
  expect(b.hash).toBe(a.hash);
});
