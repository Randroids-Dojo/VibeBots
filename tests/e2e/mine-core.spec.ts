import { expect, test } from "@playwright/test";
import {
  applyAction,
  awaitMineSceneReady,
  countRedPixels,
  createMine,
  DEFAULT_GEAR,
  digLateral,
  digTo,
  dismissReleaseNotes,
  expectRegionHorizontalBounds,
  exportDiff,
  MINE_VERSION,
  type MineAction,
  pressMineKey,
  pressMineKeyUntilStatus,
  returnEnergyCost,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "./support/mine-helpers";

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
  await page.waitForTimeout(650);
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
  const jumpJets = page.getByRole("button", { name: "Jump jets" });
  await expect(jumpJets).toBeVisible();
  await expect(jumpJets).toBeEnabled();
  const jumpBox = await jumpJets.boundingBox();
  const settingsButton = page.getByRole("button", { name: "Open settings" });
  await settingsButton.focus();
  await page.keyboard.press("Space");
  const settingsPanel = page.getByRole("region", { name: "Settings" });
  await expect(settingsPanel).toBeVisible();
  await expect(status).toHaveAttribute("data-depth", "1");
  await settingsButton.click();
  await expect(settingsPanel).not.toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  // Climbing out consumes a provisioned ladder (REQ-020).
  // digTo returns as soon as depth updates, so wait through the level 1
  // action cadence before sending the climb key.
  await page.waitForTimeout(650);
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
  await page.getByRole("button", { name: "Recovery options" }).click();
  await expect(
    page.getByRole("menuitem", { name: /Recall \(\d+, range \d+\)/ }),
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
  const plankBox = await placePlankLeft.boundingBox();
  expect(jumpBox?.width).toBeGreaterThan(plankBox?.width ?? 0);
  expect(jumpBox?.height).toBeGreaterThan(plankBox?.height ?? 0);
  const viewport = page.viewportSize();
  expect(jumpBox?.x ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.65);
  expect(jumpBox?.y ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.32);
  expect((jumpBox?.y ?? 0) + (jumpBox?.height ?? 0)).toBeLessThan(
    (plankBox?.y ?? 0) - 12,
  );
  const bottomCenterHit = await page.evaluate(() => {
    const target = document.elementFromPoint(
      window.innerWidth / 2,
      window.innerHeight - 32,
    );
    return {
      label: target?.getAttribute("aria-label") ?? null,
      mineShell: target
        ?.closest("[data-mine-shell='true']")
        ?.getAttribute("data-mine-shell"),
    };
  });
  expect(bottomCenterHit.label).not.toBe("Jump jets");
  expect(bottomCenterHit.label).not.toBe("Dig controls");
  expect(bottomCenterHit.mineShell).toBe("true");
  await expect(
    page.getByRole("button", { name: "Scrap placed supports" }),
  ).toBeVisible();
  await expect(status).toHaveAttribute("data-ladders", /\d+/);
});

test("dirt cracks grow before a heavy break burst", async ({ page }) => {
  const seed = 2026062102;
  const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "dirt" });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  await pressMineKey(page, "ArrowDown");
  let firstCracks = 0;
  await expect
    .poll(
      async () => {
        firstCracks = Number(
          await canvas.getAttribute("data-crack-segment-count"),
        );
        return firstCracks;
      },
      { timeout: 3_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(650);

  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-crack-segment-count")),
      { timeout: 3_000 },
    )
    .toBeGreaterThan(firstCracks);
  await page.waitForTimeout(650);

  await pressMineKey(page, "ArrowDown");
  await page.waitForTimeout(650);
  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-particle-count")),
      { timeout: 3_000 },
    )
    .toBeGreaterThanOrEqual(30);
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-depth",
    "1",
  );
});

test("stratum entry banners fade after continued descent", async ({ page }) => {
  const seed = 2026062801;
  const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 12; row += 1) {
    setCell(mine, START_COL, row, { kind: "dirt" });
  }
  setCell(mine, START_COL, 13, { kind: "empty", ladder: true });
  setCell(mine, START_COL, 14, { kind: "empty" });
  setCell(mine, START_COL, 15, { kind: "dirt" });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeSlot: 1,
        seed,
        tripIndex: 0,
        diff: exportDiff(mine),
      }),
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await digTo(page, 12);
  await expect(status).toHaveAttribute("data-depth", "12");

  const banner = page
    .locator(".mine-stratum-banner")
    .filter({ hasText: "Entering Clay Beds" });
  await expect(banner).toBeVisible();
  // The banner is a one-shot 2.6s CSS animation, so prove it visibly
  // animates while it is alive (Rule 10) instead of racing its lifetime
  // against another full dig row on a slow runner.
  const entryFrame = await banner.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { opacity: Number(style.opacity), transform: style.transform };
  });
  await expect
    .poll(
      async () => {
        const laterFrame = await banner
          .evaluate((element) => {
            const style = window.getComputedStyle(element);
            return {
              opacity: Number(style.opacity),
              transform: style.transform,
            };
          })
          .catch(() => null);
        return (
          laterFrame === null ||
          laterFrame.opacity !== entryFrame.opacity ||
          laterFrame.transform !== entryFrame.transform
        );
      },
      { message: "stratum banner should visibly animate" },
    )
    .toBe(true);
  // Continued descent leaves no lingering banner behind.
  await digTo(page, 13);
  await expect(status).toHaveAttribute("data-depth", "13");
  await expect(banner).not.toBeVisible({ timeout: 5_000 });
});

