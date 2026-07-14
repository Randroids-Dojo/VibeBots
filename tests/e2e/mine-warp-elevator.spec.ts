import { expect, type Page, test } from "@playwright/test";
import {
  awaitMineSceneReady,
  createMine,
  DEFAULT_GEAR,
  digLateral,
  digTo,
  dismissReleaseNotes,
  exportDiff,
  MINE_VERSION,
  openStall,
  pressMineKey,
  routeStarterMineWorld,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "./support/mine-helpers";

interface MineMotionSample {
  minerY: number;
  cameraY: number;
  carY: number;
  riding: string;
  stage: string;
}

interface MineMotionProbe {
  samples: MineMotionSample[];
  frame: number;
}

async function installMineMotionProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const browserWindow = window as typeof window & {
      __mineElevatorMotionProbe?: MineMotionProbe;
    };
    const previous = browserWindow.__mineElevatorMotionProbe;
    if (previous) cancelAnimationFrame(previous.frame);
    const probe: MineMotionProbe = { samples: [], frame: 0 };
    browserWindow.__mineElevatorMotionProbe = probe;
    const sample = () => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas");
      const status = document.querySelector<HTMLElement>(
        '[aria-label="Mine status"]',
      );
      const minerY = Number(canvas?.dataset.minerY);
      const cameraY = Number(canvas?.dataset.camY);
      const carY = Number(canvas?.dataset.elevatorCarY);
      if (Number.isFinite(minerY) && Number.isFinite(cameraY)) {
        probe.samples.push({
          minerY,
          cameraY,
          carY,
          riding: status?.dataset.elevatorRiding ?? "",
          stage: status?.dataset.elevatorStage ?? "",
        });
      }
      probe.frame = requestAnimationFrame(sample);
    };
    sample();
  });
}

async function resetMineMotionProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __mineElevatorMotionProbe?: MineMotionProbe;
      }
    ).__mineElevatorMotionProbe;
    if (!probe) throw new Error("mine motion probe is not installed");
    probe.samples.length = 0;
  });
}

async function readMineMotionProbe(page: Page): Promise<MineMotionSample[]> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __mineElevatorMotionProbe?: MineMotionProbe;
      }
    ).__mineElevatorMotionProbe;
    return probe?.samples ?? [];
  });
}

function distinctMotionValues(
  samples: MineMotionSample[],
  value: (sample: MineMotionSample) => number,
): number {
  return new Set(samples.map((sample) => value(sample).toFixed(2))).size;
}

function motionValueSummary(
  samples: MineMotionSample[],
  value: (sample: MineMotionSample) => number,
): string {
  return [...new Set(samples.map((sample) => value(sample).toFixed(2)))].join(
    ", ",
  );
}

function motionRange(
  samples: MineMotionSample[],
  value: (sample: MineMotionSample) => number,
): number {
  const values = samples.map(value).filter(Number.isFinite);
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

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
  const pad = await openStall(page, "Warp Pad", "ArrowRight");
  await expect(pad).toContainText("No planted beacons yet");
  await expect(pad).toContainText("Warpcoil range: 60 rows");
  await expect(
    pad.getByRole("button", { name: "Warp to beacon" }),
  ).toBeDisabled();
});

test("warp beacon planting disables beyond current Warpcoil range", async ({
  page,
}) => {
  const gear = {
    ...DEFAULT_GEAR,
    pickaxe: 5,
    battery: 4,
    cargo: 4,
    lantern: 3,
    warpcoil: 1,
  };
  const targetRow = 61;
  const baseDiff = Array.from({ length: targetRow }, (_, index) => [
    START_COL,
    index + 1,
    { kind: "empty", ladder: true },
  ]);
  const trip = {
    seed: 20260620,
    mineVersion: MINE_VERSION,
    tripIndex: 0,
    gear,
    consumables: { ...STARTING_CONSUMABLES, beacon: 1 },
    baseDiff,
    moves: Array.from({ length: targetRow }, () => "down"),
  };
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: {
        activeSlot: 1,
        seed: trip.seed,
        tripIndex: trip.tripIndex,
        diff: baseDiff,
      },
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear,
        consumables: trip.consumables,
        balance: 0,
      },
    });
  });
  await page.addInitScript((savedTrip) => {
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify(savedTrip),
    );
  }, trip);

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", String(targetRow));

  const beacon = page.getByRole("button", { name: "Plant warp beacon" });
  await expect(beacon).toBeVisible();
  await expect(beacon).toHaveAttribute("aria-disabled", "true");
  await expect(beacon).toHaveCSS("opacity", "0.42");
  await beacon.click({ force: true });
  await expect(
    page.getByText("Beacon is beyond Warpcoil range. Upgrade Warpcoil."),
  ).toBeVisible();
  await expect(beacon).toContainText("1");
});

