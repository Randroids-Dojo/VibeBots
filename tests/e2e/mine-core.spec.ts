import { expect, test } from "@playwright/test";
import { imagePixelDifferenceRatio } from "./support/image-pixels";
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
  routeStarterMineWorld,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "./support/mine-helpers";

test("surface day and night grades change production pixels without new draws", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    (
      window as typeof window & { __vibebotsTimeOfDayHour?: number }
    ).__vibebotsTimeOfDayHour = 13;
  });
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-surface-phase", "day", {
    timeout: 30_000,
  });
  const dayDraws = Number(await canvas.getAttribute("data-draw-calls"));
  const day = await canvas.screenshot();

  await page.evaluate(() => {
    (
      window as typeof window & { __vibebotsTimeOfDayHour?: number }
    ).__vibebotsTimeOfDayHour = 0;
  });
  await expect(canvas).toHaveAttribute("data-surface-phase", "night", {
    timeout: 5_000,
  });
  const nightDraws = Number(await canvas.getAttribute("data-draw-calls"));
  const night = await canvas.screenshot();

  expect(await imagePixelDifferenceRatio(page, day, night)).toBeGreaterThan(
    0.08,
  );
  expect(dayDraws).toBeLessThanOrEqual(110);
  expect(nightDraws).toBe(dayDraws);
});

test("mine digs and tracks depth and energy", async ({ page }) => {
  test.setTimeout(120_000);
  // Seed the world and force the dig column's first block to plain dirt
  // (F-098): the unseeded world sometimes rolled a two-hit 0.4-per-swing
  // cell at the dig column, so the row-1 swing total landed at 59.2
  // instead of the expected 1.0-cost band and the energy check flaked.
  await routeStarterMineWorld(page, 424242, (mine) => {
    setCell(mine, START_COL, 1, { kind: "dirt" });
  });
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

test("a five-wide tunnel condemns its roof and a plank rescues it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seed = 2026070301;
  const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
  // Shaft to row 8, then a tunnel one dig short of five wide. Ceiling,
  // floor, and side walls are pinned so pristine rolls stay out of it.
  for (let row = 1; row <= 7; row++) {
    setCell(mine, START_COL, row, { kind: "dirt", hp: 1 });
  }
  for (let i = 0; i < 5; i++) {
    setCell(mine, START_COL + i, 8, { kind: "dirt", hp: 1 });
    if (i > 0) {
      setCell(mine, START_COL + i, 7, { kind: "dirt" });
      setCell(mine, START_COL + i, 6, { kind: "dirt" });
    }
    setCell(mine, START_COL + i, 9, { kind: "dirt" });
  }
  setCell(mine, START_COL - 1, 8, { kind: "metal" });
  setCell(mine, START_COL + 5, 8, { kind: "metal" });
  const moves: MineAction[] = [
    ...Array.from({ length: 8 }, () => "down" as const),
    "right",
    "right",
    "right",
  ];
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
      localStorage.setItem("vibebots-falling-rock-alert-dismissed", "true");
    },
    {
      seed,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves,
    },
  );
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
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
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "8");
  await expect(canvas).toHaveAttribute("data-teeter-count", "0");

  // The fifth dig condemns the roof: four ceiling cells teeter (the
  // fifth sits over the entry shaft hole).
  await pressMineKey(page, "ArrowRight");
  await expect(canvas).toHaveAttribute("data-teeter-count", "4", {
    timeout: 5_000,
  });
  // The tremble must displace real meshes, not just set flags (Rule 10).
  const motionBefore = Number(
    await canvas.getAttribute("data-teeter-motion-frames"),
  );
  await expect
    .poll(
      async () =>
        Number(await canvas.getAttribute("data-teeter-motion-frames")),
      { timeout: 3_000 },
    )
    .toBeGreaterThan(motionBefore);

  // A plank one cell back splits the span and props its own ceiling:
  // every condemned cell is rescued before the countdown lands.
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "Place plank left" }).click();
  await expect(canvas).toHaveAttribute("data-teeter-count", "0", {
    timeout: 5_000,
  });
});