test("mine low battery and ladder warnings pulse on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  const gear = DEFAULT_GEAR;
  const consumables = { ...STARTING_CONSUMABLES, ladder: 0 };
  const seed = 2026062001;
  const baseMine = createMine(seed, gear, consumables);
  for (let row = 1; row <= 54; row++) {
    setCell(baseMine, START_COL, row, { kind: "dirt" });
  }
  const baseDiff = exportDiff(baseMine);
  const replayMine = createMine(seed, gear, consumables, baseDiff);
  const moves: MineAction[] = [];
  for (let i = 0; i < 240; i++) {
    const result = applyAction(replayMine, "down");
    if (result.ok) moves.push("down");
    const batteryLow =
      replayMine.miner.row > 0 &&
      replayMine.miner.energy < returnEnergyCost(replayMine.miner) * 1.25 + 2;
    if (batteryLow) break;
  }
  expect(replayMine.miner.row).toBeGreaterThanOrEqual(30);
  expect(replayMine.miner.energy).toBeGreaterThan(0);

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
      seed,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables,
      baseDiff,
      moves,
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-battery-low", "true");
  await expect(status).toHaveAttribute("data-ladder-short", "true");
  await expect(status).toHaveAttribute("data-return-route", "short");
  await expect(status).toHaveAttribute("data-return-capped", "false");
  await expect(status.locator("[data-battery-chip='true']")).toContainText(
    "Low",
  );
  await expect(page.locator("[data-ladder-chip='true']")).toContainText(
    "needed",
  );

  const edgeWarning = page.locator("[data-battery-edge-warning='true']");
  await expect(edgeWarning).toBeVisible();
  const redSamples: number[] = [];
  for (let frame = 0; frame < 6; frame += 1) {
    redSamples.push(await countRedPixels(page, await page.screenshot()));
    await page.waitForTimeout(260);
  }
  const largestPulseDelta = redSamples
    .slice(1)
    .reduce(
      (largest, sample, index) =>
        Math.max(largest, Math.abs(sample - redSamples[index])),
      0,
    );
  expect(largestPulseDelta).toBeGreaterThan(80);
});

test("mine ladder warning accepts a nearby clear ladder path home", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seed = 2026062801;
  const consumables = { ...STARTING_CONSUMABLES, ladder: 0 };
  const mine = createMine(seed, DEFAULT_GEAR, consumables);
  for (let row = 1; row <= 3; row++) {
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  setCell(mine, START_COL, 4, { kind: "dirt" });
  setCell(mine, START_COL + 1, 3, { kind: "empty" });
  setCell(mine, START_COL + 1, 4, { kind: "dirt" });
  const moves: MineAction[] = ["down", "down", "down", "right"];

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
      seed,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables,
      baseDiff: exportDiff(mine),
      moves,
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "3");
  await expect(status).toHaveAttribute("data-horizontal-distance", "1");
  await expect(status).toHaveAttribute("data-ladders", "0");
  await expect(status).toHaveAttribute("data-climb-ladders", "0");
  await expect(status).toHaveAttribute("data-ladder-short", "false");
  await expect(status).toHaveAttribute("data-return-route", "clear");
  await expect(status).toHaveAttribute("data-return-steps", "4");
  await expect(status).toHaveAttribute("data-return-capped", "false");
  await expect(page.locator("[data-ladder-chip='true']")).not.toContainText(
    "needed",
  );
});