test.describe
  .serial("deep saved-trip smoke", () => {
    test("biome portal beacons activate and appear at the Warp Pad", async ({
      page,
    }) => {
      await page.route("**/api/mine/world", async (route) => {
        await route.fulfill({
          json: {
            activeSlot: 1,
            seed: 20260619,
            tripIndex: 0,
            diff: [],
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
      const winterTrip = {
        seed: 20260619,
        mineVersion: MINE_VERSION,
        tripIndex: 0,
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        baseDiff: [],
        moves: Array.from({ length: 75 }, () => "left"),
      };
      await page.addInitScript((savedTrip) => {
        localStorage.setItem(
          "vibebots-mine-trip-v2-slot-1",
          JSON.stringify(savedTrip),
        );
      }, winterTrip);
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
      const pad = await openStall(page, "Warp Pad", "ArrowRight");
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
        warpcoil: 5,
      };
      const consumables = { ...STARTING_CONSUMABLES, beacon: 0 };
      const baseDiff = [
        [0, 665, { kind: "empty", beacon: true, drop: { coal: 12 } }],
        [1, 665, { kind: "rock", rockTier: 3, fallen: true }],
        [1, 664, { kind: "rock", rockTier: 3, fallen: true }],
        [0, 666, { kind: "rock", rockTier: 3, fallen: true }],
        [-1, 665, { kind: "empty" }],
        [0, 664, { kind: "empty" }],
      ];
      await page.route("**/api/mine/world", async (route) => {
        await route.fulfill({
          json: {
            activeSlot: 1,
            seed: 12345,
            tripIndex: 0,
            diff: baseDiff,
          },
        });
      });
      await page.route("**/api/gear", async (route) => {
        await route.fulfill({ json: { gear, consumables, balance: 0 } });
      });
      await page.goto("/mine");
      await dismissReleaseNotes(page);
      const status = page.getByLabel("Mine status");

      for (let i = 0; i < 6; i++) await pressMineKey(page, "ArrowRight");
      const pad = await openStall(page, "Warp Pad", "ArrowRight");
      await pad.getByRole("button", { name: "Warp" }).click();
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
  const pad = await openStall(page, "Warp Pad", "ArrowRight");
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

test("the elevator places a chosen shaft and sells one premium rail row", async ({
  page,
}) => {
  await routeStarterMineWorld(page, 9291, (mine) => {
    for (let col = START_COL - 1; col >= -5; col -= 1) {
      setCell(mine, col, 0, { kind: "empty" });
    }
  });
  let serverGear = { ...DEFAULT_GEAR };
  let serverBalance = 60;
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: serverGear,
        consumables: STARTING_CONSUMABLES,
        balance: serverBalance,
      },
    });
  });
  let releaseFirstPurchase = () => {};
  const firstPurchaseGate = new Promise<void>((resolve) => {
    releaseFirstPurchase = resolve;
  });
  let releaseSecondPurchase = () => {};
  const secondPurchaseGate = new Promise<void>((resolve) => {
    releaseSecondPurchase = resolve;
  });
  const purchaseBodies: unknown[] = [];
  await page.route("**/api/elevator/upgrade", async (route) => {
    const body = route.request().postDataJSON() as { column?: number };
    purchaseBodies.push(body);
    const first = purchaseBodies.length === 1;
    if (first) await firstPurchaseGate;
    else await secondPurchaseGate;
    serverGear = {
      ...serverGear,
      elevator: first ? 1 : 2,
      elevatorColumn: first ? body.column : serverGear.elevatorColumn,
    };
    serverBalance = first ? 35 : 10;
    await route.fulfill({
      json: {
        elevator: serverGear.elevator,
        elevatorColumn: serverGear.elevatorColumn,
        balance: serverBalance,
      },
    });
  });
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  const elevator = await openStall(page, "Elevator", "ArrowLeft");
  await expect(elevator).toContainText("choose your shaft column");
  await expect(elevator).toContainText("first rail costs 25 vibes");
  await elevator
    .getByRole("button", { name: "Choose elevator shaft location" })
    .click();

  const placement = page.getByRole("region", { name: "Place elevator shaft" });
  await expect(placement).toBeVisible();
  await pressMineKey(page, "ArrowRight");
  await expect(placement).toContainText("Shaft column -4");
  const build = placement.getByRole("button", {
    name: "Build here: 25 vibes",
  });
  await expect(build).toBeEnabled();
  await expect(placement).toBeFocused();
  await page.keyboard.press("Enter");
  const building = placement.getByRole("button", { name: "Building..." });
  await expect(building).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  await expect(placement).toContainText("Shaft column -4");
  expect(purchaseBodies).toEqual([{ column: -4 }]);
  releaseFirstPurchase();

  await expect(status).toHaveAttribute("data-elevator-col", "-4");
  await expect(status).toHaveAttribute("data-elevator-depth", "1");
  await expect(status).toHaveAttribute("data-elevator-placement", "false");
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeFocused();
  expect(purchaseBodies).toEqual([{ column: -4 }]);

  await pressMineKey(page, "ArrowLeft");
  const reopened = await openStall(page, "Elevator");
  await expect(reopened).toContainText("rail at column -4 reaches 1 deep");
  await expect(reopened).toContainText("one premium row per purchase");
  const extend = reopened.getByRole("button", {
    name: "Buy one elevator rail for 25 vibes",
  });
  await extend.click();
  const buying = reopened.getByRole("button", {
    name: "Buying one elevator rail",
  });
  await expect(buying).toBeVisible();
  await buying.click({ force: true });
  expect(purchaseBodies).toEqual([{ column: -4 }, {}]);
  releaseSecondPurchase();
  await expect(status).toHaveAttribute("data-elevator-depth", "2");
  expect(purchaseBodies).toEqual([{ column: -4 }, {}]);

  await page.reload();
  await expect(status).toHaveAttribute("data-elevator-col", "-4");
  await expect(status).toHaveAttribute("data-elevator-depth", "2");
  await awaitMineSceneReady(page);
  await expect(status).toHaveAttribute("data-scene-painted", "true", {
    timeout: 20_000,
  });
  const resumedColumn = Number(await status.getAttribute("data-col"));
  const shaftSteps = Math.abs(resumedColumn - -4);
  const shaftDirection = resumedColumn < -4 ? "ArrowRight" : "ArrowLeft";
  for (let step = 0; step < shaftSteps; step += 1) {
    await pressMineKey(page, shaftDirection);
  }
  await expect(status).toHaveAttribute("data-col", "-4");
  await page.keyboard.press("ArrowDown");
  await expect(status).toHaveAttribute("data-elevator-stage", "calling");
  await expect(
    page.getByTestId("elevator-controls").getByRole("status"),
  ).toHaveText("Elevator coming");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Go to bottom" }).click();
  await expect(status).toHaveAttribute("data-depth", "2");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Go to top" })).toBeVisible();
});

test("an existing owner places their full shaft once for free", async ({
  page,
}) => {
  await routeStarterMineWorld(page, 9296, (mine) => {
    for (let col = START_COL - 1; col >= -5; col -= 1) {
      setCell(mine, col, 0, { kind: "empty" });
    }
    for (let row = 1; row <= 4; row += 1) {
      setCell(mine, -5, row, { kind: "empty" });
    }
  });
  let serverGear = {
    ...DEFAULT_GEAR,
    elevator: 4,
    elevatorColumn: -5,
  };
  let placementRequired = true;
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: {
        gear: serverGear,
        consumables: STARTING_CONSUMABLES,
        balance: 0,
        elevatorPlacementRequired: placementRequired,
      },
    });
  });
  const placementBodies: unknown[] = [];
  await page.route("**/api/elevator/upgrade", async (route) => {
    const body = route.request().postDataJSON() as { column: number };
    placementBodies.push(body);
    serverGear = { ...serverGear, elevatorColumn: body.column };
    placementRequired = false;
    await route.fulfill({
      json: {
        elevator: 4,
        elevatorColumn: body.column,
        elevatorPlacementRequired: false,
        relocated: true,
        tripIndex: 1,
        balance: 0,
      },
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const elevator = await openStall(page, "Elevator", "ArrowLeft");
  await expect(elevator).toContainText("place your existing 4-row shaft");
  await expect(elevator).toContainText("one free location choice");
  await elevator
    .getByRole("button", { name: "Choose free elevator shaft location" })
    .click();

  const placement = page.getByRole("region", { name: "Place elevator shaft" });
  await expect(placement).toContainText("Move your 4-row shaft to column -5");
  await pressMineKey(page, "ArrowRight");
  await expect(placement).toContainText("Move your 4-row shaft to column -4");
  const move = placement.getByRole("button", { name: "Move here: Free" });
  await expect(move).toBeEnabled();
  await move.click();

  await expect(status).toHaveAttribute("data-elevator-col", "-4");
  await expect(status).toHaveAttribute("data-elevator-depth", "4");
  await expect(status).toHaveAttribute("data-elevator-placement", "false");
  await expect(status).toHaveAttribute("data-wallet", "0");
  expect(placementBodies).toEqual([{ column: -4 }]);
});

test("surface entry calls the car before an explicit ride to the bottom", async ({
  page,
}) => {
  const shaftCol = 3;
  const railDepth = 11;
  const gear = {
    ...DEFAULT_GEAR,
    elevator: railDepth,
    elevatorColumn: shaftCol,
    elevatorSpeed: 2,
  };
  const mine = createMine(9292, gear, STARTING_CONSUMABLES);
  for (let col = START_COL + 1; col <= shaftCol; col += 1) {
    setCell(mine, col, 0, { kind: "empty" });
  }
  for (let row = 1; row <= railDepth; row += 1) {
    setCell(mine, shaftCol, row, { kind: "empty" });
  }
  const baseDiff = exportDiff(mine);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: { activeSlot: 1, seed: 9292, tripIndex: 0, diff: baseDiff },
    });
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
      if (sessionStorage.getItem("elevator-surface-fixture") === "ready") {
        return;
      }
      localStorage.setItem(
        "vibebots-mine-trip-v2-slot-1",
        JSON.stringify(trip),
      );
      sessionStorage.setItem("elevator-surface-fixture", "ready");
    },
    {
      seed: 9292,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff,
      moves: [],
    },
  );
  await installMineMotionProbe(page);

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(canvas).toHaveAttribute("data-miner-x", "0.00");
  for (let col = 1; col <= shaftCol; col += 1) {
    await pressMineKey(page, "ArrowRight");
  }
  await expect(canvas).toHaveAttribute("data-miner-x", "3.00");

  await resetMineMotionProbe(page);
  await page.keyboard.press("ArrowDown");
  await expect(status).toHaveAttribute("data-elevator-stage", "calling");
  await expect(status).toHaveAttribute("data-depth", "0");
  await page.waitForTimeout(250);
  await expect(status).toHaveAttribute("data-depth", "0");
  const callSamples = (await readMineMotionProbe(page)).filter(
    (sample) => sample.stage === "calling",
  );
  expect(callSamples.length).toBeGreaterThan(2);
  expect(
    motionRange(callSamples, (sample) => sample.carY),
    `car Y samples: ${motionValueSummary(callSamples, (sample) => sample.carY)}`,
  ).toBeGreaterThan(0.2);
  expect(
    motionRange(callSamples, (sample) => sample.minerY),
    `miner Y samples: ${motionValueSummary(callSamples, (sample) => sample.minerY)}`,
  ).toBeLessThan(0.05);
  expect(
    motionRange(callSamples, (sample) => sample.cameraY),
    `camera Y samples: ${motionValueSummary(callSamples, (sample) => sample.cameraY)}`,
  ).toBeLessThan(0.05);
  await expect(canvas).toHaveAttribute("data-fall-visual-active", "false");

  await expect(status).toHaveAttribute("data-elevator-phase", "boarded", {
    timeout: 10_000,
  });
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(canvas).toHaveAttribute("data-miner-y", "-0.08");
  const destination = page.getByLabel("Choose elevator destination");
  await expect(destination).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to top" })).toHaveCount(0);
  const goBottom = page.getByRole("button", { name: "Go to bottom" });
  await expect(goBottom).toBeVisible();
  await expect(goBottom).toBeFocused();

  await resetMineMotionProbe(page);
  await goBottom.click();
  await expect(status).toHaveAttribute("data-elevator-stage", "riding");
  await expect(canvas).toHaveAttribute("data-miner-y", "-11.00", {
    timeout: 10_000,
  });
  await expect(canvas).toHaveAttribute("data-cam-y", "-11.00", {
    timeout: 10_000,
  });
  const rideSamples = (await readMineMotionProbe(page)).filter(
    (sample) => sample.stage === "riding",
  );
  expect(
    distinctMotionValues(rideSamples, (sample) => sample.minerY),
    `miner Y samples: ${motionValueSummary(rideSamples, (sample) => sample.minerY)}`,
  ).toBeGreaterThan(2);
  expect(
    distinctMotionValues(rideSamples, (sample) => sample.cameraY),
    `camera Y samples: ${motionValueSummary(rideSamples, (sample) => sample.cameraY)}`,
  ).toBeGreaterThan(2);
  expect(
    Number(await canvas.getAttribute("data-rendered-cell-count")),
  ).toBeGreaterThan(20);

  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")), {
      timeout: 5_000,
    })
    .toBe(railDepth);
  await expect(status).toHaveAttribute("data-elevator-riding", "");
  await expect(canvas).toHaveAttribute("data-miner-x", "3.00");
  expect(
    Number(await canvas.getAttribute("data-miner-motion-frames")),
  ).toBeGreaterThan(1);
  expect(
    Number(await canvas.getAttribute("data-camera-motion-frames")),
  ).toBeGreaterThan(1);

  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  const goTop = page.getByRole("button", { name: "Go to top" });
  await expect(goTop).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to bottom" })).toHaveCount(
    0,
  );

  await goTop.click();
  await expect(status).toHaveAttribute("data-elevator-stage", "riding");
  await expect(status).toHaveAttribute("data-depth", "0", {
    timeout: 10_000,
  });
  await expect(status).toHaveAttribute("data-elevator-riding", "", {
    timeout: 10_000,
  });
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("button", { name: "Go to bottom" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to top" })).toHaveCount(0);

  await page.reload();
  await awaitMineSceneReady(page);
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toHaveAttribute("data-elevator-phase", "boarded");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("button", { name: "Go to bottom" }),
  ).toBeVisible();
});

