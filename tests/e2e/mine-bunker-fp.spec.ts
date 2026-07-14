import { expect, type Page, test } from "@playwright/test";
import { imagePixelDifferenceRatio } from "./support/image-pixels";
import {
  awaitMineSceneReady,
  createMine,
  DEFAULT_GEAR,
  digTo,
  dismissReleaseNotes,
  exportDiff,
  MINE_VERSION,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
  touchHold,
  touchHoldDrag,
} from "./support/mine-helpers";

/** Aims the fp camera through the one-shot test hook and waits for the
 * rig to consume it. */
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

/** First canvas click acquires (or proves unavailable) pointer lock and
 * is swallowed by design; later clicks act. Settles that handshake. */
async function armFpPointer(page: Page): Promise<void> {
  const canvas = page.locator("canvas");
  await canvas.click();
  await expect
    .poll(async () => canvas.getAttribute("data-fp-lock"), {
      timeout: 10_000,
    })
    .not.toBe("unlocked");
}

/** The banked-bunker view the walkable-viewer flow runs against: a
 * 7x5 claim around the miner's dig column with one placed wall. */
const FP_BUNKER_VIEW = {
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

test("first-person bunker viewer walks, looks, jumps, and exits in place", async ({
  page,
}) => {
  // Software-GL runners compile the fp scene slowly, and the test
  // decodes several full screenshots for the motion proof.
  test.setTimeout(180_000);
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FP_BUNKER_VIEW),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);

  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "0");
  const depthBefore = await status.getAttribute("data-depth");
  const distanceBefore = await status.getAttribute("data-horizontal-distance");
  const energyBefore = await status.getAttribute("data-energy");
  expect(depthBefore).toBe("1");
  await expect(
    page.getByRole("region", { name: "Dig controls" }),
  ).toBeVisible();

  // Enter from the floating button (the miner stands inside the claim).
  const enterButton = page.getByTestId("bunker-fp-enter");
  await expect(enterButton).toBeVisible();
  await enterButton.click();
  await expect(status).toHaveAttribute("data-fp-mode", "1");

  // The fp canvas replaces the 2D canvas and starts publishing the rig
  // probes once its compile gate opens.
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();
  // The 2D mine chrome yields the whole screen to the fp HUD: the
  // consumable belt (with its ladder chip and plank buttons), the zoom
  // cluster, and the settings gear all unmount while fp mode is on.
  await expect(page.getByRole("region", { name: "Dig controls" })).toHaveCount(
    0,
  );
  await expect(page.locator("[data-ladder-chip]")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Zoom controls" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Open settings" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Place plank left" }),
  ).toHaveCount(0);
  await expect
    .poll(async () => canvas.getAttribute("data-fp-grounded"), {
      timeout: 20_000,
    })
    .toBe("1");
  // Spawn: the miner's column maps to local x 3 on the tunnel plane,
  // feet on the floor (eye 0.22), facing -z into the rock.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")))
    .toBeCloseTo(3, 1);

  // Walk right (strafe +x): the eye must actually travel.
  await page.keyboard.down("d");
  const walkFrameA = await canvas.screenshot();
  await page.waitForTimeout(90);
  const walkFrameB = await canvas.screenshot();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(3.6);
  await page.keyboard.up("d");
  // Rule 10 motion proof: consecutive frames during the held walk show
  // different pixels, not just a moving diagnostic number.
  expect(
    await imagePixelDifferenceRatio(page, walkFrameA, walkFrameB),
  ).toBeGreaterThan(0.00005);

  // And back left.
  const xAfterRight = Number(await canvas.getAttribute("data-fp-eye-x"));
  await page.keyboard.down("a");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")), {
      timeout: 15_000,
    })
    .toBeLessThan(xAfterRight - 0.5);
  await page.keyboard.up("a");

  // Look: the one-shot test hook aims the camera; the rig consumes it
  // next frame and reports the yaw probe.
  await page.evaluate(() => {
    (window as unknown as { __vibebotsFp?: { setYaw?: number } }).__vibebotsFp =
      { setYaw: 1.57 };
  });
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-yaw")), {
      timeout: 10_000,
    })
    .toBeCloseTo(1.57, 1);

  // Jump: the eye rises past the walk height and lands grounded again.
  // Sample fast (the airborne window is about half a second) and
  // re-press periodically in case a loaded runner missed the arc.
  await page.keyboard.press("Space");
  let jumpSamples = 0;
  await expect
    .poll(
      async () => {
        jumpSamples += 1;
        if (jumpSamples % 20 === 0) await page.keyboard.press("Space");
        return Number(await canvas.getAttribute("data-fp-eye-y"));
      },
      { timeout: 20_000, intervals: [60] },
    )
    .toBeGreaterThan(0.7);
  await expect
    .poll(async () => canvas.getAttribute("data-fp-grounded"), {
      timeout: 10_000,
    })
    .toBe("1");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-y")))
    .toBeCloseTo(0.22, 1);

  // Exit restores the 2D mine exactly where the miner stood.
  await page.getByRole("button", { name: "Exit bunker" }).click();
  await expect(status).toHaveAttribute("data-fp-mode", "0");
  await awaitMineSceneReady(page);
  await expect
    .poll(async () => canvas.getAttribute("data-miner-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();
  await expect(status).toHaveAttribute("data-depth", depthBefore ?? "1");
  await expect(status).toHaveAttribute(
    "data-horizontal-distance",
    distanceBefore ?? "0",
  );
  await expect(status).toHaveAttribute("data-energy", energyBefore ?? "");
  await expect(page.getByTestId("bunker-fp-enter")).toBeVisible();
  // The suppressed 2D chrome returns with the flat view.
  await expect(
    page.getByRole("region", { name: "Dig controls" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Zoom controls" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
});

test("the bunker status panel's 3D row enters the banked bunker", async ({
  page,
}) => {
  // Software-GL runners compile the fp scene slowly.
  test.setTimeout(180_000);
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FP_BUNKER_VIEW),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);

  // The second Enter affordance: the row inside the bunker status
  // sheet (the toolbelt button is covered by the walk/look/jump test).
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const panelEnter = page.getByTestId("bunker-fp-enter-panel");
  await expect(panelEnter).toBeVisible();
  await panelEnter.click();

  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "1");
  // Entering closes the sheet so it cannot sit over the fp view.
  await expect(page.getByRole("region", { name: "Bunker status" })).toHaveCount(
    0,
  );
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();

  await page.getByRole("button", { name: "Exit bunker" }).click();
  await expect(status).toHaveAttribute("data-fp-mode", "0");
  await awaitMineSceneReady(page);
});

