import { expect, test } from "@playwright/test";
import {
  createMine,
  DEFAULT_GEAR,
  digLateral,
  digTo,
  dismissReleaseNotes,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  exportDiff,
  MINE_VERSION,
  openStall,
  pressMineKey,
  routeStarterMineWorld,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "./support/mine-helpers";

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

test("the elevator sells rail and gates rides on it (REQ-028)", async ({
  page,
}) => {
  await routeStarterMineWorld(page, 9291, (mine) => {
    for (let col = START_COL - 1; col >= ELEVATOR_COL; col -= 1) {
      setCell(mine, col, 0, { kind: "empty" });
    }
  });
  await page.goto("/mine");
  await dismissReleaseNotes(page);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "0");

  const elevator = await openStall(page, "Elevator", "ArrowLeft");
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
  for (let col = START_COL - 1; col >= ELEVATOR_COL; col -= 1) {
    setCell(mine, col, 0, { kind: "empty" });
  }
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

  await digLateral(page, "ArrowLeft", ELEVATOR_COL + 0.1);
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
