import { expect, test } from "@playwright/test";
import {
  imageRegionBlueCentroid,
  imageRegionPixelDifferenceRatio,
  imageRegionRgbStats,
} from "./support/image-pixels";
import {
  APP_VERSION_PATTERN,
  awaitMineSceneReady,
  createMine,
  DEFAULT_GEAR,
  descendLadderShaft,
  digTo,
  dismissReleaseNotes,
  exportDiff,
  MINE_VERSION,
  openStall,
  pressMineKey,
  routeLadderShaftWorld,
  routeStarterMineWorld,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
  touchDrag,
  touchHoldDrag,
  touchPinchOut,
} from "./support/mine-helpers";

test.describe("phone viewport", () => {
  test.use({
    viewport: { width: 390, height: 760 },
    hasTouch: true,
    isMobile: true,
  });

  test("touch drag moves the miner and page pinch stays locked", async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== "chromium", "uses CDP touch events");
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    const canvas = page.locator("canvas");
    await expect(status).toHaveAttribute("data-depth", "0");
    await expect(canvas).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const openTarget = document.elementFromPoint(150, 470);
          return {
            digControlsVisible: Boolean(
              document.querySelector('[aria-label="Dig controls"]'),
            ),
            openMineIsTouchSurface: Boolean(
              openTarget?.closest("[data-touch-surface]"),
            ),
          };
        }),
      )
      .toEqual({
        digControlsVisible: true,
        openMineIsTouchSurface: true,
      });

    const viewportMeta = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(viewportMeta).toContain("maximum-scale=1");
    expect(viewportMeta).toContain("user-scalable=no");
    const pageScale = async () =>
      page.evaluate(() => window.visualViewport?.scale ?? 1);
    await expect.poll(pageScale).toBe(1);

    await touchPinchOut(page, { x: 195, y: 120 });
    await expect.poll(pageScale).toBe(1);

    const startDistance = Number(
      await status.getAttribute("data-horizontal-distance"),
    );
    await touchDrag(page, { x: 150, y: 470 }, { x: 250, y: 470 });
    await expect
      .poll(
        async () =>
          Number(await status.getAttribute("data-horizontal-distance")),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(startDistance);
  });

  test("held touch movement cancels after a fatal fall reset", async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== "chromium", "uses CDP touch events");
    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    await page.route("**/api/gear", async (route) => {
      await route.fulfill({ status: 503, body: "{}" });
    });
    const mine = createMine(6163, DEFAULT_GEAR, STARTING_CONSUMABLES);
    for (let row = 1; row <= 36; row++) {
      setCell(mine, START_COL, row, { kind: "empty" });
    }
    setCell(mine, START_COL, 37, { kind: "dirt" });
    await page.addInitScript(
      (trip) => {
        localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));
      },
      {
        seed: 6163,
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
    const releaseTouch = await touchHoldDrag(
      page,
      { x: 150, y: 470 },
      { x: 150, y: 620 },
    );
    try {
      await expect
        .poll(async () => canvas.getAttribute("data-fall-visual-active"), {
          timeout: 5_000,
        })
        .toBe("true");
      await page.waitForTimeout(1_400);
      const savedMoveCount = await page.evaluate(() => {
        const raw = localStorage.getItem("vibebots-mine-trip-v2-slot-1");
        return raw ? JSON.parse(raw).moves.length : -1;
      });
      expect(savedMoveCount).toBe(1);
    } finally {
      await releaseTouch();
    }
    const report = page.getByRole("button", { name: "Dismiss trip report" });
    await expect(report).toBeVisible({ timeout: 15_000 });
    await report.click();
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");
    const startDistance = Number(
      await status.getAttribute("data-horizontal-distance"),
    );
    await touchDrag(page, { x: 150, y: 470 }, { x: 250, y: 470 });
    await expect
      .poll(
        async () =>
          Number(await status.getAttribute("data-horizontal-distance")),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(startDistance);
  });

  test("surface saves with bunkers still accept movement drags", async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== "chromium", "uses CDP touch events");
    const mine = createMine(8086, DEFAULT_GEAR, STARTING_CONSUMABLES);
    await page.route("**/api/mine/world", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          activeSlot: 2,
          seed: 8086,
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
    const status = page.getByLabel("Mine status");
    await expect(page.locator("canvas")).toBeVisible();
    await expect(status).toHaveAttribute("data-depth", "0");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const openTarget = document.elementFromPoint(150, 470);
          return Boolean(openTarget?.closest("[data-touch-surface]"));
        }),
      )
      .toBe(true);

    const startDistance = Number(
      await status.getAttribute("data-horizontal-distance"),
    );
    await touchDrag(page, { x: 150, y: 470 }, { x: 250, y: 470 });
    await expect
      .poll(
        async () =>
          Number(await status.getAttribute("data-horizontal-distance")),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(startDistance);
  });

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
    for (let i = 0; i < 48; i++) {
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
      .toBeLessThanOrEqual(-3);
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
      .toBeGreaterThanOrEqual(0);
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
    // The compile-gated first load can stall the main thread past the
    // whole sample window on slow hosts; the sampler retries after such
    // a dropped window, so start the clock at the painted scene.
    await expect(page.getByLabel("Mine status")).toHaveAttribute(
      "data-scene-painted",
      "true",
      { timeout: 30_000 },
    );
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

  test("a downward drag from anywhere inside a stall sheet dismisses it", async ({
    page,
  }) => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-depth", "0");

    // Stand at the Upgrades stall and tap the prompt to open the sheet.
    const upgradesPrompt = page.getByRole("button", { name: "Open Upgrades" });
    for (let i = 0; i < 12; i++) {
      if (await upgradesPrompt.isVisible().catch(() => false)) break;
      await pressMineKey(page, "ArrowRight");
    }
    const upgrades = await openStall(page, "Upgrades");
    // Let the slide-up entrance (0.28s) settle so the docked baseline
    // is the resting position, not a mid-animation frame.
    await page.waitForTimeout(450);

    // Grab the interior of the sheet, below the header affordance.
    const box = await upgrades.boundingBox();
    if (!box) throw new Error("sheet has no bounding box");
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(220, box.height * 0.55);
    await page.mouse.move(x, y);
    await page.mouse.down();

    // Rule 10: the sheet visibly follows the finger before release. Pull
    // partway (under the close threshold) and confirm it actually moved
    // down, then that a short pull snaps back to its docked position.
    await page.mouse.move(x, y + 40);
    await page.waitForTimeout(30);
    const dragged = await upgrades.boundingBox();
    if (!dragged) throw new Error("sheet vanished mid-drag");
    expect(dragged.y).toBeGreaterThan(box.y + 15);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const snapped = await upgrades.boundingBox();
    if (!snapped) throw new Error("sheet dismissed on a sub-threshold drag");
    expect(snapped.y).toBeLessThan(dragged.y - 10);
    await expect(upgrades).toBeVisible();

    // Now a full pull past the threshold dismisses, still on the column.
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(x, y + i * 25);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await expect(upgrades).not.toBeVisible();
    await expect(status).toHaveAttribute("data-depth", "0");
  });
});