test("second Escape leaves the first-person view", async ({ page }) => {
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FP_BUNKER_VIEW),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await page.getByTestId("bunker-fp-enter").click();
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "1");
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();
  // Headless runs never hold pointer lock, so one Escape exits the
  // mode outright (in play, a locked pointer consumes the first).
  await page.keyboard.press("Escape");
  await expect(status).toHaveAttribute("data-fp-mode", "0");
  await awaitMineSceneReady(page);
});

test("the first-person entry hides while a failed raid blocks editing", async ({
  page,
}) => {
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...FP_BUNKER_VIEW,
        bunker: {
          ...FP_BUNKER_VIEW.bunker,
          core: { col: START_COL, row: 3, durability: 128 },
        },
        activeRaid: {
          raidId: "raid-fp-gate",
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
      }),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);

  // Editing is blocked after the failed raid: no toolbelt, no Enter
  // affordance anywhere, and the panel offers no 3D row either.
  await expect(
    page.getByRole("region", { name: "Bunker build tool" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("bunker-fp-enter")).toHaveCount(0);
  await page.getByRole("button", { name: "Open bunker status" }).click();
  const builder = page.getByRole("region", { name: "Bunker status" });
  await expect(builder).toContainText("Miner killed");
  await expect(page.getByTestId("bunker-fp-enter-panel")).toHaveCount(0);
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "0");
});