test("an underground side entry calls the car before an explicit ride to the top", async ({
  page,
}) => {
  const shaftCol = 3;
  const railDepth = 10;
  const gear = {
    ...DEFAULT_GEAR,
    elevator: railDepth,
    elevatorColumn: shaftCol,
  };
  const mine = createMine(9294, gear, STARTING_CONSUMABLES);
  for (let col = START_COL + 1; col <= shaftCol; col += 1) {
    setCell(mine, col, 0, { kind: "empty" });
  }
  for (let row = 1; row <= railDepth; row += 1) {
    setCell(mine, shaftCol, row, { kind: "empty" });
  }
  for (let row = 1; row <= 4; row += 1) {
    setCell(mine, START_COL, row, { kind: "empty", ladder: true });
  }
  for (let col = START_COL + 1; col < shaftCol; col += 1) {
    setCell(mine, col, 4, { kind: "empty" });
    setCell(mine, col, 5, { kind: "dirt" });
  }
  const baseDiff = exportDiff(mine);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: { activeSlot: 1, seed: 9294, tripIndex: 0, diff: baseDiff },
    });
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
      localStorage.setItem(
        "vibebots-mine-trip-v2-slot-1",
        JSON.stringify(trip),
      );
    },
    {
      seed: 9294,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff,
      moves: ["down", "down", "down", "down", "right", "right"],
    },
  );
  await installMineMotionProbe(page);

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(status).toHaveAttribute("data-depth", "4");
  await expect(canvas).toHaveAttribute("data-miner-x", "2.00");
  const energyBefore = await status.getAttribute("data-energy");

  await resetMineMotionProbe(page);
  await page.keyboard.press("ArrowRight");
  await expect(status).toHaveAttribute("data-elevator-stage", "calling");
  await expect(status).toHaveAttribute("data-depth", "4");
  await page.waitForTimeout(250);
  await expect(status).toHaveAttribute("data-depth", "4");
  await expect(canvas).toHaveAttribute("data-miner-x", "2.00");
  const callSamples = (await readMineMotionProbe(page)).filter(
    (sample) => sample.stage === "calling",
  );
  expect(callSamples.length).toBeGreaterThan(2);
  expect(
    motionRange(callSamples, (sample) => sample.carY),
    `car Y samples: ${motionValueSummary(callSamples, (sample) => sample.carY)}`,
  ).toBeGreaterThan(0.2);
  expect(
    motionRange(callSamples, (sample) => sample.minerY),
    `miner Y samples: ${motionValueSummary(callSamples, (sample) => sample.minerY)}`,
  ).toBeLessThan(0.05);
  expect(
    motionRange(callSamples, (sample) => sample.cameraY),
    `camera Y samples: ${motionValueSummary(callSamples, (sample) => sample.cameraY)}`,
  ).toBeLessThan(0.05);

  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await expect(status).toHaveAttribute("data-elevator-phase", "boarded");
  await expect(status).toHaveAttribute("data-depth", "4");
  await expect(canvas).toHaveAttribute("data-miner-x", "3.00");
  await expect(status).toHaveAttribute("data-energy", energyBefore ?? "");
  await expect(page.getByText(/fatal fall/i)).not.toBeVisible();
  const goTop = page.getByRole("button", { name: "Go to top" });
  await expect(goTop).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Go to bottom" }),
  ).toBeVisible();

  await page.keyboard.press("ArrowUp");
  await expect(status).toHaveAttribute("data-elevator-stage", "riding");
  await expect(canvas).toHaveAttribute("data-miner-y", "-0.08", {
    timeout: 10_000,
  });
  await expect(canvas).toHaveAttribute("data-cam-y", "-0.08", {
    timeout: 10_000,
  });
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(canvas).toHaveAttribute("data-miner-x", "3.00");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("button", { name: "Go to bottom" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to top" })).toHaveCount(0);
});