test("mine wheel zoom extends into the starter lantern falloff", async ({
  page,
}) => {
  // A carved shaft drops the miner underground fast, where the lantern is
  // the only light.
  await routeLadderShaftWorld(page, 5150, 8);
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => canvas.getAttribute("data-cam-zoom"), {
      timeout: 5_000,
    })
    .not.toBeNull();

  // Underground the circular fog of war is on at the default view (F-055,
  // F-065): cells past the lantern reach are obscured without waiting for
  // the zoom-out cap.
  await descendLadderShaft(page, 6);
  const startZoom = Number(await canvas.getAttribute("data-cam-zoom"));
  const readDarkness = async () => ({
    min: Number(await canvas.getAttribute("data-darkness-opacity-min")),
    max: Number(await canvas.getAttribute("data-darkness-opacity-max")),
  });
  await expect
    .poll(async () => (await readDarkness()).max, { timeout: 5_000 })
    .toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute(
    "data-visibility-mask",
    "continuous-radial",
  );
  await expect(canvas).toHaveAttribute("data-cell-seams", "occluded");
  expect((await readDarkness()).max).toBeLessThanOrEqual(0.88);

  await page.mouse.move(500, 380);
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeLessThan(startZoom);
  // Zooming in keeps the falloff on; the lit circle simply fills more of
  // the view.
  const zoomedInDark = await readDarkness();
  expect(zoomedInDark.max).toBeGreaterThan(0);
  expect(zoomedInDark.max).toBeLessThanOrEqual(0.88);

  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 600);
  }
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeGreaterThan(startZoom);
  await expect(canvas).toHaveAttribute("data-lit-below", "3");
  await expect(canvas).toHaveAttribute("data-render-below", "8");
  await expect(canvas).toHaveAttribute("data-render-radius", "8");
  await expect(canvas).toHaveAttribute(
    "data-render-min-col",
    String(START_COL - 8),
  );
  await expect(canvas).toHaveAttribute(
    "data-render-max-col",
    String(START_COL + 8),
  );
  const zoomedOutDark = await readDarkness();
  expect(zoomedOutDark.min).toBeGreaterThan(0);
  expect(zoomedOutDark.max).toBeGreaterThan(zoomedOutDark.min);
  expect(zoomedOutDark.max).toBeLessThanOrEqual(0.88);
  expect(zoomedOutDark.max).toBeGreaterThanOrEqual(0.8);
});