test("first-person building loop on a pending claim: place, pry, dig, walk in, move", async ({
  page,
}) => {
  // Software-GL runners compile the fp scene slowly, and this test
  // decodes several full screenshots for the motion proofs.
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
        player: FP_BUNKER_VIEW.player,
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
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-depth", "5");

  // Claim locally (the pending branch): the trip owns the bunker until
  // it banks at the surface.
  await page.getByRole("button", { name: "Start bunker claim" }).click();
  const claimSheet = page.getByRole("region", { name: "Bunker status" });
  await claimSheet.getByRole("button", { name: "Claim 7x5 bunker" }).click();
  await claimSheet.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("bunker-fp-enter").click();
  await expect(status).toHaveAttribute("data-fp-mode", "1");
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();

  // A fresh claim opens the whole tunnel plane except the core cell.
  await expect
    .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
      timeout: 20_000,
    })
    .toBe("34");

  // Spawn faces -z: interior claim rock dead ahead, own cell as place.
  await expect
    .poll(async () => canvas.getAttribute("data-fp-target"), {
      timeout: 20_000,
    })
    .toBe("3:0:1:rock-diggable");
  // The only open cell the ray crossed is the player's own, which the
  // capsule guard rejects: no valid placement while facing the rock.
  await expect(canvas).toHaveAttribute("data-fp-place", "none");
  await expect(page.locator(".bunker-fp-target-label")).toHaveText(
    "Claim rock (diggable)",
  );

  // Select the wall from the hotbar (before any canvas click so the
  // pointer-lock handshake cannot swallow the tap).
  const wallSlot = page.getByTestId("bunker-fp-slot-wall-panel");
  const wallCountBefore = await wallSlot.getAttribute("aria-label");
  expect(wallCountBefore).toMatch(/^Wall x\d+$/);
  const wallCount = Number((wallCountBefore ?? "").replace("Wall x", ""));
  expect(wallCount).toBeGreaterThan(0);
  await wallSlot.click();
  await expect(wallSlot).toHaveAttribute("aria-pressed", "true");

  // Aim down-left: the ray crosses the open cell (2,0,0) and lands on
  // the floor boundary, so the crossed cell becomes the place cell.
  await aimFp(page, 1.57, -0.62);
  await expect
    .poll(async () => canvas.getAttribute("data-fp-place"), {
      timeout: 10_000,
    })
    .toBe("2:0:0");
  await expect(canvas).toHaveAttribute("data-fp-target", "2:-1:0:rock");

  await armFpPointer(page);
  const beforePlace = await canvas.screenshot();
  await canvas.click();

  // The wall lands in the place cell: count drops, the grid closes the
  // cell, and the crosshair now sees the part it placed.
  await expect(wallSlot).toHaveAttribute(
    "aria-label",
    `Wall x${wallCount - 1}`,
    { timeout: 10_000 },
  );
  await expect
    .poll(async () => canvas.getAttribute("data-fp-target"), {
      timeout: 10_000,
    })
    .toBe("2:0:0:part");
  await expect(canvas).toHaveAttribute("data-fp-open-cells", "33");
  await expect(page.locator(".bunker-fp-target-label")).toHaveText(
    "Wall 90/90",
  );
  const afterPlace = await canvas.screenshot();
  expect(
    await imagePixelDifferenceRatio(page, beforePlace, afterPlace),
  ).toBeGreaterThan(0.00005);
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

  // Right-click quick pry lifts the wall into the carry.
  await canvas.click({ button: "right" });
  const carried = page.locator(".bunker-fp-carried");
  await expect(carried).toBeVisible({ timeout: 10_000 });
  await expect(carried).toContainText("Wall");

  // The pick digs the rock straight ahead; the room gains a cell.
  await page.keyboard.press("0");
  await expect(page.getByTestId("bunker-fp-pick")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await aimFp(page, 0, 0);
  await expect
    .poll(async () => canvas.getAttribute("data-fp-target"), {
      timeout: 10_000,
    })
    .toBe("3:0:1:rock-diggable");
  const beforeDig = await canvas.screenshot();
  await canvas.click();
  await expect
    .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
      timeout: 10_000,
    })
    .toBe("34");
  const afterDig = await canvas.screenshot();
  expect(
    await imagePixelDifferenceRatio(page, beforeDig, afterDig),
  ).toBeGreaterThan(0.00005);
  const dugCells = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}")
        .pendingBunker?.bunker.dug,
  );
  expect(dugCells).toEqual([{ col: START_COL, row: 5, depth: 1 }]);

  // Walk INTO the newly dug cell, then back out to the tunnel plane.
  await page.keyboard.down("w");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-z")), {
      timeout: 15_000,
    })
    .toBeLessThan(-0.5);
  await page.keyboard.up("w");
  await page.keyboard.down("s");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-fp-eye-z")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(-0.05);
  await page.keyboard.up("s");

  // Re-arm build mode; placing while carrying MOVES the carried wall
  // into the dug cell (no extra stock consumed).
  await page.keyboard.press("1");
  await expect(wallSlot).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-place"), {
      timeout: 10_000,
    })
    .toBe("3:0:1");
  const beforeMove = await canvas.screenshot();
  await canvas.click();
  await expect(carried).toHaveCount(0, { timeout: 10_000 });
  await expect
    .poll(async () => canvas.getAttribute("data-fp-target"), {
      timeout: 10_000,
    })
    .toBe("3:0:1:part");
  await expect(wallSlot).toHaveAttribute(
    "aria-label",
    `Wall x${wallCount - 1}`,
  );
  const afterMove = await canvas.screenshot();
  expect(
    await imagePixelDifferenceRatio(page, beforeMove, afterMove),
  ).toBeGreaterThan(0.00005);
  const movedPart = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
    ).pendingBunker?.bunker.parts.at(-1),
  );
  expect(movedPart).toMatchObject({
    partId: "wall-panel",
    col: START_COL,
    row: 5,
    depth: 1,
  });
});