test("fatal free fall stays on camera until impact", async ({ page }) => {
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(6161, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 36; row++) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  setCell(mine, START_COL, 37, { kind: "dirt" });
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
  await expect(page.getByRole("button", { name: "Jump jets" })).toHaveCount(0);

  const beforeFallShot = await canvas.screenshot();
  await pressMineKey(page, "ArrowDown");
  await expect
    .poll(async () => canvas.getAttribute("data-fall-visual-active"), {
      timeout: 5_000,
    })
    .toBe("true");
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-rendered-cell-count")),
      {
        timeout: 5_000,
      },
    )
    .toBeGreaterThan(20);
  let midFallCamY = Number.NaN;
  await expect
    .poll(
      async () => {
        const active = await canvas.getAttribute("data-fall-visual-active");
        const impact = await canvas.getAttribute("data-fall-visual-impact");
        const camY = Number(await canvas.getAttribute("data-cam-y"));
        if (active === "true" && impact === "false" && camY < -8) {
          midFallCamY = camY;
          return true;
        }
        return false;
      },
      {
        timeout: 5_000,
      },
    )
    .toBe(true);
  expect(midFallCamY).toBeLessThan(-8);
  const fallActiveShot = await canvas.screenshot();
  expect(Buffer.compare(beforeFallShot, fallActiveShot)).not.toBe(0);

  const report = page.getByRole("button", { name: "Dismiss trip report" });
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(report).toContainText("Fell too far");
  await expect(report).not.toContainText("Crushed by falling rock");
  await expect(page.getByRole("button", { name: "Jump jets" })).toHaveCount(0);
});

test("mine shows the needed pickaxe level on gated rock hits", async ({
  page,
}) => {
  const mine = createMine(6261, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "rock", rockTier: 1 });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: {
        activeSlot: 1,
        seed: 6261,
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
        balance: 0,
      },
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(page.locator("canvas")).toBeVisible();
  await pressMineKey(page, "ArrowDown");

  const hint = page.locator(".mine-pickaxe-gate-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("Pickaxe level 2 needed");
  await expect(hint).toHaveCSS("pointer-events", "none");
  await expect(hint).toBeHidden({ timeout: 3_000 });
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
  setCell(mine, c + 4, 9, { kind: "part-cache" });
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

  const status = page.getByLabel("Mine status");
  await pressMineKey(page, "ArrowRight");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0.5);
  await digTo(page, 7);
  await expect(status).toHaveAttribute("data-depth", "7");
  // Let the camera settle on the miner before triggering the crush; on a
  // frame-starved runner the rig can lag near the surface long after the
  // sim reaches depth 7, and the playback assertions below measure it.
  // The rig lands on exactly -7.00 at depth 7, so the threshold sits above.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-y")), {
      timeout: 20_000,
    })
    .toBeLessThan(-6.9);
  const beforeCrushShot = await canvas.screenshot();
  let firstActiveFrame: { camY: number; minerY: number } | null = null;
  for (let attempt = 0; attempt < 4 && !firstActiveFrame; attempt++) {
    await pressMineKey(page, "ArrowDown");
    for (let i = 0; i < 60; i++) {
      const active = await canvas.getAttribute("data-fall-visual-active");
      if (active === "true") {
        firstActiveFrame = {
          camY: Number(await canvas.getAttribute("data-cam-y")),
          minerY: Number(await canvas.getAttribute("data-miner-y")),
        };
        break;
      }
      await page.waitForTimeout(16);
    }
  }
  expect(firstActiveFrame).not.toBeNull();
  expect(firstActiveFrame?.camY).toBeLessThan(-7);
  expect(firstActiveFrame?.minerY).toBeLessThan(-7);
  // The report never precedes the rendered impact. On a frame-starved
  // runner the first observed active frame can already be post-impact,
  // so assert the ordering rather than a wall-clock "not yet".
  if (
    await page.getByRole("button", { name: "Dismiss trip report" }).isVisible()
  ) {
    expect(await canvas.getAttribute("data-fall-visual-impact")).toBe("true");
  }
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-y")), {
      timeout: 5_000,
    })
    .toBeLessThan(-7);
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-rendered-cell-count")),
      {
        timeout: 5_000,
      },
    )
    .toBeGreaterThan(20);
  await expect
    .poll(async () => canvas.getAttribute("data-fall-visual-impact"), {
      timeout: 5_000,
    })
    .toBe("true");
  const activeCrushShot = await canvas.screenshot();
  expect(Buffer.compare(beforeCrushShot, activeCrushShot)).not.toBe(0);

  const report = page.getByRole("button", { name: "Dismiss trip report" });
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(report).toContainText("Crushed by falling rock");
  await expect(report).toContainText("where the rock fell");
  await expect(report).not.toContainText("battery died");
  await expect(canvas).toHaveAttribute("data-fall-visual-active", "true");
  expect(Number(await canvas.getAttribute("data-cam-y"))).toBeLessThan(-7);
  expect(
    Number(await canvas.getAttribute("data-rendered-cell-count")),
  ).toBeGreaterThan(20);
});