test("mine HUD zoom buttons adjust the lantern-capped camera", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const w = window as typeof window & {
      __vibebotsSurfaceTipSequence?: (string | null)[];
      __vibebotsSurfaceTipRotationMs?: number;
    };
    w.__vibebotsSurfaceTipSequence = [
      "Tip: Distant biome beacons become free portals back to base.",
    ];
    w.__vibebotsSurfaceTipRotationMs = 60_000;
  });
  // A carved shaft drops the miner underground where the fog of war shows.
  await routeLadderShaftWorld(page, 5151, 8);
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  const zoomControls = page.locator('[aria-label="Zoom controls"]');
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const settingsButton = page.getByRole("button", { name: "Open settings" });
  await expect(canvas).toBeVisible();
  await expect(zoomControls).toBeVisible();
  await expect(settingsButton).toBeVisible();
  await expect(
    page.getByText(
      "Tip: Distant biome beacons become free portals back to base.",
    ),
  ).toBeVisible();
  const expectZoomControlsClear = async () => {
    await expect(
      page.evaluate(() => {
        const zoom = document
          .querySelector('[aria-label="Zoom controls"]')
          ?.getBoundingClientRect();
        const statusTargets = [
          ...document.querySelectorAll('[aria-label="Mine status"] > span'),
        ].map((node) => node.getBoundingClientRect());
        const settings = document
          .querySelector('[aria-label="Open settings"]')
          ?.getBoundingClientRect();
        if (!zoom || !settings || statusTargets.length === 0) return false;
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        return (
          Math.abs(zoom.right - settings.right) < 1 &&
          zoom.top >= settings.bottom + 8 &&
          statusTargets.every((status) => !overlaps(zoom, status)) &&
          !overlaps(zoom, settings)
        );
      }),
    ).resolves.toBe(true);
  };
  const expectZoomControlsClearOfSettings = async () => {
    await expect(
      page.evaluate(() => {
        const zoom = document
          .querySelector('[aria-label="Zoom controls"]')
          ?.getBoundingClientRect();
        const settings = document
          .querySelector('[aria-label="Settings"]')
          ?.getBoundingClientRect();
        if (!zoom || !settings) return false;
        return (
          zoom.left >= settings.right ||
          zoom.right <= settings.left ||
          zoom.top >= settings.bottom ||
          zoom.bottom <= settings.top
        );
      }),
    ).resolves.toBe(true);
  };
  await expectZoomControlsClear();
  await settingsButton.click();
  const settingsPanel = page.getByRole("region", { name: "Settings" });
  await expect(settingsPanel).toBeVisible();
  await expectZoomControlsClearOfSettings();
  await settingsButton.click();
  await expect(settingsPanel).not.toBeVisible();
  await expectZoomControlsClear();
  await settingsButton.click();
  await expect(settingsPanel).toBeVisible();
  await expectZoomControlsClearOfSettings();
  await settingsButton.click();
  await expect(settingsPanel).not.toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(
    page.evaluate(() => {
      const zoom = document
        .querySelector('[aria-label="Zoom controls"]')
        ?.getBoundingClientRect();
      if (!zoom) return false;
      return zoom.left >= 0 && zoom.right <= window.innerWidth;
    }),
  ).resolves.toBe(true);
  await expect
    .poll(async () => canvas.getAttribute("data-cam-zoom"), {
      timeout: 5_000,
    })
    .not.toBeNull();

  // Underground, the lantern fog of war is present at the default view
  // now (F-065), not only at the zoom-out cap.
  await descendLadderShaft(page, 6);
  const startZoom = Number(await canvas.getAttribute("data-cam-zoom"));
  await expect
    .poll(
      async () =>
        Number(await canvas.getAttribute("data-darkness-opacity-max")),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(0);
  await zoomOut.click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeGreaterThan(startZoom);
  // The falloff stays on through the zoom step.
  expect(
    Number(await canvas.getAttribute("data-darkness-opacity-max")),
  ).toBeGreaterThan(0);

  await zoomOut.click();
  await expect(zoomOut).toBeDisabled();
  await expect(canvas).toHaveAttribute("data-cam-zoom", "1.32");
  await expect(canvas).toHaveAttribute("data-lit-below", "3");
  await expect(canvas).toHaveAttribute("data-render-below", "8");
  await expect(canvas).toHaveAttribute("data-lamp-distance", "9.00");
  const minDarkness = Number(
    await canvas.getAttribute("data-darkness-opacity-min"),
  );
  const maxDarkness = Number(
    await canvas.getAttribute("data-darkness-opacity-max"),
  );
  expect(minDarkness).toBeGreaterThan(0);
  expect(maxDarkness).toBeGreaterThan(minDarkness);
  expect(maxDarkness).toBeLessThanOrEqual(0.88);
  expect(maxDarkness).toBeGreaterThanOrEqual(0.8);
  await expect(zoomControls).toHaveAttribute("data-camera-zoom-max", "1.32");

  await zoomIn.click();
  await expect(zoomOut).toBeEnabled();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-cam-zoom")), {
      timeout: 5_000,
    })
    .toBeLessThan(1.32);
});

