import { expect, type Page, test } from "@playwright/test";
import { imagePixelDifferenceRatio } from "./support/image-pixels";
import {
  countRaidXpPixels,
  countRedPixels,
  createMine,
  DEFAULT_GEAR,
  digTo,
  dismissReleaseNotes,
  exportDiff,
  installGamepadBackControl,
  MINE_VERSION,
  pressGamepadBack,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "./support/mine-helpers";

function deferredSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Aims the fp camera through the one-shot test hook and waits for the
 * rig to consume it (the mine-bunker-fp.spec.ts helper). */
async function aimFp(page: Page, yaw: number, pitch: number): Promise<void> {
  await page.evaluate(
    ([yawValue, pitchValue]) => {
      (
        window as unknown as {
          __vibebotsFp?: { setYaw?: number; setPitch?: number };
        }
      ).__vibebotsFp = { setYaw: yawValue, setPitch: pitchValue };
    },
    [yaw, pitch] as const,
  );
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-yaw")), {
      timeout: 10_000,
    })
    .toBeCloseTo(yaw, 1);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-pitch")), {
      timeout: 10_000,
    })
    .toBeCloseTo(pitch, 1);
}

/** First canvas click acquires (or proves unavailable) pointer lock
 * and is swallowed by design; later clicks act. */
async function armFpPointer(page: Page): Promise<void> {
  const canvas = page.locator("canvas");
  await canvas.click();
  await expect
    .poll(async () => canvas.getAttribute("data-fp-lock"), {
      timeout: 10_000,
    })
    .not.toBe("unlocked");
}

/** Places one wall from the fp hotbar into local cell (2,0,0) (mine
 * cell START_COL - 1 on the claim's bottom row): the shared fp editing
 * step for the pending-claim tests below. */
async function placeWallInFp(page: Page): Promise<void> {
  await page.getByTestId("bunker-fp-enter").click();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-fp-mode",
    "1",
  );
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();
  const wallSlot = page.getByTestId("bunker-fp-slot-wall-panel");
  await wallSlot.click();
  await expect(wallSlot).toHaveAttribute("aria-pressed", "true");
  // Aim down-left from the spawn: the ray crosses open cell (2,0,0)
  // and lands on the floor boundary, making the crossed cell the
  // place cell (the mine-bunker-fp.spec.ts geometry).
  await aimFp(page, 1.57, -0.62);
  await expect
    .poll(async () => canvas.getAttribute("data-fp-place"), {
      timeout: 10_000,
    })
    .toBe("2:0:0");
  await armFpPointer(page);
  await canvas.click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
            ).pendingBunker?.bunker.parts.length ?? 0,
        ),
      { timeout: 10_000 },
    )
    .toBe(1);
}

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
      "wall-panel": 6,
      "floor-panel": 4,
      "roof-panel": 4,
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
      levelCap: 100,
      progressXp: 20,
      neededXp: 80,
      nextLevelXp: 200,
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
              batterySteps: 9,
              deathStep: 9,
              status: "battery-drained",
              path: [
                { col: START_COL - 6, row: 0 },
                { col: START_COL - 5, row: 0 },
                { col: START_COL - 4, row: 0 },
                { col: START_COL - 3, row: 0 },
                { col: START_COL - 3, row: 1 },
                { col: START_COL - 3, row: 1 },
                { col: START_COL - 3, row: 1 },
                { col: START_COL - 3, row: 1 },
                { col: START_COL - 3, row: 1 },
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
          partDamage: [
            {
              clankerId: "clanker-1",
              col: START_COL - 3,
              row: 1,
              target: "part",
              partId: "wall-panel",
              damage: 40,
            },
          ],
          coreDamage: 0,
          xpPickups: [
            {
              id: "clanker-1-xp",
              col: START_COL - 3,
              row: 0,
              defenseXp: 25,
              collected: false,
            },
          ],
          allClankersDead: true,
          breached: false,
          minerKilled: false,
          survived: true,
          reward: { vibes: 30, defenseXp: 25 },
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
          partDamage: [],
          coreDamage: 0,
          xpPickups: [],
          allClankersDead: true,
          breached: false,
          minerKilled: false,
          survived: true,
          reward: { vibes: 30, defenseXp: 25 },
        },
      }),
    });
  });
  await page.route("**/api/bunker/raid/collect", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bunkerView),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const builder = page.getByRole("region", { name: "Bunker status" });
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Level 2/100",
  );
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Beacon cap 3",
  );
  await builder.getByRole("button", { name: "Start Clanker raid" }).click();
  await expect(builder).toBeVisible();
  await expect(builder).toContainText("1 Clanker dead");
  await expect(builder).toContainText("Walk over 25 defense XP on the ground");
  await expect(builder.getByRole("button", { name: "Place" })).toHaveCount(0);
  await expect(builder.getByRole("button", { name: "Remove" })).toHaveCount(0);
  // Editing after a survived raid happens in first person: the Enter
  // affordance stays, the retired 2D toolbelt never mounts.
  await expect(page.getByTestId("bunker-fp-enter")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Bunker build tool" }),
  ).toHaveCount(0);
  await expect(
    builder.getByRole("button", { name: "Walk over raid XP" }),
  ).toBeDisabled();
  const xpLocator = page.locator("[data-raid-xp-direction]");
  await expect(xpLocator).toBeVisible();
  await expect(xpLocator).toHaveAttribute("data-raid-xp-direction", "up-left");
  await expect(xpLocator).toHaveAttribute("data-raid-xp-row-distance", "1");
  await expect(xpLocator).toHaveAttribute("data-raid-xp-col-distance", "3");
});