test("a cave-in uncorks a gas pocket and the miner disperses the wisp", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seed = 2026070303;
  const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
  const c = START_COL;
  // Shaft to a gallery at row 6. A teetering boulder sits beside a gas
  // pocket over a deep pit: its countdown outlasts the replayed descent,
  // so the fall lands on the player's watch. Every touched cell is
  // pinned so pristine rolls stay out of the contract.
  for (let row = 1; row <= 5; row++) {
    setCell(mine, c, row, { kind: "dirt", hp: 1 });
  }
  setCell(mine, c - 1, 6, { kind: "empty" });
  setCell(mine, c - 1, 7, { kind: "dirt" });
  setCell(mine, c, 6, { kind: "empty" });
  setCell(mine, c, 7, { kind: "dirt" });
  setCell(mine, c + 1, 5, { kind: "dirt" });
  setCell(mine, c + 1, 6, { kind: "boulder", fallIn: 8 });
  setCell(mine, c + 1, 7, { kind: "empty" });
  setCell(mine, c + 1, 8, { kind: "empty" });
  setCell(mine, c + 1, 9, { kind: "dirt" });
  setCell(mine, c + 2, 5, { kind: "dirt" });
  setCell(mine, c + 2, 6, { kind: "gas" });
  setCell(mine, c + 2, 7, { kind: "dirt" });
  setCell(mine, c + 3, 6, { kind: "dirt" });
  const moves: MineAction[] = Array.from({ length: 6 }, () => "down" as const);
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
      localStorage.setItem("vibebots-falling-rock-alert-dismissed", "true");
    },
    {
      seed,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves,
    },
  );
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
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
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "6");
  await expect(canvas).toHaveAttribute("data-gas-wisp-count", "0");

  // Two paced steps run out the boulder's countdown: it drops into the
  // pit, the vacated cell uncorks the pocket, and a wisp leaks into the
  // tunnel row.
  await pressMineKey(page, "ArrowLeft");
  await page.waitForTimeout(650);
  await pressMineKey(page, "ArrowRight");
  await expect(canvas).toHaveAttribute("data-gas-wisp-count", "1", {
    timeout: 5_000,
  });

  // Shouldering through the wisp disperses it and costs extra battery.
  const energyBefore = Number(await status.getAttribute("data-energy"));
  await page.waitForTimeout(650);
  await pressMineKey(page, "ArrowRight");
  await expect(status).toHaveAttribute("data-horizontal-distance", "1", {
    timeout: 5_000,
  });
  await expect(canvas).toHaveAttribute("data-gas-wisp-count", "0");
  const energyAfter = Number(await status.getAttribute("data-energy"));
  expect(energyBefore - energyAfter).toBeGreaterThanOrEqual(4);
});