test("a restored downward elevator ride continues to the bottom", async ({
  page,
}) => {
  const railDepth = 32;
  const gear = {
    ...DEFAULT_GEAR,
    elevator: railDepth,
    elevatorColumn: START_COL,
  };
  const mine = createMine(9295, gear, STARTING_CONSUMABLES);
  for (let row = 1; row <= railDepth; row += 1) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  const baseDiff = exportDiff(mine);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: { activeSlot: 1, seed: 9295, tripIndex: 0, diff: baseDiff },
    });
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
      localStorage.setItem(
        "vibebots-mine-trip-v2-slot-1",
        JSON.stringify(trip),
      );
    },
    {
      seed: 9295,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff,
      moves: ["down", "ride-down"],
    },
  );
  await installMineMotionProbe(page);

  await page.goto("/mine");
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(status).toHaveAttribute("data-elevator-stage", "riding", {
    timeout: 10_000,
  });
  await expect(status).toHaveAttribute("data-elevator-riding", "ride-down", {
    timeout: 10_000,
  });
  await dismissReleaseNotes(page);
  const resumedFrameA = await canvas.screenshot();
  await expect(status).toHaveAttribute("data-depth", String(railDepth), {
    timeout: 10_000,
  });
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-y")), {
      timeout: 10_000,
    })
    .toBeLessThan(-31.8);
  const resumedFrameB = await canvas.screenshot();
  const resumedSamples = (await readMineMotionProbe(page)).filter(
    (sample) => sample.riding === "ride-down",
  );
  expect(Buffer.compare(resumedFrameA, resumedFrameB)).not.toBe(0);
  expect(
    distinctMotionValues(resumedSamples, (sample) => sample.minerY),
  ).toBeGreaterThan(2);
  expect(
    distinctMotionValues(resumedSamples, (sample) => sample.cameraY),
  ).toBeGreaterThan(2);
  await expect(status).toHaveAttribute("data-elevator-riding", "");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Go to top" })).toBeVisible();
});