test("mine retries raid XP pickup while the miner overlaps it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const activeRaid = {
    raidId: "raid-pickup-retry",
    tier: 1,
    durationSeconds: 180,
    startedAtMs: Date.now(),
    clankers: [],
    turretShots: 0,
    turretDamage: 0,
    spikeTriggers: 0,
    spikeDamage: 0,
    totalPartDurability: 90,
    incomingDamage: 0,
    partDamage: [],
    coreDamage: 0,
    xpPickups: [
      {
        id: "clanker-1-xp",
        col: START_COL - 1,
        row: 1,
        defenseXp: 25,
        collected: false,
      },
    ],
    allClankersDead: true,
    breached: false,
    minerKilled: false,
    survived: true,
    reward: { vibes: 30, defenseXp: 25 },
  };
  const collectedRaid = {
    ...activeRaid,
    xpPickups: [{ ...activeRaid.xpPickups[0], collected: true }],
  };
  const bunkerView = {
    bunker: {
      footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
      core: { col: START_COL, row: 3, durability: 160 },
      parts: [],
    },
    inventory: {
      "wall-panel": 2,
      "floor-panel": 3,
      "roof-panel": 3,
      "door-panel": 1,
      "basic-turret": 0,
      "floor-spikes": 0,
    },
    activeRaid,
    player: {
      balance: 120,
      trackXp: 40,
      defenseXp: 120,
      overallLevel: 2,
      levelCap: 100,
      progressXp: 20,
      neededXp: 80,
      nextLevelXp: 200,
      beaconLimit: 3,
    },
  };
  let collectAttempts = 0;
  await page.route("**/api/bunker", async (route) => {
    // Mirror the collect route: once the second collect has landed, any
    // bunker refetch must agree, or a poll can revert the collected
    // pickup and hide the builder button behind a phantom active raid.
    const collected = collectAttempts >= 2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        collected ? { ...bunkerView, activeRaid: collectedRaid } : bunkerView,
      ),
    });
  });
  const firstCollectRequest = deferredSignal();
  const releaseFirstCollect = deferredSignal();
  await page.route("**/api/bunker/raid/collect", async (route) => {
    collectAttempts += 1;
    if (collectAttempts === 1) {
      firstCollectRequest.resolve();
      await releaseFirstCollect.promise;
    }
    const collected = collectAttempts >= 2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...bunkerView,
        activeRaid: collected ? collectedRaid : activeRaid,
        raid: collected ? collectedRaid : activeRaid,
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await firstCollectRequest.promise;
  const xpLocator = page.locator("[data-raid-xp-direction]");
  await expect(xpLocator).toBeVisible();
  await expect(xpLocator).toHaveAttribute("data-raid-xp-direction", "here");
  await expect(xpLocator).toContainText("XP here");
  const canvas = page.locator("canvas");
  // The pixel crop assumes the camera has settled on the miner at row 1;
  // a frame-starved runner can lag the rig near the surface for a while.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-y")), {
      timeout: 45_000,
    })
    .toBeLessThan(-0.9);
  await expect
    .poll(async () => countRaidXpPixels(page, await canvas.screenshot()), {
      message: "the raid XP pickup should render as a visible world marker",
      timeout: 20_000,
    })
    .toBeGreaterThan(1_000);
  const pendingXpPixels = await countRaidXpPixels(
    page,
    await canvas.screenshot(),
  );
  releaseFirstCollect.resolve();
  await expect
    .poll(() => collectAttempts, {
      message: "XP pickup should retry while the miner stays on it",
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const builder = page.getByRole("region", { name: "Bunker status" });
  await expect(builder).toContainText("All raid XP collected: 25 defense XP.");
  await expect(xpLocator).toHaveCount(0);
  await expect
    .poll(async () => countRaidXpPixels(page, await canvas.screenshot()), {
      message: "the raid XP pickup world marker should clear after collection",
      timeout: 10_000,
    })
    .toBeLessThan(pendingXpPixels - 500);
  await expect(
    builder.getByRole("button", { name: "Finish raid" }),
  ).toBeVisible();
});