test.describe("phone viewport", () => {
  test.use({
    viewport: { width: 390, height: 760 },
    hasTouch: true,
    isMobile: true,
  });

  test("touch walking auto-jumps a one-block step and ships no jump button", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "uses CDP touch events");
    // Software-GL phone runs compile the fp scene slowly.
    test.setTimeout(240_000);
    // A three-block plateau on the room floor to the spawn's right, and
    // the core moved off the spawn column so its cell cannot trip the
    // auto-jump headroom guard. Climbing the first face proves the hop;
    // the plateau keeps the mover grounded on top for stable asserts.
    const stepView = {
      ...FP_BUNKER_VIEW,
      bunker: {
        footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
        core: { col: START_COL - 2, row: 3, durability: 160 },
        parts: [1, 2, 3].map((offset) => ({
          partId: "wall-panel",
          col: START_COL + offset,
          row: 5,
          durability: 90,
        })),
      },
    };
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(stepView),
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await digTo(page, 1);

    await page.getByTestId("bunker-fp-enter").click();
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();
    await expect
      .poll(async () => canvas.getAttribute("data-fp-grounded"), {
        timeout: 20_000,
      })
      .toBe("1");

    // F-094: the touch HUD ships move/look zones but no jump button.
    await expect(page.locator(".bunker-fp-move-zone")).toBeVisible();
    await expect(page.locator(".bunker-fp-look-zone")).toBeVisible();
    await expect(page.locator(".bunker-fp-jump")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Jump" })).toHaveCount(0);

    // Hold the joystick toward the step (strafe right at spawn yaw).
    // No jump input of any kind: the climb is the auto-jump.
    const releaseStick = await touchHoldDrag(
      page,
      { x: 90, y: 420 },
      { x: 150, y: 420 },
    );
    try {
      await expect
        .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")), {
          timeout: 20_000,
          intervals: [60],
        })
        .toBeGreaterThan(3.1);
      // The eye rises past the walk height mid-hop...
      await expect
        .poll(async () => Number(await canvas.getAttribute("data-fp-eye-y")), {
          timeout: 20_000,
          intervals: [60],
        })
        .toBeGreaterThan(0.7);
      // ...and settles grounded on TOP of the block (feet 0.5, eye 1.22).
      await expect
        .poll(async () => canvas.getAttribute("data-fp-grounded"), {
          timeout: 20_000,
          intervals: [60],
        })
        .toBe("1");
      await expect
        .poll(async () => Number(await canvas.getAttribute("data-fp-eye-y")))
        .toBeCloseTo(1.22, 1);
      expect(
        Number(await canvas.getAttribute("data-fp-eye-x")),
      ).toBeGreaterThan(3.4);
    } finally {
      await releaseStick();
    }
  });

  test("a long still press on the look zone quick-pries the crosshair part", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "uses CDP touch events");
    // Software-GL phone runs compile the fp scene slowly.
    test.setTimeout(240_000);
    // A wall two cells right of spawn: the ray crosses an open cell on
    // the way, so a stray tap act after the hold would visibly MOVE the
    // pried part there (the suppression this test exists to pin).
    const pryView = {
      ...FP_BUNKER_VIEW,
      bunker: {
        ...FP_BUNKER_VIEW.bunker,
        parts: [
          {
            partId: "wall-panel",
            col: START_COL + 2,
            row: 5,
            durability: 90,
          },
        ],
      },
    };
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(pryView),
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await digTo(page, 1);
    await page.getByTestId("bunker-fp-enter").click();
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();

    // Face the wall (local 5,0,0) across the open cell (4,0,0). The
    // tool stays the default build: the long press pries regardless.
    await aimFp(page, -1.57, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 20_000,
      })
      .toBe("5:0:0:part");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .toBe("4:0:0");

    // A still press on the look zone held past the hold window (450ms).
    await touchHold(page, { x: 300, y: 350 }, 700);
    const carried = page.locator(".bunker-fp-carried");
    await expect(carried).toBeVisible({ timeout: 10_000 });
    await expect(carried).toContainText("Wall");

    // Releasing the hold must NOT also fire the tap act: with build
    // armed and a valid place cell, a stray act would move the carried
    // wall into (4,0,0) and clear the chip. Both stay put.
    await page.waitForTimeout(400);
    await expect(carried).toBeVisible();
    await expect(canvas).toHaveAttribute("data-fp-target", "5:0:0:part");
  });

  test("the phone hotbar keeps every slot and the pry chip inside the viewport", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FP_BUNKER_VIEW),
      });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await digTo(page, 1);
    await page.getByTestId("bunker-fp-enter").click();
    await expect(page.getByLabel("Mine status")).toHaveAttribute(
      "data-fp-mode",
      "1",
    );

    // Pick, the six part slots, and the pry toggle: all rendered, all
    // fully inside the 390px viewport (no horizontal clipping).
    const slotTestIds = [
      "bunker-fp-pick",
      ...Object.keys(FP_BUNKER_VIEW.inventory).map(
        (partId) => `bunker-fp-slot-${partId}`,
      ),
      "bunker-fp-pry",
    ];
    const viewportWidth = page.viewportSize()?.width ?? 390;
    for (const testId of slotTestIds) {
      const slot = page.getByTestId(testId);
      await expect(slot).toBeVisible();
      const box = await slot.boundingBox();
      expect(box, `${testId} should have a layout box`).not.toBeNull();
      if (!box) continue;
      expect(box.x, `${testId} left edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${testId} right edge`).toBeLessThanOrEqual(
        viewportWidth,
      );
    }
  });
});