test("recall cancels an active elevator ride and its local timer", async ({
  page,
}) => {
  const railDepth = 120;
  const gear = {
    ...DEFAULT_GEAR,
    elevator: railDepth,
    elevatorColumn: START_COL,
    recall: 3,
  };
  const consumables = { ...STARTING_CONSUMABLES, rope: 1 };
  const mine = createMine(9299, gear, consumables);
  for (let row = 1; row <= railDepth; row += 1) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  const baseDiff = exportDiff(mine);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: { activeSlot: 1, seed: 9299, tripIndex: 0, diff: baseDiff },
    });
  });
  await page.route("**/api/gear", async (route) => {
    await route.fulfill({
      json: { gear, consumables, balance: 0 },
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
      seed: 9299,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables,
      baseDiff,
      moves: ["down"],
    },
  );

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Go to bottom" }).click();
  await expect(status).toHaveAttribute("data-elevator-stage", "riding");
  await expect(status).toHaveAttribute("data-elevator-phase", "riding-down");
  await expect
    .poll(async () => Number(await status.getAttribute("data-depth")))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Recovery options" }).click();
  await page.getByRole("menuitem", { name: "Recall (1, range 75)" }).click();

  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toHaveAttribute("data-elevator-phase", "idle");
  await expect(status).toHaveAttribute("data-elevator-stage", "idle");
  await expect(status).toHaveAttribute("data-elevator-riding", "");
  await expect(page.getByTestId("elevator-controls")).toHaveCount(0);
  await page.waitForTimeout(800);
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toHaveAttribute("data-elevator-phase", "idle");
  await expect(status).toHaveAttribute("data-elevator-stage", "idle");
});