test("mine bunker builder explains miner death after an open Clanker path", async ({
  page,
}) => {
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bunker: {
          footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
          core: { col: START_COL, row: 3, durability: 128 },
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
        activeRaid: {
          raidId: "raid-failed-smoke",
          tier: 1,
          durationSeconds: 3,
          startedAtMs: Date.now() - 3000,
          clankers: [
            {
              id: "clanker-1",
              col: START_COL - 6,
              row: 0,
              targetCol: START_COL,
              targetRow: 3,
              batterySteps: 9,
              deathStep: 8,
              status: "self-destructed",
              path: [
                { col: START_COL - 6, row: 0 },
                { col: START_COL - 5, row: 0 },
                { col: START_COL - 4, row: 0 },
                { col: START_COL - 3, row: 0 },
                { col: START_COL - 2, row: 0 },
                { col: START_COL - 2, row: 1 },
                { col: START_COL - 1, row: 1 },
                { col: START_COL, row: 1 },
                { col: START_COL, row: 2 },
                { col: START_COL, row: 3 },
              ],
            },
          ],
          turretShots: 0,
          turretDamage: 0,
          spikeTriggers: 0,
          spikeDamage: 0,
          totalPartDurability: 90,
          incomingDamage: 32,
          partDamage: [
            {
              clankerId: "clanker-1",
              col: START_COL,
              row: 3,
              target: "core",
              damage: 32,
            },
          ],
          coreDamage: 32,
          xpPickups: [],
          allClankersDead: true,
          breached: true,
          minerKilled: true,
          survived: false,
          reward: { vibes: 0, defenseXp: 0 },
        },
        player: {
          balance: 120,
          trackXp: 40,
          defenseXp: 120,
          overallLevel: 2,
          levelCap: 100,
          progressXp: 20,
          neededXp: 80,
          nextLevelXp: 200,
          beaconLimit: 3,
        },
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const builder = page.getByRole("region", { name: "Bunker status" });
  await expect(builder).toContainText("Miner killed");
  await expect(builder).toContainText("Clankers follow open bunker cells");
  await expect(builder).toContainText("Fully enclose the player cell");
  await expect(page.getByTestId("bunker-fp-enter")).toHaveCount(0);
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
          levelCap: 100,
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

  const builder = page.getByRole("region", { name: "Bunker status" });
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
    "Level 1/100",
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
  await builder.getByRole("button", { name: "Cancel" }).click();
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
  const builder = page.getByRole("region", { name: "Bunker status" });
  await expect(builder).toContainText(/Clear \d+ red cells/);
  await expect(
    builder.getByRole("button", { name: "Claim 7x5 bunker" }),
  ).toBeDisabled();

  const redPixels = await countRedPixels(
    page,
    await page.locator("canvas").screenshot(),
  );
  expect(redPixels).toBeGreaterThan(50);
});

test("bunker claims can be edited before banking", async ({ page }) => {
  // Software-GL runners compile the fp scene slowly.
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 760 });
  const mine = createMine(6061, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 6; row++) {
    for (let col = START_COL - 3; col <= START_COL + 3; col++) {
      setCell(mine, col, row, { kind: "empty" });
    }
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed: 6061,
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
      const key = "vibebots-mine-trip-v2-slot-1";
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(trip));
      }
    },
    {
      seed: 6061,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down", "down", "down", "down", "down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "5",
  );

  await page.getByRole("button", { name: "Start bunker claim" }).click();
  const status = page.getByRole("region", { name: "Bunker status" });
  await expect(status).toContainText(
    "Ready to claim. Build now, then bank at surface to save.",
  );
  await status.getByRole("button", { name: "Claim 7x5 bunker" }).click();
  await expect(status).toContainText("Enter the bunker to build inside");
  await status.getByRole("button", { name: "Close" }).click();

  // The 2D hammer flow retired: no toolbelt region, no part slots or
  // pry tool in the flat view. The single Enter affordance remains.
  await expect(
    page.getByRole("region", { name: "Bunker build tool" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Wall x\d+/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pry" })).toHaveCount(0);
  await expect(page.getByTestId("bunker-fp-enter")).toBeVisible();

  // Cell taps in the flat view no longer edit: tap the claim area and
  // confirm no part appears and no scaffold action ever logs.
  await page.mouse.click(195, 240);
  await page.waitForTimeout(400);
  const tripAfterTap = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}"),
  );
  expect(tripAfterTap.pendingBunker?.bunker.parts).toEqual([]);
  expect(
    (tripAfterTap.moves ?? []).some((move: string) =>
      move.startsWith("bunker-scaffold-"),
    ),
  ).toBe(false);

  // Building happens inside: enter first person and place one wall
  // from the hotbar into the pending (unbanked) claim.
  await placeWallInFp(page);
  const placedPart = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
    ).pendingBunker?.bunker.parts.at(-1),
  );
  expect(placedPart).toMatchObject({
    partId: "wall-panel",
    col: START_COL - 1,
    row: 5,
    depth: 0,
  });
  await page.getByRole("button", { name: "Exit bunker" }).click();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-fp-mode",
    "0",
  );

  // Digit keys arm nothing in 2D anymore; "1" then "d" is a normal
  // move right (the retired cursor flow would have hammered instead).
  // The carved column beside the shaft has no floor at row 5, so the
  // step right also falls one row.
  await page.keyboard.press("1");
  await page.keyboard.press("d");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const trip = JSON.parse(
          localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
        );
        return trip.moves?.at(-1) ?? null;
      }),
    )
    .toBe("right");
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "6",
  );

  // The pending claim, its placed wall, and the move all survive a
  // reload; raids stay gated until the claim banks at the surface.
  await page.reload();
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "6",
  );
  const reloadedPart = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
    ).pendingBunker?.bunker.parts.at(-1),
  );
  expect(reloadedPart).toMatchObject({
    partId: "wall-panel",
    col: START_COL - 1,
    row: 5,
  });
  await expect(
    page.getByRole("button", { name: "Open bunker status" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const reopenedStatus = page.getByRole("region", { name: "Bunker status" });
  await expect(reopenedStatus).toBeVisible();
  const raidButton = reopenedStatus.getByRole("button", {
    name: "Start Clanker raid",
  });
  await expect(raidButton).toBeDisabled();
  await expect(reopenedStatus).toContainText(
    "Raids unlock after the bunker saves at the surface.",
  );
});

test("reset bunker refunds a pending claim's parts through the two-step confirm", async ({
  page,
}) => {
  // Software-GL runners compile the fp scene slowly (the wall is
  // placed through the first-person builder).
  test.setTimeout(240_000);
  const mine = createMine(6061, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 6; row++) {
    for (let col = START_COL - 3; col <= START_COL + 3; col++) {
      setCell(mine, col, row, { kind: "empty" });
    }
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed: 6061,
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
      const key = "vibebots-mine-trip-v2-slot-1";
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(trip));
      }
    },
    {
      seed: 6061,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down", "down", "down", "down", "down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "5",
  );

  // Claim locally and place one wall from the starter kit through the
  // first-person builder (the only build flow since the hammer
  // retired).
  await page.getByRole("button", { name: "Start bunker claim" }).click();
  const status = page.getByRole("region", { name: "Bunker status" });
  await status.getByRole("button", { name: "Claim 7x5 bunker" }).click();
  await status.getByRole("button", { name: "Close" }).click();
  await placeWallInFp(page);
  await page.getByRole("button", { name: "Exit bunker" }).click();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-fp-mode",
    "0",
  );

  // Open the sheet: the Reset row is a two-step confirm. The first tap
  // arms it without resetting anything.
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const reset = page.getByTestId("bunker-reset");
  await expect(reset).toHaveText("Reset bunker");
  await reset.click();
  await expect(reset).toHaveText("Really reset? Parts return to inventory");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}")
          .pendingBunker?.bunker.parts.length ?? 0,
    ),
  ).toBe(1);

  // The second tap fires: the wall refunds and the row disappears
  // because nothing is left to reset.
  await reset.click();
  await expect(page.getByTestId("bunker-reset")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const trip = JSON.parse(
          localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
        );
        return trip.pendingBunker?.bunker.parts ?? null;
      }),
    )
    .toEqual([]);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}")
          .pendingBunker?.inventory["wall-panel"],
    ),
  ).toBe(6);

  // The claim survives, the fp hotbar shows the refunded stock, and
  // the miner never moved (fp walking is free and logs no actions).
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("bunker-fp-enter").click();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-fp-mode",
    "1",
  );
  await expect(page.getByTestId("bunker-fp-slot-wall-panel")).toHaveAttribute(
    "aria-label",
    "Wall x6",
  );
  await page.getByRole("button", { name: "Exit bunker" }).click();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "5",
  );
});

