import { expect, test } from "@playwright/test";
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
  await page.getByRole("button", { name: "Open bunker builder" }).click();
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toBeVisible();
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Player level 2/100",
  );
  await expect(builder.getByLabel("Player level progress")).toContainText(
    "Beacon cap 3",
  );
  await expect(builder).toContainText("Wall x2");
  await expect(builder).toContainText("Floor x3");
  await expect(builder).toContainText("Roof x3");
  await builder.getByRole("button", { name: "Start Clanker raid" }).click();
  await expect(builder).toBeVisible();
  await expect(builder).toContainText("1 Clanker dead");
  await expect(builder).toContainText("Walk over 25 defense XP on the ground");
  await expect(builder.getByRole("button", { name: "Place" })).toBeEnabled();
  await expect(builder.getByRole("button", { name: "Remove" })).toBeEnabled();
  await expect(
    builder.getByRole("button", { exact: true, name: "Move" }),
  ).toBeEnabled();
  await expect(
    builder.getByRole("button", { name: "Walk left" }),
  ).toBeEnabled();
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
      timeout: 4_000,
    })
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Open bunker builder" }).click();
  const builder = page.getByRole("region", { name: "Bunker builder" });
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
  await page.getByRole("button", { name: "Open bunker builder" }).click();
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toContainText("Miner killed");
  await expect(builder).toContainText("Clankers follow open bunker cells");
  await expect(builder).toContainText("Fully enclose the player cell");
  await expect(builder.getByRole("button", { name: "Place" })).toBeDisabled();
  await expect(builder.getByRole("button", { name: "Remove" })).toBeDisabled();
  await expect(
    builder.getByRole("button", { exact: true, name: "Move" }),
  ).toBeDisabled();
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
    "Player level 1/100",
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

  const redPixels = await countRedPixels(
    page,
    await page.locator("canvas").screenshot(),
  );
  expect(redPixels).toBeGreaterThan(50);
});

test("bunker claims can be edited before banking", async ({ page }) => {
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
  const builder = page.getByRole("region", { name: "Bunker builder" });
  await expect(builder).toContainText(
    "Ready to claim. Build now, then bank at surface to save.",
  );
  await builder.getByRole("button", { name: "Claim 7x5 bunker" }).click();
  await expect(builder.getByRole("button", { name: "Wall x2" })).toBeVisible();
  const builderBox = await builder.boundingBox();
  expect(builderBox?.height ?? 999).toBeLessThanOrEqual(260);
  expect(builderBox?.y ?? 0).toBeGreaterThan(360);
  const modeGroup = builder.getByLabel("Build mode");
  const partsGroup = builder.getByLabel("Base parts");
  await expect(modeGroup).toBeVisible();
  await expect(partsGroup).toBeVisible();
  const placeMode = modeGroup.getByRole("button", { name: "Place" });
  const removeMode = modeGroup.getByRole("button", { name: "Remove" });
  const moveMode = modeGroup.getByRole("button", { name: "Move", exact: true });
  await expect(placeMode).toHaveAttribute("aria-pressed", "true");
  await expect(removeMode).toHaveAttribute("aria-pressed", "false");
  await expect(moveMode).toHaveAttribute("aria-pressed", "false");
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  const placePoint = {
    x: box.x + box.width / 2 + 56,
    y: box.y + box.height / 2,
  };
  await page.mouse.click(placePoint.x, placePoint.y);
  await expect(builder.getByRole("button", { name: "Wall x1" })).toBeVisible();
  const firstPart = await page.evaluate(() => {
    const trip = JSON.parse(
      localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
    );
    return trip.pendingBunker?.bunker.parts[0] ?? null;
  });
  expect(firstPart).toMatchObject({ partId: "wall-panel" });
  await removeMode.click();
  await expect(removeMode).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(placePoint.x, placePoint.y);
  await expect(builder.getByRole("button", { name: "Wall x2" })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const trip = JSON.parse(
            localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
          );
          return trip.pendingBunker?.bunker.parts.length ?? 0;
        }),
      { timeout: 3_000 },
    )
    .toBe(0);
  await placeMode.click();
  await page.mouse.click(placePoint.x, placePoint.y);
  await expect(builder.getByRole("button", { name: "Wall x1" })).toBeVisible();
  await moveMode.click();
  await page.mouse.move(placePoint.x, placePoint.y);
  await page.mouse.down();
  await page.mouse.move(placePoint.x + 112, placePoint.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const trip = JSON.parse(
            localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
          );
          return trip.pendingBunker?.bunker.parts[0] ?? null;
        }),
      { timeout: 3_000 },
    )
    .toMatchObject({
      partId: "wall-panel",
      col: firstPart.col + 1,
      row: firstPart.row,
    });
  await builder.getByRole("button", { name: "Walk up" }).click();
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "4",
  );
  await expect(builder).toBeVisible();
  await page.reload();
  await dismissReleaseNotes(page);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "4",
  );
  await expect(
    page.getByRole("region", { name: "Bunker builder" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open bunker builder" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open bunker builder" }).click();
  const reopenedBuilder = page.getByRole("region", { name: "Bunker builder" });
  await expect(reopenedBuilder).toBeVisible();
  const raidButton = reopenedBuilder.getByRole("button", {
    name: "Start Clanker raid",
  });
  await expect(raidButton).toBeDisabled();
  await expect(reopenedBuilder).toContainText(
    "Raids unlock after the bunker saves at the surface.",
  );
});