test("a restored upward elevator ride continues to the surface", async ({
  page,
}) => {
  const railDepth = 20;
  const gear = {
    ...DEFAULT_GEAR,
    elevator: railDepth,
    elevatorColumn: START_COL,
  };
  const mine = createMine(9297, gear, STARTING_CONSUMABLES);
  for (let row = 1; row <= railDepth; row += 1) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  const baseDiff = exportDiff(mine);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: { activeSlot: 1, seed: 9297, tripIndex: 0, diff: baseDiff },
    });
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
      localStorage.setItem(
        "vibebots-mine-trip-v2-slot-1",
        JSON.stringify(trip),
      );
    },
    {
      seed: 9297,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff,
      moves: [
        "down",
        "ride-down",
        "ride-down",
        "ride-down",
        "ride-down",
        "ride-up",
      ],
    },
  );
  await installMineMotionProbe(page);

  await page.goto("/mine");
  const status = page.getByLabel("Mine status");
  const canvas = page.locator("canvas");
  await expect(status).toHaveAttribute("data-elevator-stage", "riding", {
    timeout: 10_000,
  });
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-elevator-riding", "ride-up", {
    timeout: 10_000,
  });
  const resumedFrameA = await canvas.screenshot();
  await expect(status).toHaveAttribute("data-depth", "0", {
    timeout: 10_000,
  });
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-miner-y")), {
      timeout: 10_000,
    })
    .toBeGreaterThan(-0.2);
  const resumedFrameB = await canvas.screenshot();
  const resumedSamples = (await readMineMotionProbe(page)).filter(
    (sample) => sample.riding === "ride-up",
  );
  expect(Buffer.compare(resumedFrameA, resumedFrameB)).not.toBe(0);
  expect(
    distinctMotionValues(resumedSamples, (sample) => sample.minerY),
  ).toBeGreaterThan(2);
  expect(
    distinctMotionValues(resumedSamples, (sample) => sample.cameraY),
  ).toBeGreaterThan(2);
  await expect(status).toHaveAttribute("data-elevator-riding", "");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("button", { name: "Go to bottom" }),
  ).toBeVisible();
});