test("scrap selection outlines selected cells in red", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Scrap placed supports" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Scrap placed supports" }).click();
  const salvage = page.getByRole("region", { name: "Scrap mode" });
  await expect(salvage).toBeVisible();
  await expectRegionHorizontalBounds(page, "Scrap mode");
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const clickUntilSelected = async (expectedCount: number) => {
    const xPoints = [0.32, 0.42, 0.5, 0.58, 0.68].map((x) => x * box.width);
    const yPoints = [0.42, 0.5, 0.58, 0.66, 0.74, 0.82].map(
      (y) => y * box.height,
    );
    for (const y of yPoints) {
      for (const x of xPoints) {
        await canvas.click({ position: { x, y }, force: true });
        const text = await salvage.textContent();
        if (text?.includes(`${expectedCount} selected`)) return;
      }
    }
    throw new Error(`Could not select ${expectedCount} scrap target(s)`);
  };

  await clickUntilSelected(1);
  await expect(salvage).toContainText("1 selected");
  await expectRegionHorizontalBounds(page, "Scrap mode");

  const after = await canvas.screenshot();
  const selectedRedPixels = await countRedPixels(page, after);
  expect(selectedRedPixels).toBeGreaterThan(
    (await countRedPixels(page, before)) + 80,
  );

  await salvage.getByRole("button", { name: "Confirm scrap" }).click();
  await expect(salvage).toHaveCount(0);
  const cleared = await canvas.screenshot();
  expect(await countRedPixels(page, cleared)).toBeLessThan(
    selectedRedPixels - 80,
  );
});

test("scrap mode closes bunker claim overlays", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });
  const mine = createMine(7173, DEFAULT_GEAR, STARTING_CONSUMABLES);
  setCell(mine, START_COL, 1, { kind: "empty", ladder: true });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed: 7173,
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
  await page.getByRole("button", { name: "Start bunker claim" }).click();
  await expect(
    page.getByRole("region", { name: "Bunker builder" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scrap placed supports" }).click();
  await expect(
    page.getByRole("region", { name: "Bunker builder" }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Scrap mode" })).toBeVisible();
});

test("standing on a ladder uses scrap mode for removal", async ({ page }) => {
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

  const scrapSupports = page.getByRole("button", {
    name: "Scrap placed supports",
  });
  await expect(scrapSupports).toBeEnabled();
  await scrapSupports.click();
  await expect(page.getByRole("region", { name: "Scrap mode" })).toBeVisible();
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
  await pressMineKeyUntilStatus(page, "ArrowUp", "data-depth", "1");
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
  await pressMineKeyUntilStatus(page, "ArrowUp", "data-depth", "1");
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
  await expect(page.getByText("Opening the shaft")).not.toBeVisible({
    timeout: 5_000,
  });
  await expect
    .poll(async () => canvas.getAttribute("data-miner-x"), { timeout: 5_000 })
    .not.toBeNull();

  const initialX = Number(await canvas.getAttribute("data-miner-x"));
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 2_000,
    })
    .toBeGreaterThan(initialX + 0.05);
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-miner-motion-frames")),
      { timeout: 2_000 },
    )
    .toBeGreaterThan(1);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 600,
    })
    .toBeGreaterThan(initialX + 0.85);

  await page.waitForTimeout(620);
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

test("rapid repeated keyboard taps do not bypass held cadence (REQ-023)", async ({
  page,
}) => {
  const status = page.getByLabel("Mine status");
  const horizontalDistance = async () =>
    Number(await status.getAttribute("data-horizontal-distance"));

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "0");

  await awaitMineSceneReady(page);
  const keyboardStart = await horizontalDistance();
  await page.keyboard.press("ArrowRight");
  await expect(status).toHaveAttribute(
    "data-horizontal-distance",
    String(keyboardStart + 1),
  );
  // Let the repeat window from the accepted press expire, then burst four
  // taps in one synchronous task. They all share one cadence window, so
  // exactly one can land regardless of machine speed; asserting the burst
  // lands inside the previous window instead was flaky on slow CI.
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" }),
      );
    }
  });
  await expect(status).toHaveAttribute(
    "data-horizontal-distance",
    String(keyboardStart + 2),
  );
  // The keyups released the hold, so no queued repeats fire afterwards.
  await page.waitForTimeout(700);
  expect(await horizontalDistance()).toBe(keyboardStart + 2);

  // A genuine hold auto-repeats through the cadence window.
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(900);
  await page.keyboard.up("ArrowRight");
  expect(await horizontalDistance()).toBeGreaterThanOrEqual(keyboardStart + 3);
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
  const recovery = page.getByRole("button", { name: "Recovery options" });
  await recovery.click();
  const abandon = page.getByRole("menuitem", { name: "Abandon trip" });
  await expect(abandon).toBeDisabled();
  await recovery.click();

  await digTo(page, 1);
  await expect(status).toHaveAttribute("data-depth", "1");
  await recovery.click();
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