test.describe("Pixel density mine visibility", () => {
  test.use({
    viewport: { width: 448, height: 923 },
    deviceScaleFactor: 2.25,
    hasTouch: true,
    isMobile: true,
  });

  test("daylight keeps useful visibility at every zoom", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      (
        window as typeof window & { __vibebotsTimeOfDayHour?: number }
      ).__vibebotsTimeOfDayHour = 13;
      localStorage.setItem("vibebots-graphics-quality-v1", "low");
      localStorage.removeItem("vibebots-mine-camera-zoom-v1");
    });
    await routeStarterMineWorld(page, 7313, (mine) => {
      for (let row = 1; row <= 8; row++) {
        for (let col = START_COL - 5; col <= START_COL + 5; col++) {
          setCell(mine, col, row, { kind: "dirt" });
        }
      }
    });
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const canvas = page.locator("canvas");
    await awaitMineSceneReady(page);
    await expect(canvas).toHaveAttribute("data-surface-phase", "day", {
      timeout: 30_000,
    });
    await expect(canvas).toHaveAttribute("data-renderer", "webgl2-forced");
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          const mineCanvas = element as HTMLCanvasElement;
          return [mineCanvas.width, mineCanvas.height];
        }),
      )
      .toEqual([672, 1384]);

    const zoomOut = page.getByRole("button", { name: "Zoom out" });
    const zoomSamples: Array<{
      zoom: number;
      meanRed: number;
      meanBlue: number;
      nearBlackRatio: number;
    }> = [];
    for (let step = 0; step < 3; step += 1) {
      await page.waitForTimeout(500);
      const image = await canvas.screenshot();
      const stats = await imageRegionRgbStats(page, image, {
        left: 0.08,
        right: 0.92,
        top: 0.58,
        bottom: 0.76,
      });
      zoomSamples.push({
        zoom: Number(await canvas.getAttribute("data-cam-zoom")),
        ...stats,
      });
      expect(stats.meanRed).toBeGreaterThan(stats.meanBlue + 12);
      expect(stats.nearBlackRatio).toBeLessThan(0.12);
      if (step < 2) await zoomOut.click();
    }

    expect(zoomSamples.map(({ zoom }) => zoom)).toEqual([1, 1.16, 1.32]);
    await expect(zoomOut).toBeDisabled();
    expect(
      Number(await canvas.getAttribute("data-draw-calls")),
    ).toBeLessThanOrEqual(110);
    expect(zoomSamples[2].meanRed - zoomSamples[2].meanBlue).toBeGreaterThan(
      18,
    );
  });

  test("planet stays camera-locked through a complete surface step", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      (
        window as typeof window & { __vibebotsTimeOfDayHour?: number }
      ).__vibebotsTimeOfDayHour = 0;
      localStorage.setItem("vibebots-graphics-quality-v1", "low");
    });
    await routeStarterMineWorld(page, 7315);
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const canvas = page.locator("canvas");
    await awaitMineSceneReady(page);
    await expect(canvas).toHaveAttribute("data-surface-phase", "night", {
      timeout: 30_000,
    });
    await expect(canvas).toHaveAttribute(
      "data-surface-celestial-screen-x",
      "0.000",
      { timeout: 30_000 },
    );
    const status = page.getByLabel("Mine status");
    for (let i = 0; i < 50; i++) {
      if (Number(await status.getAttribute("data-horizontal-distance")) >= 16) {
        break;
      }
      await pressMineKey(page, "ArrowRight");
    }
    await expect(status).toHaveAttribute("data-horizontal-distance", "16");
    await page.waitForTimeout(400);
    const before = await canvas.screenshot();

    await page.evaluate(() => {
      const reviewWindow = window as typeof window & {
        __surfaceParallaxSamples?: Array<{ camera: number; planet: number }>;
      };
      reviewWindow.__surfaceParallaxSamples = [];
      const startedAt = performance.now();
      const sample = () => {
        const mineCanvas = document.querySelector("canvas");
        if (mineCanvas instanceof HTMLCanvasElement) {
          reviewWindow.__surfaceParallaxSamples?.push({
            camera: Number(mineCanvas.dataset.camX),
            planet: Number(mineCanvas.dataset.surfaceCelestialScreenX),
          });
        }
        if (performance.now() - startedAt < 700) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await pressMineKey(page, "ArrowRight");
    await page.waitForTimeout(550);

    const samples = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __surfaceParallaxSamples?: Array<{
              camera: number;
              planet: number;
            }>;
          }
        ).__surfaceParallaxSamples ?? [],
    );
    const finiteSamples = samples.filter(
      ({ camera, planet }) =>
        Number.isFinite(camera) && Number.isFinite(planet),
    );
    // Pixel software WebGL can render at 8-15 fps under CI. Four samples
    // still span the complete 280 ms camera settle plus the stopped frame.
    expect(finiteSamples.length).toBeGreaterThan(3);
    const cameraSamples = finiteSamples.map(({ camera }) => camera);
    expect(
      Math.max(...cameraSamples) - Math.min(...cameraSamples),
    ).toBeGreaterThan(0.5);
    expect(
      Math.max(...finiteSamples.map(({ planet }) => Math.abs(planet))),
    ).toBe(0);
    await expect(canvas).toHaveAttribute(
      "data-surface-celestial-screen-x",
      "0.000",
    );
    const after = await canvas.screenshot();
    const planetBounds = { left: 0.65, top: 0, right: 1, bottom: 0.3 };
    const beforePlanet = await imageRegionBlueCentroid(
      page,
      before,
      planetBounds,
    );
    const afterPlanet = await imageRegionBlueCentroid(
      page,
      after,
      planetBounds,
    );
    expect(beforePlanet.pixels).toBeGreaterThan(25_000);
    expect(afterPlanet.pixels).toBe(beforePlanet.pixels);
    expect(afterPlanet.x).toBeCloseTo(beforePlanet.x, 4);
    expect(afterPlanet.y).toBeCloseTo(beforePlanet.y, 4);
    expect(
      await imageRegionPixelDifferenceRatio(page, before, after, {
        left: 0.76,
        top: 0,
        right: 1,
        bottom: 0.28,
      }),
    ).toBeLessThan(0.0005);
    await testInfo.attach("planet-before-surface-step", {
      body: before,
      contentType: "image/png",
    });
    await testInfo.attach("planet-after-surface-step", {
      body: after,
      contentType: "image/png",
    });
  });

  test("adjacent occupied cells keep their open silhouette", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      (
        window as typeof window & { __vibebotsTimeOfDayHour?: number }
      ).__vibebotsTimeOfDayHour = 13;
      localStorage.setItem("vibebots-graphics-quality-v1", "low");
      localStorage.setItem("vibebots-mine-camera-zoom-v1", "1.32");
    });
    await routeStarterMineWorld(page, 7314, (mine) => {
      for (let row = 1; row <= 8; row++) {
        for (let col = START_COL - 5; col <= START_COL + 5; col++) {
          setCell(mine, col, row, { kind: "empty" });
        }
      }
      for (let col = START_COL - 5; col <= START_COL + 5; col++) {
        setCell(mine, col, 1, { kind: "dirt" });
      }
      setCell(mine, START_COL, 3, { kind: "boulder" });
      setCell(mine, START_COL + 1, 3, { kind: "boulder" });
      setCell(mine, START_COL + 2, 3, { kind: "dirt" });
      setCell(mine, START_COL, 4, { kind: "dirt" });
      setCell(mine, START_COL + 1, 4, { kind: "rock" });
    });
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    const canvas = page.locator("canvas");
    await awaitMineSceneReady(page);
    await expect(canvas).toHaveAttribute("data-surface-phase", "day", {
      timeout: 30_000,
    });
    await expect(canvas).toHaveAttribute("data-cam-zoom", "1.32", {
      timeout: 30_000,
    });

    await page.waitForTimeout(1_500);
    const image = await canvas.screenshot();
    await testInfo.attach("adjacent-cell-silhouettes", {
      body: image,
      contentType: "image/png",
    });
    const horizontalGap = await imageRegionRgbStats(page, image, {
      left: 0.56,
      right: 0.58,
      top: 0.7,
      bottom: 0.74,
    });
    const junctionGap = await imageRegionRgbStats(page, image, {
      left: 0.55,
      right: 0.59,
      top: 0.75,
      bottom: 0.77,
    });
    expect(horizontalGap.nearBlackRatio).toBeGreaterThan(0.35);
    expect(junctionGap.nearBlackRatio).toBeGreaterThan(0.5);
  });
});