test("stratum entry banners fade after continued descent", async ({ page }) => {
  // Deep digs cost ~0.62s per swing at sim cadence; slow runners also pay
  // a first-frame shader-compile stall, so the default 60s budget is tight.
  test.setTimeout(120_000);
  const seed = 2026062801;
  // High-gear trip fixture: pickaxe 9 cuts dirt in one swing, so the
  // 13-row descent fits slow-runner budgets even when timer cadence
  // dilates under load. The banner behavior under test is gear-agnostic.
  const gear = { ...DEFAULT_GEAR, pickaxe: 9, battery: 10, lantern: 8 };
  const mine = createMine(seed, gear, STARTING_CONSUMABLES);
  for (let row = 1; row <= 12; row += 1) {
    setCell(mine, START_COL, row, { kind: "dirt" });
  }
  setCell(mine, START_COL, 13, { kind: "empty", ladder: true });
  setCell(mine, START_COL, 14, { kind: "empty" });
  setCell(mine, START_COL, 15, { kind: "dirt" });
  await page.addInitScript(
    (trip) => {
      localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
    },
    {
      seed,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: [],
    },
  );
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
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
  // The banner is a one-shot 2.6s CSS animation, so prove it visibly
  // animates while it is alive (Rule 10). Observation is armed in-page
  // before the descent: on a loaded host the whole animation (and the
  // banner's own unmount) can pass between protocol round trips, so
  // after-the-fact sampling records a still frame or nothing at all.
  await page.evaluate(() => {
    const w = window as typeof window & {
      __stratumBannerMotion?: { seen: boolean; changed: boolean };
    };
    const motion = { seen: false, changed: false };
    w.__stratumBannerMotion = motion;
    let last: { opacity: number; transform: string } | null = null;
    const sample = () => {
      const el = Array.from(
        document.querySelectorAll(".mine-stratum-banner"),
      ).find((candidate) => candidate.textContent?.includes("Clay Beds"));
      if (el) {
        const style = window.getComputedStyle(el);
        const current = {
          opacity: Number(style.opacity),
          transform: style.transform,
        };
        motion.seen = true;
        // Any mid-fade sample is motion evidence on its own.
        if (current.opacity > 0 && current.opacity < 1) motion.changed = true;
        if (
          last !== null &&
          (last.opacity !== current.opacity ||
            last.transform !== current.transform)
        ) {
          motion.changed = true;
        }
        last = current;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await digTo(page, 12);
  await expect(status).toHaveAttribute("data-depth", "12");

  const banner = page
    .locator(".mine-stratum-banner")
    .filter({ hasText: "Entering Clay Beds" });
  const bannerMotion = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & {
            __stratumBannerMotion?: { seen: boolean; changed: boolean };
          }
        ).__stratumBannerMotion ?? { seen: false, changed: false },
    );
  await expect
    .poll(async () => (await bannerMotion()).seen, {
      message: "stratum banner should appear on the Clay Beds crossing",
      timeout: 20_000,
    })
    .toBe(true);
  await expect
    .poll(async () => (await bannerMotion()).changed, {
      message: "stratum banner should visibly animate",
      timeout: 20_000,
    })
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
  let midFallCamY = Number.NaN;
  await expect
    .poll(
      async () => {
        const active = await canvas.getAttribute("data-fall-visual-active");
        const camY = Number(await canvas.getAttribute("data-cam-y"));
        const rendered = Number(
          await canvas.getAttribute("data-rendered-cell-count"),
        );
        // Software renderers can hold the browser thread through the fall and
        // first yield at the impact frame. The active playback still proves
        // the report has not replaced the canvas, so accept that frame too.
        if (active === "true" && camY < -8 && rendered > 20) {
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
  test.setTimeout(120_000);
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
  await awaitMineSceneReady(page);
  await pressMineKey(page, "ArrowRight");
  // The first frames on a cold runner also pay the shader-compile stall.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 30_000,
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
      timeout: 45_000,
    })
    .toBeLessThan(-6.9);
  const beforeCrushShot = await canvas.screenshot();
  // Sample the playback state atomically: separate attribute reads can
  // straddle the playback's end on a slow runner, pairing a stale
  // active flag with a post-reset camera.
  const readFallFrame = () =>
    canvas.evaluate((el) => ({
      active: el.getAttribute("data-fall-visual-active"),
      camY: Number(el.getAttribute("data-cam-y")),
      minerY: Number(el.getAttribute("data-miner-y")),
    }));
  let firstActiveFrame: { camY: number; minerY: number } | null = null;
  for (let attempt = 0; attempt < 4 && !firstActiveFrame; attempt++) {
    await pressMineKey(page, "ArrowDown");
    for (let i = 0; i < 60; i++) {
      const frame = await readFallFrame();
      if (frame.active === "true") {
        firstActiveFrame = { camY: frame.camY, minerY: frame.minerY };
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
  // so assert the ordering rather than a wall-clock "not yet". The
  // impact attribute is transient (it resets when the playback clears
  // while the report stays up), so only a live playback that has NOT
  // impacted yet may fail this check.
  if (
    await page.getByRole("button", { name: "Dismiss trip report" }).isVisible()
  ) {
    const active = await canvas.getAttribute("data-fall-visual-active");
    const impacted = await canvas.getAttribute("data-fall-visual-impact");
    expect(active === "true" && impacted === "false").toBe(false);
  }
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-rendered-cell-count")),
      {
        timeout: 15_000,
      },
    )
    .toBeGreaterThan(20);
  await expect
    .poll(async () => canvas.getAttribute("data-fall-visual-impact"), {
      timeout: 20_000,
    })
    .toBe("true");
  // The wreck must physically tumble after the hit (Rule 10): the frame
  // counter only advances while the body's pose is really displacing.
  const tumbleStart = Number(
    await canvas.getAttribute("data-crush-tumble-frames"),
  );
  await expect
    .poll(
      async () => Number(await canvas.getAttribute("data-crush-tumble-frames")),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(tumbleStart);
  const activeCrushShot = await canvas.screenshot();
  expect(Buffer.compare(beforeCrushShot, activeCrushShot)).not.toBe(0);

  const report = page.getByRole("button", { name: "Dismiss trip report" });
  await expect(report).toBeVisible({ timeout: 15_000 });
  await expect(report).toContainText("Crushed by falling rock");
  await expect(report).toContainText("where the rock fell");
  await expect(report).not.toContainText("battery died");
  // On a frame-starved runner the attributes lag the store by however
  // long the canvas goes between frames; the playback stays alive until
  // impact + 4.3s, so give the next rendered frame time to say so.
  await expect(canvas).toHaveAttribute("data-fall-visual-active", "true", {
    timeout: 15_000,
  });
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-y")), {
      timeout: 10_000,
    })
    .toBeLessThan(-7);
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
  // The hammer builder (PR #132) replaced the old "Bunker builder" region
  // with the "Bunker status" sheet; the scrap-closes-claim contract is
  // unchanged (F-082).
  await expect(
    page.getByRole("region", { name: "Bunker status" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scrap placed supports" }).click();
  await expect(page.getByRole("region", { name: "Bunker status" })).toHaveCount(
    0,
  );
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
  // Planks brace both voids and solid ground now (roof props), so both
  // sides are placeable underground. An occupied cell still disables
  // its side: place left, and only the right side stays available.
  await expect(placePlankLeft).toBeEnabled();
  await expect(placePlankRight).toBeEnabled();
  await page.waitForTimeout(650);
  await placePlankLeft.click();
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
  await awaitMineSceneReady(page);

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
    // CI can collapse most of the glide into one rendered frame under load.
    // One in-flight frame still proves the action did not snap straight to rest.
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
      timeout: 1_200,
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
      timeout: 1_200,
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
  // taps in one synchronous task. They all share one cadence window: the
  // first lands immediately and the rest collapse into ONE buffered move
  // at the next legal action time (the tap buffer remembers the newest
  // tap instead of dropping it, but can never fire early or bank more).
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
  // Exactly one buffered move lands at the next legal time, then the
  // burst is spent: four taps yield two moves total, same rate as a hold.
  // (A slow runner can sample after the buffered move already landed, so
  // the immediate-move check is folded into the >= poll.)
  await expect
    .poll(horizontalDistance)
    .toBeGreaterThanOrEqual(keyboardStart + 2);
  await expect.poll(horizontalDistance).toBe(keyboardStart + 3);
  await page.waitForTimeout(900);
  expect(await horizontalDistance()).toBe(keyboardStart + 3);

  // A genuine hold auto-repeats through the cadence window.
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(900);
  await page.keyboard.up("ArrowRight");
  expect(await horizontalDistance()).toBeGreaterThanOrEqual(keyboardStart + 4);
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

// Movement slice two: a held walk strides through cell boundaries with a
// mostly-linear cruise (no full stop per cell), and the camera rides the
// miner's own step timing instead of arriving early and waiting.
test("a held walk never stands still mid-chain and the camera stays with the miner", async ({
  page,
}) => {
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await awaitMineSceneReady(page);
  // Frames must be flowing before sampling rendered positions.
  await expect(page.getByLabel("Mine status")).toHaveAttribute(
    "data-scene-painted",
    "true",
  );
  // The dismissal click can consume the input gate (the thumbstick spawns
  // on pointer down); start from an idle gate so the first press fires
  // immediately and the chain rhythm is deterministic.
  await page.waitForTimeout(750);

  const probe = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    const samples: Array<{ t: number; x: number; camX: number }> = [];
    // Timer fidelity, measured on the same clock the input cadence uses:
    // a dilated main thread stretches the held repeats past the chain
    // window, and every step then settles by design.
    const timerDeltas: number[] = [];
    const timerProbe = (async () => {
      for (let i = 0; i < 4; i += 1) {
        const started = performance.now();
        await new Promise((r) => setTimeout(r, 620));
        timerDeltas.push(performance.now() - started);
      }
    })();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const t = performance.now() - t0;
        samples.push({
          t,
          x: Number(canvas?.getAttribute("data-miner-x")),
          camX: Number(canvas?.getAttribute("data-cam-x")),
        });
        if (t > 3000) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    await timerProbe;
    return { samples, timerDeltas };
  });
  const { samples, timerDeltas } = probe;

  // The chain must actually run: several cells covered.
  const first = samples[0];
  const last = samples[samples.length - 1];
  expect(last.x - first.x).toBeGreaterThanOrEqual(2);

  // Chaining needs each repeat within CHAIN_GAP (220ms) of the settled
  // glide (first transition: 533ms isolated glide + 220ms = ~753ms); if
  // the runner's timers stretch a 620ms wait past that, the repeats
  // settle by design and continuity is unprovable here. Loaded sandboxes
  // skip honestly; CI runners and real devices assert.
  const dilated = Math.max(...timerDeltas) > 740;
  test.skip(dilated, "runner too dilated to prove stride continuity");

  // Interior of the chain (past the first eased step, before release):
  // accumulate standstill only across rendered-frame pairs (a render
  // stall proves nothing about the glide).
  const interior = samples.filter((s) => s.t > 900 && s.t < 2700);
  expect(interior.length).toBeGreaterThan(8);
  let longestPlateauMs = 0;
  let plateauMs = 0;
  let movingPairs = 0;
  for (let i = 1; i < interior.length; i += 1) {
    const dt = interior[i].t - interior[i - 1].t;
    if (dt > 90) continue;
    if (interior[i].x === interior[i - 1].x) {
      plateauMs += dt;
      longestPlateauMs = Math.max(longestPlateauMs, plateauMs);
    } else {
      movingPairs += 1;
      plateauMs = 0;
    }
  }
  expect(movingPairs).toBeGreaterThan(0);
  // The discriminator: the old stop-start glide idled 150ms+ at every
  // cell boundary (measured 157ms via mutation baseline); the chained
  // stride never pauses that long between rendered frames.
  expect(longestPlateauMs).toBeLessThan(140);

  // Camera sync: identical step timing means the camera never leads the
  // miner by more than a sliver mid-chain.
  for (const sample of interior) {
    expect(Math.abs(sample.camX - sample.x)).toBeLessThan(0.2);
  }
});