test("first-person dig and place round-trip the banked bunker APIs with depth", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const dugView = {
    ...FP_BUNKER_VIEW,
    bunker: {
      ...FP_BUNKER_VIEW.bunker,
      dug: [{ col: START_COL, row: 5, depth: 1 }],
    },
  };
  const placedView = {
    ...dugView,
    bunker: {
      ...dugView.bunker,
      parts: [
        ...FP_BUNKER_VIEW.bunker.parts,
        {
          partId: "wall-panel",
          col: START_COL,
          row: 5,
          depth: 1,
          durability: 90,
        },
      ],
    },
    inventory: { ...FP_BUNKER_VIEW.inventory, "wall-panel": 5 },
  };
  const excavateBodies: unknown[] = [];
  const placeBodies: unknown[] = [];
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FP_BUNKER_VIEW),
    });
  });
  await page.route("**/api/bunker/excavate", async (route) => {
    excavateBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dugView),
    });
  });
  await page.route("**/api/bunker/parts/place", async (route) => {
    placeBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(placedView),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await page.getByTestId("bunker-fp-enter").click();
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "1");
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();
  // 35 tunnel-plane cells minus the core and the fixture's wall.
  await expect
    .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
      timeout: 20_000,
    })
    .toBe("33");

  // Dig the rock straight ahead through the banked excavate API.
  await page.keyboard.press("0");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-target"), {
      timeout: 20_000,
    })
    .toBe("3:0:1:rock-diggable");
  await armFpPointer(page);
  await canvas.click();
  await expect
    .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
      timeout: 10_000,
    })
    .toBe("34");
  expect(excavateBodies).toEqual([{ col: START_COL, row: 5, depth: 1 }]);

  // Place a wall into the dug cell through the banked place API.
  await page.keyboard.press("1");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-place"), {
      timeout: 10_000,
    })
    .toBe("3:0:1");
  await canvas.click();
  await expect
    .poll(async () => canvas.getAttribute("data-fp-target"), {
      timeout: 10_000,
    })
    .toBe("3:0:1:part");
  expect(placeBodies).toEqual([
    { partId: "wall-panel", col: START_COL, row: 5, depth: 1 },
  ]);
  await expect(page.getByTestId("bunker-fp-slot-wall-panel")).toHaveAttribute(
    "aria-label",
    "Wall x5",
  );
});