test("a restored elevator arrival at the top banks its haul once", async ({
  page,
}) => {
  const railDepth = 6;
  const gear = {
    ...DEFAULT_GEAR,
    elevator: railDepth,
    elevatorColumn: START_COL,
  };
  const mine = createMine(9298, gear, STARTING_CONSUMABLES);
  for (let row = 1; row <= railDepth; row += 1) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  setCell(mine, START_COL, 3, {
    kind: "empty",
    drop: { coal: 2 },
  });
  const baseDiff = exportDiff(mine);
  await page.route("**/api/mine/world", async (route) => {
    await route.fulfill({
      json: { activeSlot: 1, seed: 9298, tripIndex: 0, diff: baseDiff },
    });
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
  let bankRequests = 0;
  let bankMoves: string[] = [];
  let releaseBank = () => {};
  const bankGate = new Promise<void>((resolve) => {
    releaseBank = resolve;
  });
  await page.route("**/api/mine/bank", async (route) => {
    bankRequests++;
    const body = route.request().postDataJSON() as { moves?: string[] };
    bankMoves = body.moves ?? [];
    await bankGate;
    await route.fulfill({
      json: {
        credited: {
          credits: 2,
          parts: [],
          milestoneBonus: 0,
          soldHaul: {
            ores: { coal: 2 },
            salvageCredits: 0,
            totalVibes: 2,
          },
        },
        balance: 2,
        tripIndex: 1,
        consumables: STARTING_CONSUMABLES,
      },
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
      seed: 9298,
      mineVersion: MINE_VERSION,
      tripIndex: 0,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff,
      moves: ["down", "ride-down", "ride-up"],
    },
  );

  await page.goto("/mine");
  const status = page.getByLabel("Mine status");
  await expect.poll(() => bankRequests, { timeout: 10_000 }).toBe(1);
  expect(bankMoves.at(-1)).toBe("ride-up");
  await dismissReleaseNotes(page);
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toHaveAttribute("data-elevator-riding", "");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  await expect(status).toHaveAttribute("data-depth", "0");
  await expect(status).toHaveAttribute("data-elevator-riding", "");
  await expect(status).toHaveAttribute("data-elevator-stage", "choosing");
  releaseBank();

  await expect(status).toHaveAttribute("data-wallet", "2", {
    timeout: 10_000,
  });
  await page.waitForTimeout(300);
  expect(bankRequests).toBe(1);
  await expect(status).toHaveAttribute("data-elevator-phase", "idle");
  await expect(status).toHaveAttribute("data-elevator-stage", "idle");
});

test("miner stays at depth when walking sideways (lateral teleport regression)", async ({
  page,
}) => {
  await routeStarterMineWorld(page, 9293, (mine) => {
    setCell(mine, START_COL, 1, { kind: "empty" });
    setCell(mine, START_COL, 2, { kind: "empty" });
    setCell(mine, START_COL - 1, 2, { kind: "empty" });
  });
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

  await digLateral(page, "ArrowLeft", -0.8);
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