test("bunker skins repaint placed parts and reselect owned skins free", async ({
  page,
}) => {
  // Each pixel-diff measurement decodes two full-viewport PNGs on the
  // page's contended main thread, so one tick can take several seconds
  // on a slow host; the default 60s budget starves the repaint poll.
  test.setTimeout(120_000);
  const mine = createMine(7171, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 5; row++) {
    for (let offset = -3; offset <= 3; offset++) {
      setCell(mine, START_COL + offset, row, { kind: "empty" });
    }
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  const parts = [-3, -2, -1, 1, 2, 3].map((offset) => ({
    partId: "wall-panel",
    col: START_COL + offset,
    row: 2,
    durability: 90,
  }));
  const baseView = {
    bunker: {
      footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
      core: { col: START_COL, row: 3, durability: 160 },
      parts,
      skin: "steelworks",
      skinsOwned: [],
    },
    inventory: {
      "wall-panel": 0,
      "floor-panel": 0,
      "roof-panel": 0,
      "door-panel": 0,
      "basic-turret": 0,
      "floor-spikes": 0,
    },
    activeRaid: null,
    player: {
      balance: 100,
      trackXp: 40,
      defenseXp: 120,
      overallLevel: 2,
      levelCap: 100,
      progressXp: 20,
      neededXp: 80,
      nextLevelXp: 200,
      beaconLimit: 3,
    },
  };
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed: 7171,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    });
  });
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(baseView),
    });
  });
  let skinRequestBody: unknown = null;
  await page.route("**/api/bunker/skin", async (route) => {
    skinRequestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...baseView,
        bunker: {
          ...baseView.bunker,
          skin: "verdant",
          skinsOwned: ["verdant"],
        },
        player: { ...baseView.player, balance: 20 },
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 2);
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const builder = page.getByRole("region", { name: "Bunker status" });
  await expect(builder).toBeVisible();

  const picker = builder.getByRole("group", { name: "Bunker skins" });
  await expect(picker).toBeVisible();
  // The sheet shows the spendable balance next to its priced buttons and
  // disables what the player cannot afford (F-088).
  const balanceLine = builder.getByLabel("Vibes balance");
  await expect(balanceLine).toHaveText("Vibes: 100");
  const steelworks = picker.getByRole("button", { name: "Steelworks" });
  await expect(steelworks).toHaveAttribute("aria-pressed", "true");
  await expect(steelworks).toBeDisabled();
  const gilded = picker.getByRole("button", { name: "Gilded (120v)" });
  await expect(gilded).toBeVisible();
  await expect(gilded).toBeDisabled();
  await expect(gilded).toHaveAttribute("title", /needs 20 more vibes/);

  const before = await page.locator("canvas").screenshot();
  await picker.getByRole("button", { name: "Verdant (80v)" }).click();
  const verdant = picker.getByRole("button", { name: "Verdant" });
  await expect(verdant).toHaveAttribute("aria-pressed", "true");
  await expect(verdant).toBeDisabled();
  expect(skinRequestBody).toMatchObject({ skinId: "verdant" });
  await expect(steelworks).toHaveAttribute("aria-pressed", "false");
  await expect(steelworks).toBeEnabled();
  await expect(balanceLine).toHaveText("Vibes: 20");

  // Rule 10: the repaint must be visible on the canvas, not just in the
  // UI. Poll until a rendered frame actually lands (under parallel test
  // load a fixed wait can fall between frames), then require the repaint
  // to beat a same-length ambient interval by an additive margin (dust
  // noise contributes equally to both measurements).
  let after = before;
  await expect
    .poll(
      async () => {
        after = await page.locator("canvas").screenshot();
        return imagePixelDifferenceRatio(page, before, after);
      },
      { timeout: 45_000, intervals: [400] },
    )
    .toBeGreaterThan(0.002);
  await page.waitForTimeout(400);
  const settled = await page.locator("canvas").screenshot();
  const repaint = await imagePixelDifferenceRatio(page, before, after);
  const ambient = await imagePixelDifferenceRatio(page, after, settled);
  expect(repaint).toBeGreaterThan(Math.max(0.002, ambient + 0.0015));
});