test("an enclosed spawn shows the boxed-in escape hint until a part is pried", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Walls on both open lateral neighbors of the spawn cell (local
  // (3,0,0): +z is undug rock, -z is boundary rock), the sealed
  // legacy-base scenario the hint exists for.
  const boxedView = {
    ...FP_BUNKER_VIEW,
    bunker: {
      ...FP_BUNKER_VIEW.bunker,
      parts: [
        { partId: "wall-panel", col: START_COL - 1, row: 5, durability: 90 },
        { partId: "wall-panel", col: START_COL + 1, row: 5, durability: 90 },
      ],
    },
  };
  await page.route("**/api/bunker", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(boxedView),
    });
  });

  await page.goto("/mine");
  await dismissReleaseNotes(page);
  await digTo(page, 1);
  await page.getByTestId("bunker-fp-enter").click();
  const status = page.getByLabel("Mine status");
  await expect(status).toHaveAttribute("data-fp-mode", "1");
  const canvas = page.locator("canvas");
  await expect
    .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
      timeout: 45_000,
    })
    .not.toBeNull();

  const hint = page.getByTestId("bunker-fp-boxed-hint");
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await expect(hint).toContainText("Boxed in?");

  // Prying a wall is the escape in progress: the hint stands down
  // while the part is in hand.
  await aimFp(page, -1.57, 0);
  await expect
    .poll(async () => canvas.getAttribute("data-fp-target"), {
      timeout: 20_000,
    })
    .toBe("4:0:0:part");
  await armFpPointer(page);
  await canvas.click({ button: "right" });
  const carried = page.locator(".bunker-fp-carried");
  await expect(carried).toBeVisible({ timeout: 10_000 });
  await expect(hint).toHaveCount(0);

  // Putting it back re-encloses the player, so the hint returns; a
  // tap dismisses it until the next enclosure.
  await page.getByRole("button", { name: "Put back" }).click();
  await expect(carried).toHaveCount(0);
  await expect(hint).toBeVisible({ timeout: 10_000 });
  await hint.click();
  await expect(hint).toHaveCount(0);
});
