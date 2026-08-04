import { expect, type Page, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";
import {
  imagePixelDifferenceRatio,
  imageRegionWarmNeutralFractions,
} from "./support/image-pixels";
import {
  aimFp,
  armFpPointer,
  awaitMineSceneReady,
  bypassMineRenderer,
  createMine,
  DEFAULT_GEAR,
  digTo,
  dismissReleaseNotes,
  exportDiff,
  holdFpDigUntil,
  MINE_VERSION,
  openSettingsFor,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
  touchHold,
  touchHoldDrag,
} from "./support/mine-helpers";

/** Every depth-0 floor cell of the 7x5 claim: a bunker whose whole
 * floor plane has been dug out. A fresh claim now opens only the small
 * spawn pocket (F-115); these banked-bunker flows exercise a built-out
 * room, so the fixture ships the floor plane already excavated (a real
 * dug-out state). Digging the pocket open is covered by the
 * pending-claim building tests. */
const FP_PLANE_DUG = (() => {
  const cells: Array<{ col: number; row: number; depth: number }> = [];
  for (let row = 1; row <= 5; row++) {
    for (let col = START_COL - 3; col <= START_COL + 3; col++) {
      cells.push({ col, row, depth: 0 });
    }
  }
  return cells;
})();

/** The banked-bunker view the walkable-viewer flow runs against: a
 * 7x5 claim around the miner's dig column with one placed wall, its
 * floor plane dug out (see FP_PLANE_DUG). */
const FP_BUNKER_VIEW = {
  bunker: {
    footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
    layoutVersion: 1,
    dug: FP_PLANE_DUG,
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
  // Banked edits echo this as expectedRevision (F-122).
  revision: 0,
};

/** Turn the opt-in deep collector on before the app boots (F-054). */
function enablePerfAnalyzer() {
  window.localStorage.setItem("vibebots-perf-analyzer-v1", "on");
}

/** Shrink both telemetry cadences so a test sees several windows in
 * seconds. The one-hour min-send interval is left at its default on
 * purpose: it is exactly what proves the compact throttle is scoped per
 * source (a recent mine sample must not suppress the first bunker-fp
 * sample). */
function speedUpPerf() {
  const w = window as typeof window & Record<string, number>;
  w.__vibebotsPerfTraceSnapshotMs = 1_500;
  w.__vibebotsPerfTraceFlushMs = 2_500;
  w.__vibebotsPerfInitialDelayMs = 500;
  w.__vibebotsPerfSampleMs = 2_000;
  w.__vibebotsPerfRepeatMs = 1_500;
}

interface PerfPayload {
  source?: string;
  snapshots?: Array<{
    probe?: { backend?: string; meshCount?: number } | null;
  }>;
}

const bySource = (list: PerfPayload[], source: string): PerfPayload[] =>
  list.filter((payload) => payload.source === source);

test(
  "performance telemetry attributes samples to the active surface (F-100)",
  ciCase("E2E-MINE-BUNKER-FP-0001", "@render"),
  async ({ page }) => {
    // Enters and exits fp, each a slow software-GL scene compile, and
    // waits out several telemetry windows on both surfaces.
    test.setTimeout(300_000);

    const compact: PerfPayload[] = [];
    const deep: PerfPayload[] = [];
    await page.route("**/api/performance", async (route) => {
      compact.push(route.request().postDataJSON() as PerfPayload);
      await route.fulfill({ json: { saved: true } });
    });
    await page.route("**/api/performance/trace", async (route) => {
      deep.push(route.request().postDataJSON() as PerfPayload);
      await route.fulfill({ json: { saved: 1 } });
    });
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FP_BUNKER_VIEW),
      });
    });
    await page.addInitScript(enablePerfAnalyzer);
    await page.addInitScript(speedUpPerf);

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await digTo(page, 1);

    // In the flat mine, both collectors label their payloads "mine", and
    // no bunker sample can exist before the fp canvas ever mounts.
    await expect
      .poll(() => bySource(compact, "mine").length, { timeout: 40_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() => bySource(deep, "mine").length, { timeout: 40_000 })
      .toBeGreaterThan(0);
    const mineDeep = bySource(deep, "mine").at(-1);
    expect(mineDeep?.snapshots?.find((snap) => snap.probe)?.probe).toBeTruthy();
    expect(bySource(compact, "bunker-fp")).toHaveLength(0);
    expect(bySource(deep, "bunker-fp")).toHaveLength(0);

    // Enter the first-person bunker: the fp canvas swaps in.
    await page.getByTestId("bunker-fp-enter").click();
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();

    // The deep collector now reads the registered bunker probe and labels
    // the batch bunker-fp: a non-null probe over the bunker scene.
    await expect
      .poll(() => bySource(deep, "bunker-fp").length, { timeout: 60_000 })
      .toBeGreaterThan(0);
    const bunkerDeep = bySource(deep, "bunker-fp").at(-1);
    const probe = bunkerDeep?.snapshots?.find((snap) => snap.probe)?.probe;
    expect(probe).toBeTruthy();
    expect(probe?.backend === "webgpu" || probe?.backend === "webgl2").toBe(
      true,
    );
    expect(probe?.meshCount ?? 0).toBeGreaterThan(0);

    // The compact throttle is scoped per source: a mine sample fired
    // moments ago (default one-hour interval), yet the bunker-fp sample
    // still sends because it tracks its own last-sent timestamp.
    await expect
      .poll(() => bySource(compact, "bunker-fp").length, { timeout: 40_000 })
      .toBeGreaterThan(0);

    // No mixed-surface window: once the fp batches flow, the mine
    // collector has stopped, so no later batch straddles the boundary.
    const mineDeepAfterEntry = bySource(deep, "mine").length;
    await page.waitForTimeout(4_000);
    expect(bySource(deep, "mine").length).toBe(mineDeepAfterEntry);

    // Exit restores mine attribution: the deep collector resumes labeling
    // batches mine (it carries no per-source hour throttle).
    const mineDeepAtExit = bySource(deep, "mine").length;
    await page.getByRole("button", { name: "Exit bunker" }).click();
    await expect(status).toHaveAttribute("data-fp-mode", "0");
    await awaitMineSceneReady(page);
    await expect
      .poll(() => bySource(deep, "mine").length, { timeout: 60_000 })
      .toBeGreaterThan(mineDeepAtExit);
  },
);

test(
  "first-person bunker viewer walks, looks, jumps, and exits in place",
  ciCase("E2E-MINE-BUNKER-FP-0002", "@render"),
  async ({ page }) => {
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
    const distanceBefore = await status.getAttribute(
      "data-horizontal-distance",
    );
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
    // consumable belt (with its plank buttons), the zoom cluster, and the
    // settings gear all unmount while fp mode is on. The status section
    // stays mounted because it carries the data attributes this spec
    // reads, so it hides rather than unmounting, and the ladder readout
    // hides with it now that it lives on the readiness gauge.
    await expect(
      page.getByRole("region", { name: "Dig controls" }),
    ).toHaveCount(0);
    await expect(status).not.toBeVisible();
    await expect(page.locator("[data-ladder-chip]")).not.toBeVisible();
    await expect(
      page.getByRole("region", { name: "Zoom controls" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open settings" }),
    ).toHaveCount(0);
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
      (
        window as unknown as { __vibebotsFp?: { setYaw?: number } }
      ).__vibebotsFp = { setYaw: 1.57 };
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
  },
);

test(
  "one bunker button at a time: Enter replaces the trigger and Upkeep overlays first person",
  ciCase("E2E-MINE-BUNKER-FP-0003", "@functional"),
  async ({ page }) => {
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

    // Standing inside the editable claim, the floating Enter bunker pill
    // is the ONLY bunker button: the collapsed status trigger yields its
    // slot (F-119 fold), so the pair can never stack over the HUD.
    const enter = page.getByTestId("bunker-fp-enter");
    await expect(enter).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open bunker upkeep" }),
    ).toHaveCount(0);
    await enter.click();

    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();

    // The Upkeep button opens the sheet as an overlay over the live fp
    // canvas: the view never leaves first person, and the passive status
    // chips (vibes, level) sit on the HUD outside the sheet.
    await expect(page.getByLabel("Bunker player status")).toBeVisible();
    await page.getByTestId("bunker-fp-status").click();
    await expect(
      page.getByRole("region", { name: "Bunker upkeep" }),
    ).toBeVisible();
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    await page.getByRole("button", { name: "Dismiss bunker upkeep" }).click();
    await expect(
      page.getByRole("region", { name: "Bunker upkeep" }),
    ).toHaveCount(0);
    await expect(status).toHaveAttribute("data-fp-mode", "1");

    // Exit returns to the flat view, where the Enter pill is still the
    // only bunker button.
    await page.getByRole("button", { name: "Exit bunker" }).click();
    await expect(status).toHaveAttribute("data-fp-mode", "0");
    await expect(enter).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open bunker upkeep" }),
    ).toHaveCount(0);
    await awaitMineSceneReady(page);
  },
);

test(
  "the first-person bag chip opens the cargo bag and Escape returns to the view",
  ciCase("E2E-MINE-BUNKER-FP-0004", "@functional"),
  async ({ page }) => {
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

    await page.getByTestId("bunker-fp-enter").click();
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();

    // The bag chip rides in the first-person HUD and opens the same cargo bag.
    const bagChip = page.getByTestId("bunker-fp-bag");
    await expect(bagChip).toBeVisible();
    await expect(bagChip).toHaveAttribute("aria-expanded", "false");
    await bagChip.click();
    const bagPanel = page.locator("#mine-bag-panel");
    await expect(bagPanel).toBeVisible();
    await expect(bagChip).toHaveAttribute("aria-expanded", "true");

    // Escape closes the bag and stays in first person (does not exit the view).
    await page.keyboard.press("Escape");
    await expect(bagPanel).toHaveCount(0);
    await expect(status).toHaveAttribute("data-fp-mode", "1");

    await page.getByRole("button", { name: "Exit bunker" }).click();
    await expect(status).toHaveAttribute("data-fp-mode", "0");
    await awaitMineSceneReady(page);
  },
);

test(
  "second Escape leaves the first-person view",
  ciCase("E2E-MINE-BUNKER-FP-0005", "@functional"),
  async ({ page }) => {
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
  },
);

test(
  "first-person building loop on a pending claim: place, chained pry refunds, dig, place from stock",
  ciCase("E2E-MINE-BUNKER-FP-0006", "@render"),
  async ({ page }) => {
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
    const claimSheet = page.getByRole("region", { name: "Bunker upkeep" });
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

    // A fresh claim opens only the pre-mined spawn pocket (3x3x3 = 27
    // walkable cells now that F-118 freed the former core cell); the rest
    // of the volume is solid claim rock (F-115).
    await expect
      .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
        timeout: 20_000,
      })
      .toBe("27");

    // Spawn faces -z: the ray crosses the open pocket cells (3,0,1) and
    // (3,0,2) and lands on the first claim rock behind them at depth 3.
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 20_000,
      })
      .toBe("3:0:3:rock-diggable");
    // The place probe reads a cell only while a build part is armed; entry
    // arms the pick, so it reports none here (the wall selection below
    // flips it to the deepest crossed pocket cell).
    await expect(canvas).toHaveAttribute("data-fp-place", "none");
    await expect(page.locator(".bunker-fp-target-label")).toHaveText(
      "Claim rock (diggable)",
    );

    // Entry arms the pick, not the build ghost: digging out a fresh claim
    // is the first move, so Pick is pressed and no part slot is.
    await expect(page.getByTestId("bunker-fp-pick")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("bunker-fp-slot-wall-panel")).toHaveAttribute(
      "aria-pressed",
      "false",
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

    // Full-cell retirement (F-117, Q-026): a wall aimed at a floor/roof face
    // has no slot, so it is no longer placeable there. Aiming down, the ghost
    // and place cell go away instead of dropping in a whole-cell block.
    await aimFp(page, 1.57, -0.62);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .toBe("none");

    // Aim forward: the ray crosses the open pocket cells and lands on the
    // rock behind, so the wall builds on the deepest crossed cell's +depth
    // face (a canonical wall slot stored at that cell).
    await aimFp(page, 0, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .toBe("3:0:2");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-slot"), {
        timeout: 10_000,
      })
      .toBe("wall-pz");

    await armFpPointer(page);
    const beforePlace = await canvas.screenshot();
    await canvas.click();

    // The wall lands on its slot without filling the cell. The crosshair
    // sees the thin boundary plane while the room keeps all 27 open cells.
    await expect(wallSlot).toHaveAttribute(
      "aria-label",
      `Wall x${wallCount - 1}`,
      { timeout: 10_000 },
    );
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toBe("3:0:2:part");
    await expect(canvas).toHaveAttribute("data-fp-open-cells", "27");
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
      slot: "wall-pz",
    });

    // Add a floor to the exact same cell. Slot-aware targeting keeps the
    // wall independently addressable while the floor becomes a walkable
    // slab instead of rejecting the whole cell as occupied.
    const floorSlot = page.getByTestId("bunker-fp-slot-floor-panel");
    const floorCountBefore = await floorSlot.getAttribute("aria-label");
    const floorCount = Number((floorCountBefore ?? "").replace("Floor x", ""));
    await floorSlot.click();
    await expect(floorSlot).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .toBe("3:0:2");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-slot"), {
        timeout: 10_000,
      })
      .toBe("floor");
    await canvas.click();
    await expect(floorSlot).toHaveAttribute(
      "aria-label",
      `Floor x${floorCount - 1}`,
      { timeout: 10_000 },
    );
    await expect(canvas).toHaveAttribute("data-fp-open-cells", "26");
    const stackedParts = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}")
          .pendingBunker?.bunker.parts,
    );
    expect(stackedParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partId: "wall-panel",
          col: START_COL,
          row: 5,
          depth: 2,
          slot: "wall-pz",
        }),
        expect.objectContaining({
          partId: "floor-panel",
          col: START_COL,
          row: 5,
          depth: 2,
          slot: "floor",
        }),
      ]),
    );
    await wallSlot.click();
    await expect(wallSlot).toHaveAttribute("aria-pressed", "true");

    // Auto-stow prying (F-099) has no carry state: the chip's selector
    // matches nothing at any point in this loop.
    const carried = page.locator(".bunker-fp-carried");
    await expect(carried).toHaveCount(0);

    // Place the second wall level-right on the +x face of (4,0,0): stock
    // empties.
    await aimFp(page, -1.57, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .toBe("4:0:0");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-slot"), {
        timeout: 10_000,
      })
      .toBe("wall-px");
    await canvas.click();
    await expect(wallSlot).toHaveAttribute(
      "aria-label",
      `Wall x${wallCount - 2}`,
      { timeout: 10_000 },
    );
    await expect(canvas).toHaveAttribute("data-fp-open-cells", "26");

    // Right-click pry refunds the wall straight to the pack: the count
    // rises, the mesh disappears, and no carried chip ever shows.
    await aimFp(page, -1.57, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toBe("4:0:0:part");
    const beforePry = await canvas.screenshot();
    await canvas.click({ button: "right" });
    await expect(wallSlot).toHaveAttribute(
      "aria-label",
      `Wall x${wallCount - 1}`,
      { timeout: 10_000 },
    );
    await expect(carried).toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-fp-open-cells", "26");
    const afterPry = await canvas.screenshot();
    expect(
      await imagePixelDifferenceRatio(page, beforePry, afterPry),
    ).toBeGreaterThan(0.00005);

    // Chain the second pry immediately: no stow step in between, both
    // refunds land, and the pack holds the full starting stock again.
    await aimFp(page, 0, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toBe("3:0:2:part");
    await canvas.click({ button: "right" });
    await expect(wallSlot).toHaveAttribute("aria-label", `Wall x${wallCount}`, {
      timeout: 10_000,
    });
    await expect(carried).toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-fp-open-cells", "26");
    const afterPries = await page.evaluate(() => {
      const trip = JSON.parse(
        localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
      );
      return {
        parts: trip.pendingBunker?.bunker.parts,
        wallStock: trip.pendingBunker?.inventory?.["wall-panel"],
      };
    });
    expect(afterPries.parts).toEqual([
      expect.objectContaining({
        partId: "floor-panel",
        col: START_COL,
        row: 5,
        depth: 2,
        slot: "floor",
      }),
    ]);
    expect(afterPries.wallStock).toBe(wallCount);

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
      .toBe("3:0:3:rock-diggable");
    const beforeDig = await canvas.screenshot();
    // Multi-hit digging (surface parity): one swing cracks the block but
    // does not break it. The single click lands exactly one strike; the
    // cell stays solid and the hit counter reads 1 of a multi-hit
    // requirement.
    await canvas.click();
    await expect
      .poll(async () => canvas.getAttribute("data-fp-dig-hits"), {
        timeout: 10_000,
      })
      .toBe("1");
    expect(
      Number(await canvas.getAttribute("data-fp-dig-required")),
    ).toBeGreaterThan(1);
    await expect(canvas).toHaveAttribute("data-fp-open-cells", "26");
    // Holding the press swings until the block's hit requirement is met
    // and the room gains the cell.
    await holdFpDigUntil(page, 27);
    const afterDig = await canvas.screenshot();
    expect(
      await imagePixelDifferenceRatio(page, beforeDig, afterDig),
    ).toBeGreaterThan(0.00005);
    const dugCells = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}")
          .pendingBunker?.bunker.dug,
    );
    // The spawn pocket already opens depths 0-2 in the miner's column, so
    // the first dig straight ahead lands on the depth-3 rock behind it.
    expect(dugCells).toContainEqual({ col: START_COL, row: 5, depth: 3 });

    // Step forward into the room so the working face behind the freshly
    // dug depth-3 cell stays within a level ray's reach: the 3-deep pocket
    // puts it past reach from the very front. Momentum settles the miner a
    // step in, where the placement below lands.
    await page.keyboard.down("w");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-fp-eye-z")), {
        timeout: 15_000,
      })
      .toBeLessThan(-0.8);
    await page.keyboard.up("w");

    // Re-arm build mode; relocation is now pry then place, so this
    // placement into the freshly dug depth-3 cell (the last open cell the
    // level ray crosses) spends from the refunded stock.
    await page.keyboard.press("1");
    await expect(wallSlot).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .toBe("3:0:3");
    await canvas.click();
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toBe("3:0:3:part");
    await expect(wallSlot).toHaveAttribute(
      "aria-label",
      `Wall x${wallCount - 1}`,
    );
    await expect(carried).toHaveCount(0);
    const placedFromStock = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
      ).pendingBunker?.bunker.parts.at(-1),
    );
    expect(placedFromStock).toMatchObject({
      partId: "wall-panel",
      col: START_COL,
      row: 5,
      depth: 3,
    });
  },
);

test(
  "first-person building places a thin wall on the aimed face (F-117)",
  ciCase("E2E-MINE-BUNKER-FP-0007", "@render"),
  async ({ page }) => {
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

    await page.getByRole("button", { name: "Start bunker claim" }).click();
    const claimSheet = page.getByRole("region", { name: "Bunker upkeep" });
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

    // Select the wall. The spawn faces -z, so the crosshair sees the claim
    // rock behind the pocket and would build against that +depth wall face.
    const wallSlot = page.getByTestId("bunker-fp-slot-wall-panel");
    await wallSlot.click();
    await expect(wallSlot).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 20_000,
      })
      .toBe("3:0:3:rock-diggable");
    await expect(canvas).toHaveAttribute("data-fp-place", "3:0:2");
    // The slot a tap would fill (F-117): the +depth wall face of the place
    // cell, not a whole-cell footprint.
    await expect
      .poll(async () => canvas.getAttribute("data-fp-slot"), {
        timeout: 10_000,
      })
      .toBe("wall-pz");

    await armFpPointer(page);
    const beforePlace = await canvas.screenshot();
    await canvas.click();

    // The thin wall lands on its slot: the crosshair now sees a part in the
    // (cell-granular) place cell, and the persisted part carries the slot.
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toBe("3:0:2:part");
    const placedPart = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
      ).pendingBunker?.bunker.parts.at(-1),
    );
    expect(placedPart).toMatchObject({
      partId: "wall-panel",
      slot: "wall-pz",
    });
    const afterPlace = await canvas.screenshot();
    expect(
      await imagePixelDifferenceRatio(page, beforePlace, afterPlace),
    ).toBeGreaterThan(0.00005);
  },
);

test(
  "first-person rotates and places a staircase carrying its facing (F-117)",
  ciCase("E2E-MINE-BUNKER-FP-0008", "@render"),
  async ({ page }) => {
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
            "wall-panel": 0,
            "floor-panel": 0,
            "roof-panel": 0,
            "door-panel": 0,
            "basic-turret": 0,
            "floor-spikes": 0,
            "stair-panel": 2,
          },
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

    await page.getByRole("button", { name: "Start bunker claim" }).click();
    const claimSheet = page.getByRole("region", { name: "Bunker upkeep" });
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

    // Select the staircase: a rotatable mount, so a Rotate control appears
    // beside the hotbar and starts at the first facing.
    const stairSlot = page.getByTestId("bunker-fp-slot-stair-panel");
    await stairSlot.click();
    await expect(stairSlot).toHaveAttribute("aria-pressed", "true");
    const rotate = page.getByTestId("bunker-fp-rotate");
    await expect(rotate).toBeVisible();
    await expect(rotate).toHaveAttribute("data-orientation", "0");
    await rotate.click();
    await expect(rotate).toHaveAttribute("data-orientation", "1");

    // Aim forward at the pocket: the deepest crossed open cell is the place
    // cell for the whole-cell mount.
    await expect(canvas).toHaveAttribute("data-fp-place", "3:0:2");

    await armFpPointer(page);
    const beforePlace = await canvas.screenshot();
    await canvas.click();

    // The stair lands as a walkable ramp cell the crosshair now targets, and
    // the persisted part carries the rotated facing in the independent mount
    // slot.
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toBe("3:0:2:part");
    const placedPart = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
      ).pendingBunker?.bunker.parts.at(-1),
    );
    expect(placedPart).toMatchObject({
      partId: "stair-panel",
      orientation: 1,
      slot: "mount",
    });
    const afterPlace = await canvas.screenshot();
    expect(
      await imagePixelDifferenceRatio(page, beforePlace, afterPlace),
    ).toBeGreaterThan(0.00005);
  },
);

test(
  "first-person walks from a stair top onto a floor deck (multi-level)",
  ciCase("E2E-MINE-BUNKER-FP-0009", "@render"),
  async ({ page }) => {
    // Software-GL runners compile the fp scene slowly.
    test.setTimeout(180_000);
    // The exact live-report layout: a staircase up from the room floor with
    // floor slabs continuing at the stair-top level. The deck must be
    // walkable ground, not an invisible cell-sized block (floor slabs
    // collide as thin decks).
    const deckView = {
      ...FP_BUNKER_VIEW,
      bunker: {
        footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
        layoutVersion: 1,
        dug: FP_PLANE_DUG,
        parts: [
          {
            partId: "stair-panel",
            col: START_COL + 1,
            row: 5,
            depth: 0,
            durability: 70,
            orientation: 0,
          },
          {
            partId: "floor-panel",
            col: START_COL + 2,
            row: 4,
            depth: 0,
            durability: 70,
            slot: "floor",
          },
          {
            partId: "floor-panel",
            col: START_COL + 3,
            row: 4,
            depth: 0,
            durability: 70,
            slot: "floor",
          },
        ],
      },
    };
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(deckView),
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
    // Spawn maps the miner's column to local x 3, feet on the room floor.
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")))
      .toBeCloseTo(3, 1);

    // Strafe right: up the stair in cell x 4 and straight across the deck
    // slabs in cells x 5 and x 6 without stopping.
    await page.keyboard.down("d");
    try {
      await expect
        .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")), {
          timeout: 20_000,
          intervals: [60],
        })
        .toBeGreaterThan(5.4);
    } finally {
      await page.keyboard.up("d");
    }
    // Standing on the deck: feet on the slab top (0.58), eye at 1.30. Under
    // the old whole-cell collision the walk wedged at the stair top edge
    // (eye x never passed ~4.2) with the eye still at the stair-top height.
    await expect
      .poll(async () => canvas.getAttribute("data-fp-grounded"), {
        timeout: 10_000,
      })
      .toBe("1");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-fp-eye-y")))
      .toBeCloseTo(1.3, 1);
    expect(Number(await canvas.getAttribute("data-fp-eye-x"))).toBeGreaterThan(
      5.4,
    );
  },
);

test(
  "first-person places a floor deck cell against a vertical face (multi-level)",
  ciCase("E2E-MINE-BUNKER-FP-0010", "@render"),
  async ({ page }) => {
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
            "wall-panel": 0,
            "floor-panel": 2,
            "roof-panel": 0,
            "door-panel": 0,
            "basic-turret": 0,
            "floor-spikes": 0,
            "stair-panel": 0,
          },
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

    await page.getByRole("button", { name: "Start bunker claim" }).click();
    const claimSheet = page.getByRole("region", { name: "Bunker upkeep" });
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

    // Entry arms the pick; tapping the armed pick again clears it so
    // NOTHING is selected: no slot pressed, no place cell, no ghost.
    const pick = page.getByTestId("bunker-fp-pick");
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await pick.click();
    await expect(pick).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("bunker-fp-slot-wall-panel")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(canvas).toHaveAttribute("data-fp-place", "none");

    // A pending claim always starts from the starter kit (4 floors).
    const floorSlot = page.getByTestId("bunker-fp-slot-floor-panel");
    await expect(floorSlot).toHaveAttribute("aria-label", "Floor x4");
    await floorSlot.click();
    await expect(floorSlot).toHaveAttribute("aria-pressed", "true");
    // Tapping the armed slot again unselects it, and a third tap re-arms.
    await floorSlot.click();
    await expect(floorSlot).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .toBe("none");
    await floorSlot.click();
    await expect(floorSlot).toHaveAttribute("aria-pressed", "true");

    // Aim level forward at the claim rock behind the pocket: a VERTICAL face.
    // A floor used to have no slot here; now the slab targets the place
    // cell's floor slot, so decks build off any face at any level (the same
    // gesture extends a deck sideways from a stair top or a deck edge).
    await aimFp(page, 0, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 20_000,
      })
      .toBe("3:0:3:rock-diggable");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .toBe("3:0:2");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-slot"), {
        timeout: 10_000,
      })
      .toBe("floor");

    await armFpPointer(page);
    const beforePlace = await canvas.screenshot();
    await canvas.click();

    // The slab lands in the place cell's floor slot. It is a thin deck, so
    // this level horizontal ray still reaches the rock face beyond it.
    await expect(floorSlot).toHaveAttribute("aria-label", "Floor x3", {
      timeout: 10_000,
    });
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toBe("3:0:3:rock-diggable");
    const placedPart = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
      ).pendingBunker?.bunker.parts.at(-1),
    );
    expect(placedPart).toMatchObject({
      partId: "floor-panel",
      slot: "floor",
      depth: 2,
    });
    const afterPlace = await canvas.screenshot();
    expect(
      await imagePixelDifferenceRatio(page, beforePlace, afterPlace),
    ).toBeGreaterThan(0.00005);
  },
);

test(
  "first-person hold-to-mine swings the pickaxe and digs cell after cell",
  ciCase("E2E-MINE-BUNKER-FP-0011", "@render"),
  async ({ page }) => {
    // Software-GL runners compile the fp scene slowly, and this test
    // decodes two full screenshots for the swing motion proof.
    test.setTimeout(240_000);
    const mine = createMine(6062, DEFAULT_GEAR, STARTING_CONSUMABLES);
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
          seed: 6062,
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
          inventory: FP_BUNKER_VIEW.inventory,
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
        seed: 6062,
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

    await page.getByRole("button", { name: "Start bunker claim" }).click();
    const claimSheet = page.getByRole("region", { name: "Bunker upkeep" });
    await claimSheet.getByRole("button", { name: "Claim 7x5 bunker" }).click();
    await claimSheet.getByRole("button", { name: "Close" }).click();

    await page.getByTestId("bunker-fp-enter").click();
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
        timeout: 45_000,
      })
      .toBe("27");

    // Entry arms the pick; aim level so the ray runs straight down the
    // claim-rock column ahead. The spawn pocket opens depths 0-2, so the
    // first rock in the column sits at depth 3.
    await expect(page.getByTestId("bunker-fp-pick")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await armFpPointer(page);
    await aimFp(page, 0, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toBe("3:0:3:rock-diggable");
    await expect(canvas).toHaveAttribute("data-fp-swinging", "0");

    // Hold the primary input: the pickaxe swings and mines block after
    // block down the column without releasing (F-114).
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas bounding box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    // Parking the pointer emits movement deltas that the pointer-locked
    // look consumes on some chromium builds; re-square the aim so the
    // held swings strike the column ahead, not a drifted corner.
    await aimFp(page, 0, 0);
    await page.mouse.down();
    try {
      await expect
        .poll(async () => canvas.getAttribute("data-fp-swinging"), {
          timeout: 10_000,
        })
        .toBe("1");

      // Rule 10: the swing is visible motion, not just a state flag. Two
      // frames a swing-beat apart differ.
      const frameA = await canvas.screenshot();
      await page.waitForTimeout(110);
      const frameB = await canvas.screenshot();
      expect(
        await imagePixelDifferenceRatio(page, frameA, frameB),
      ).toBeGreaterThan(0.00005);

      // A single sustained hold mines the two rock cells left in the column
      // past the deeper spawn pocket (27 -> 29). Multi-hit digging means
      // each block soaks several swings before it breaks, so the hold must
      // run until both cells actually open, not until the first crack.
      await expect
        .poll(
          async () => Number(await canvas.getAttribute("data-fp-open-cells")),
          {
            timeout: 30_000,
          },
        )
        .toBeGreaterThanOrEqual(29);
    } finally {
      await page.mouse.up();
    }

    // Releasing settles the swing.
    await expect
      .poll(async () => canvas.getAttribute("data-fp-swinging"), {
        timeout: 10_000,
      })
      .toBe("0");

    // Every mined cell sits in the miner's column, dug in depth order.
    const dug = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}")
          .pendingBunker?.bunker.dug as
          | { col: number; row: number; depth: number }[]
          | undefined,
    );
    // Ignore the pre-mined spawn pocket (depths 0-2); the cells hold-to-mine
    // actually dug run straight down the miner's column from depth 3 in order.
    const mined = (dug ?? []).filter((cell) => cell.depth >= 3);
    expect(mined.length).toBeGreaterThanOrEqual(2);
    for (const cell of mined) {
      expect(cell.col).toBe(START_COL);
      expect(cell.row).toBe(5);
    }
    expect(mined.map((cell) => cell.depth)).toEqual(mined.map((_, i) => i + 3));
  },
);

test.describe("phone viewport", () => {
  test.use({
    viewport: { width: 390, height: 760 },
    hasTouch: true,
    isMobile: true,
  });

  test(
    "touch walking auto-jumps a one-block step and ships no jump button",
    ciCase("E2E-MINE-BUNKER-FP-0021", "@render"),
    async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "uses CDP touch events");
      // Software-GL phone runs compile the fp scene slowly.
      test.setTimeout(240_000);
      // A three-block plateau on the room floor to the spawn's right.
      // Climbing the first face proves the hop; the plateau keeps the
      // mover grounded on top for stable asserts.
      const stepView = {
        ...FP_BUNKER_VIEW,
        bunker: {
          footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
          layoutVersion: 1,
          dug: FP_PLANE_DUG,
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
          .poll(
            async () => Number(await canvas.getAttribute("data-fp-eye-x")),
            {
              timeout: 20_000,
              intervals: [60],
            },
          )
          .toBeGreaterThan(3.1);
        // The eye rises past the walk height mid-hop...
        await expect
          .poll(
            async () => Number(await canvas.getAttribute("data-fp-eye-y")),
            {
              timeout: 20_000,
              intervals: [60],
            },
          )
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
    },
  );

  test(
    "a long still press on the look zone quick-pries the crosshair part",
    ciCase("E2E-MINE-BUNKER-FP-0022", "@render"),
    async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "uses CDP touch events");
      // Software-GL phone runs compile the fp scene slowly.
      test.setTimeout(240_000);
      // A wall two cells right of spawn: the ray crosses an open cell on
      // the way, so a stray tap act after the hold would visibly place a
      // fresh wall there (the suppression this test exists to pin).
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
      // The pry refunds through the banked remove API (F-099).
      const removedView = {
        ...pryView,
        bunker: { ...pryView.bunker, parts: [] },
        inventory: { ...FP_BUNKER_VIEW.inventory, "wall-panel": 7 },
      };
      const removeBodies: unknown[] = [];
      const placeBodies: unknown[] = [];
      await page.route("**/api/bunker", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(pryView),
        });
      });
      await page.route("**/api/bunker/parts/remove", async (route) => {
        removeBodies.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(removedView),
        });
      });
      await page.route("**/api/bunker/parts/place", async (route) => {
        placeBodies.push(route.request().postDataJSON());
        await route.fulfill({ status: 503, body: "{}" });
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

      // Arm build (the dig tool now owns the look-zone hold for mining, so
      // quick-pry via long-press is a build/pry-tool affordance). A stray
      // tap act after the hold would place a wall into the open cell,
      // which this test exists to prove does not happen.
      await page.getByTestId("bunker-fp-slot-wall-panel").click();
      await expect(
        page.getByTestId("bunker-fp-slot-wall-panel"),
      ).toHaveAttribute("aria-pressed", "true");

      // Face the wall (local 5,0,0) across the open cell (4,0,0). The long
      // press pries the part regardless of the armed build tool.
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

      // A still press on the look zone held past the hold window (450ms)
      // refunds the wall straight to the pack: hotbar count up, cell
      // reopened, and no carried chip at any point.
      await touchHold(page, { x: 300, y: 350 }, 700);
      const wallSlot = page.getByTestId("bunker-fp-slot-wall-panel");
      await expect(wallSlot).toHaveAttribute("aria-label", "Wall x7", {
        timeout: 10_000,
      });
      await expect(page.locator(".bunker-fp-carried")).toHaveCount(0);
      await expect
        .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
          timeout: 10_000,
        })
        .toBe("35");
      expect(removeBodies).toEqual([
        { col: START_COL + 2, row: 5, depth: 0, expectedRevision: 0 },
      ]);

      // Releasing the hold must NOT also fire the tap act: with build
      // armed and a valid place cell, a stray act would spend a wall
      // back into (4,0,0). Stock, cells, and the place API stay quiet.
      await page.waitForTimeout(400);
      await expect(wallSlot).toHaveAttribute("aria-label", "Wall x7");
      await expect(canvas).toHaveAttribute("data-fp-open-cells", "35");
      expect(removeBodies).toHaveLength(1);
      expect(placeBodies).toEqual([]);
    },
  );

  test(
    "the phone hotbar keeps every slot and the pry toggle inside the viewport",
    ciCase("E2E-MINE-BUNKER-FP-0023", "@functional"),
    async ({ page }) => {
      await bypassMineRenderer(page);
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
    },
  );
});

test(
  "first-person dig and place round-trip the banked bunker APIs with depth",
  ciCase("E2E-MINE-BUNKER-FP-0012", "@render"),
  async ({ page }) => {
    test.setTimeout(240_000);
    const dugView = {
      ...FP_BUNKER_VIEW,
      bunker: {
        ...FP_BUNKER_VIEW.bunker,
        dug: [...FP_PLANE_DUG, { col: START_COL, row: 5, depth: 1 }],
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
    // 35 tunnel-plane cells minus the fixture's wall (F-118 freed the
    // former core cell, so it counts as open now).
    await expect
      .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
        timeout: 20_000,
      })
      .toBe("34");

    // Dig the rock straight ahead through the banked excavate API. Entry
    // already armed the pick; pressing 0 again would clear it (F-209
    // deselect), so assert the armed state rather than re-press.
    await expect(page.getByTestId("bunker-fp-pick")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
      .toBe("35");
    expect(excavateBodies).toEqual([
      { col: START_COL, row: 5, depth: 1, expectedRevision: 0 },
    ]);

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
    // Full-cell retirement (F-117): the forward aim builds the wall on the
    // dug cell's +depth face, so the banked place body carries that slot
    // instead of a legacy whole-cell placement.
    expect(placeBodies).toEqual([
      {
        partId: "wall-panel",
        col: START_COL,
        row: 5,
        depth: 1,
        slot: "wall-pz",
        expectedRevision: 0,
      },
    ]);
    await expect(page.getByTestId("bunker-fp-slot-wall-panel")).toHaveAttribute(
      "aria-label",
      "Wall x5",
    );
  },
);

/** The tutorial card's current step, or "none". Reads the DOM
 * directly so expect.poll stays bounded (no implicit locator wait). */
function tutorialStep(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document
        .querySelector('[data-testid="bunker-fp-tutorial"]')
        ?.getAttribute("data-step") ?? "none",
  );
}

test(
  "the progressive tutorial chains look, walk, dig, place, and pry, and completion persists",
  ciCase("E2E-MINE-BUNKER-FP-0013", "@render"),
  async ({ page }) => {
    // Software-GL runners compile the fp scene slowly, and this test
    // enters the viewer twice (once fresh, once after the reload).
    test.setTimeout(300_000);
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
    await page.getByRole("button", { name: "Start bunker claim" }).click();
    const claimSheet = page.getByRole("region", { name: "Bunker upkeep" });
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

    // Fresh profile: the look card shows after the settle-in delay.
    await expect
      .poll(() => tutorialStep(page), { timeout: 30_000 })
      .toBe("look");
    await expect(page.getByTestId("bunker-fp-tutorial")).toContainText(
      "look around",
    );

    // Looking past the threshold hides the card; the walk card follows
    // after the advance gap.
    await aimFp(page, 1.57, 0.4);
    await expect
      .poll(() => tutorialStep(page), { timeout: 10_000 })
      .toBe("walk");

    // Line the view back up for the dig, then walk the demonstration
    // distance; the dig card follows.
    await aimFp(page, 0, 0);
    await page.keyboard.down("d");
    await expect
      .poll(() => tutorialStep(page), { timeout: 15_000 })
      .toBe("dig");
    await page.keyboard.up("d");

    // The pick digs the interior rock straight ahead: blocks take several
    // swings now (surface parity), so hold until the block breaks. Entry
    // already armed the pick (0.1.254), and pressing 0 again would clear
    // the tool (F-209 deselect), so confirm the armed state instead of
    // re-pressing.
    await expect(page.getByTestId("bunker-fp-pick")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 10_000,
      })
      .toContain("rock-diggable");
    await armFpPointer(page);
    const openBefore = Number(await canvas.getAttribute("data-fp-open-cells"));
    await holdFpDigUntil(page, openBefore + 1);
    await expect
      .poll(() => tutorialStep(page), { timeout: 10_000 })
      .toBe("place");

    // Placing a wall into the dug cell advances to pry. The pending
    // claim's wall stock is the sim starter kit, not the banked-view
    // inventory, so read the live count and track it across the pair.
    const wallSlot = page.getByTestId("bunker-fp-slot-wall-panel");
    const wallLabelBefore = await wallSlot.getAttribute("aria-label");
    const wallStock = Number((wallLabelBefore ?? "").replace("Wall x", ""));
    expect(wallStock).toBeGreaterThan(0);
    await page.keyboard.press("1");
    await expect(wallSlot).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-place"), {
        timeout: 10_000,
      })
      .not.toBe("none");
    await canvas.click();
    await expect(wallSlot).toHaveAttribute(
      "aria-label",
      `Wall x${wallStock - 1}`,
      {
        timeout: 10_000,
      },
    );
    await expect
      .poll(() => tutorialStep(page), { timeout: 10_000 })
      .toBe("pry");
    // The pry card teaches the refund flow; the skip control still
    // rides every teachable card.
    await expect(page.getByTestId("bunker-fp-tutorial")).toContainText(
      "pry it back into your pack",
    );
    await expect(page.getByTestId("bunker-fp-tutorial-skip")).toBeVisible();

    // Right-click pries the just-placed wall straight back to the pack:
    // the stock returns to its pre-place count and the parts-count drop
    // is the demonstration, so the closer follows.
    await canvas.click({ button: "right" });
    await expect(wallSlot).toHaveAttribute("aria-label", `Wall x${wallStock}`, {
      timeout: 10_000,
    });
    await expect(page.locator(".bunker-fp-carried")).toHaveCount(0);
    await expect
      .poll(() => tutorialStep(page), { timeout: 10_000 })
      .toBe("done");

    // The closer card is a button: tapping it completes the chain and
    // persists the done flag. Release the pointer lock first: with the lock
    // held the browser hit-tests every click to the locked canvas, so a DOM
    // click on the card gets intercepted. A real player presses Escape and
    // the BROWSER frees the lock natively; synthetic Escape cannot trigger
    // that user-agent path, so the test frees it the same way the browser
    // would, through exitPointerLock.
    await page.evaluate(() => document.exitPointerLock());
    await expect
      .poll(async () => canvas.getAttribute("data-fp-lock"), {
        timeout: 10_000,
      })
      .not.toBe("locked");
    await page.getByTestId("bunker-fp-tutorial").click();
    await expect(page.getByTestId("bunker-fp-tutorial")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("vibebots-bunker-fp-tutorial-done"),
      ),
    ).toBe("1");

    // A later visit with the flag set never shows a card.
    await page.reload();
    await dismissReleaseNotes(page);
    await expect(status).toHaveAttribute("data-depth", "5");
    await page.getByTestId("bunker-fp-enter").click();
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();
    await page.waitForTimeout(2600);
    await expect(page.getByTestId("bunker-fp-tutorial")).toHaveCount(0);
  },
);

test(
  "the settings replay button re-arms the tutorial for the next entry",
  ciCase("E2E-MINE-BUNKER-FP-0014", "@functional"),
  async ({ page }) => {
    // Two fp entries on a software-GL runner.
    test.setTimeout(300_000);
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FP_BUNKER_VIEW),
      });
    });
    // A profile that already finished the tutorial.
    await page.addInitScript(() => {
      localStorage.setItem("vibebots-bunker-fp-tutorial-done", "1");
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await digTo(page, 1);

    // Completed profile: no cards inside the bunker.
    await page.getByTestId("bunker-fp-enter").click();
    const status = page.getByLabel("Mine status");
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();
    await page.waitForTimeout(2600);
    await expect(page.getByTestId("bunker-fp-tutorial")).toHaveCount(0);

    // Back in the flat view, the settings menu clears the flag and
    // confirms inline.
    await page.getByRole("button", { name: "Exit bunker" }).click();
    await expect(status).toHaveAttribute("data-fp-mode", "0");
    await awaitMineSceneReady(page);
    const gear = page.getByRole("button", { name: "Open settings" });
    await openSettingsFor(page, "replay-tutorial");
    const replay = page.getByTestId("replay-bunker-tutorial");
    await expect(replay).toBeVisible();
    await replay.click();
    await expect(
      page.getByText("Shows the next time you enter your bunker."),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("vibebots-bunker-fp-tutorial-done"),
      ),
    ).toBeNull();
    await gear.click();

    // The next entry starts the chain from the look card again.
    await page.getByTestId("bunker-fp-enter").click();
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    await expect
      .poll(() => tutorialStep(page), { timeout: 45_000 })
      .toBe("look");
  },
);

test(
  "an enclosed spawn shows the boxed-in escape hint until a part is pried",
  ciCase("E2E-MINE-BUNKER-FP-0015", "@render"),
  async ({ page }) => {
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
    // Prying the right wall refunds it and reopens (4,0,0); placing it
    // back re-encloses the spawn.
    const priedView = {
      ...boxedView,
      bunker: { ...boxedView.bunker, parts: [boxedView.bunker.parts[0]] },
      inventory: { ...FP_BUNKER_VIEW.inventory, "wall-panel": 7 },
    };
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(boxedView),
      });
    });
    await page.route("**/api/bunker/parts/remove", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(priedView),
      });
    });
    await page.route("**/api/bunker/parts/place", async (route) => {
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

    // Prying a wall refunds it and opens the cell directly (F-099), so
    // the hint stands down with the escape route open.
    await aimFp(page, -1.57, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 20_000,
      })
      .toBe("4:0:0:part");
    await armFpPointer(page);
    await canvas.click({ button: "right" });
    await expect(page.getByTestId("bunker-fp-slot-wall-panel")).toHaveAttribute(
      "aria-label",
      "Wall x7",
      { timeout: 10_000 },
    );
    await expect(page.locator(".bunker-fp-carried")).toHaveCount(0);
    await expect(hint).toHaveCount(0);

    // No re-enclosure step: re-boxing the spawn depended on dropping a
    // whole-cell wall back into the open escape cell, which F-117 slot
    // placement retired (a thin wall attaches to a solid face, but the
    // escape here is one open cell in a fully open plane with no solid to
    // hold a lateral wall, so no single legal placement re-seals it). The
    // surviving coverage is the pair proven above: a sealed spawn shows the
    // hint (the boxed fixture at entry), and prying its wall clears it
    // (F-207).
  },
);

test(
  "prying a damaged part denies with repair-first guidance",
  ciCase("E2E-MINE-BUNKER-FP-0016", "@render"),
  async ({ page }) => {
    test.setTimeout(240_000);
    // Raid wear without running a raid: the banked fixture ships the
    // wall already damaged (45/90). Refunding it at full count would
    // launder the damage, so the pry must refuse client-side and never
    // reach the remove API.
    const damagedView = {
      ...FP_BUNKER_VIEW,
      bunker: {
        ...FP_BUNKER_VIEW.bunker,
        parts: [
          { partId: "wall-panel", col: START_COL + 1, row: 5, durability: 45 },
        ],
      },
    };
    const removeBodies: unknown[] = [];
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(damagedView),
      });
    });
    await page.route("**/api/bunker/parts/remove", async (route) => {
      removeBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, body: "{}" });
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

    // Face the damaged wall one cell to the spawn's right.
    await aimFp(page, -1.57, 0);
    await expect
      .poll(async () => canvas.getAttribute("data-fp-target"), {
        timeout: 20_000,
      })
      .toBe("4:0:0:part");
    await expect(page.locator(".bunker-fp-target-label")).toHaveText(
      "Wall 45/90",
    );
    await armFpPointer(page);
    await canvas.click({ button: "right" });

    // The deny chip explains the refusal; nothing refunds, the part
    // stays targeted, and no carried chip exists.
    const deny = page.getByTestId("bunker-fp-deny");
    await expect(deny).toBeVisible({ timeout: 10_000 });
    await expect(deny).toHaveText(
      "Damaged: repair from the Bunker sheet first",
    );
    await expect(page.getByTestId("bunker-fp-slot-wall-panel")).toHaveAttribute(
      "aria-label",
      "Wall x6",
    );
    await expect(page.locator(".bunker-fp-carried")).toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-fp-target", "4:0:0:part");
    expect(removeBodies).toEqual([]);

    // The chip is a brief notice: it clears on its own.
    await expect(deny).toHaveCount(0, { timeout: 10_000 });
  },
);

test(
  "first-person walking over a banked bunker's overflow loot collects it",
  ciCase("E2E-MINE-BUNKER-FP-0017", "@render"),
  async ({ page }) => {
    // Software-GL runners compile the fp scene slowly.
    test.setTimeout(180_000);
    // A banked bunker with one overflow-loot pile (F-116) sitting on the
    // floor one cell right of the spawn column (local x 4). Walking onto it
    // credits the banked bunker's vibes and drops the pile.
    const lootCell = { col: START_COL + 1, row: 5, depth: 0 };
    const lootView = {
      ...FP_BUNKER_VIEW,
      bunker: {
        ...FP_BUNKER_VIEW.bunker,
        loot: [{ ...lootCell, ores: { coal: 4 } }],
      },
    };
    // The collect API returns the same bunker with the pile cleared and the
    // vibes credited, exactly as the server would after taking the loot.
    const collectedView = {
      ...lootView,
      bunker: { ...lootView.bunker, loot: [] },
      player: { ...FP_BUNKER_VIEW.player, balance: 124 },
    };
    const collectBodies: unknown[] = [];
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(lootView),
      });
    });
    await page.route("**/api/bunker/collect", async (route) => {
      collectBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(collectedView),
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
    // Spawn maps the miner's column to local x 3, feet on the floor.
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")))
      .toBeCloseTo(3, 1);

    // Strafe right onto the loot cell (local x 4). Rounding the eye past
    // 3.6 puts the feet in cell x 4, the walk-over fires one collect intent.
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
    // Rule 10 motion proof: the held walk moves visible pixels, not just a
    // diagnostic number.
    expect(
      await imagePixelDifferenceRatio(page, walkFrameA, walkFrameB),
    ).toBeGreaterThan(0.00005);

    // Exactly one collect fired, for the pile's cell.
    await expect.poll(async () => collectBodies.length).toBe(1);
    expect(collectBodies).toEqual([lootCell]);

    // The pile is gone: strafing back over the cleared cell fires no second
    // collect (the updated view dropped the loot).
    await page.keyboard.down("a");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")), {
        timeout: 15_000,
      })
      .toBeLessThan(3);
    await page.keyboard.up("a");
    await page.keyboard.down("d");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-fp-eye-x")), {
        timeout: 15_000,
      })
      .toBeGreaterThan(3.6);
    await page.keyboard.up("d");
    expect(collectBodies).toHaveLength(1);
  },
);

/** Claim a fresh pending bunker at depth 5 and enter first-person, so the
 * interior carries a real block seed and its undug cells render the mine's
 * depth-appropriate dirt/rock/ore art (F-116). Seed 1 exposes ore on the
 * spawn-facing wall. */
async function enterFreshClaimFp(page: Page, seed: number): Promise<void> {
  const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bunker: null,
        inventory: FP_BUNKER_VIEW.inventory,
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
      seed,
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
  await page.getByRole("button", { name: "Start bunker claim" }).click();
  const claimSheet = page.getByRole("region", { name: "Bunker upkeep" });
  await claimSheet.getByRole("button", { name: "Claim 7x5 bunker" }).click();
  await claimSheet.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("bunker-fp-enter").click();
  await expect(status).toHaveAttribute("data-fp-mode", "1");
}

test(
  "first-person bunker interior renders dirt, rock, and ore, not one flat gray",
  ciCase("E2E-MINE-BUNKER-FP-0018", "@render"),
  async ({ page }) => {
    // Software-GL runners compile the fp scene slowly and this decodes a full
    // screenshot for the pixel check.
    test.setTimeout(180_000);
    await enterFreshClaimFp(page, 1);
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-open-cells"), {
        timeout: 45_000,
      })
      .toBe("27");
    // Let the scene settle real frames before sampling.
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 20_000,
      })
      .not.toBeNull();
    await page.waitForTimeout(1200);

    // Seed 1 exposes ore on the spawn-facing wall, so the crystal overlay
    // must actually render (the warm/neutral pixel check alone would pass with
    // every ore cluster absent). The probe counts exposed ore veins.
    await expect
      .poll(
        async () => Number(await canvas.getAttribute("data-fp-ore-cells")),
        {
          timeout: 20_000,
        },
      )
      .toBeGreaterThan(0);

    // The undug walls surrounding the spawn pocket carry the depth's dirt and
    // rock. Before per-kind meshes the whole interior was one flat rock gray
    // (the node materials ignore instanceColor), so warm dirt pixels were
    // absent. Sample the full canvas: both buckets must be well populated.
    const shot = await canvas.screenshot();
    const { warm, neutral } = await imageRegionWarmNeutralFractions(
      page,
      shot,
      {
        left: 0,
        top: 0,
        right: 1,
        bottom: 1,
      },
    );
    expect(warm).toBeGreaterThan(0.04);
    expect(neutral).toBeGreaterThan(0.04);
  },
);

/** A banked raid start: the store adopts activeLiveRaid and the fp view
 * switches into the fight. The frozen snapshot carries depth on its
 * parts (the server normalizes these), so the client sim reads them. */
const RAID_BUNKER = {
  footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
  layoutVersion: 1,
  dug: FP_PLANE_DUG,
  parts: [
    {
      partId: "wall-panel",
      col: START_COL - 3,
      row: 1,
      depth: 0,
      durability: 90,
    },
  ],
  blockSeed: 1,
};

const LIVE_RAID_ACTIVE = {
  raidId: "live-test-1",
  // Tier 3 so the wave fields specialists (breachers from tier 2, tanks from
  // tier 3): the render layer must tint them, verified via the kinds probe.
  tier: 3,
  startedAtMs: 1_000,
  durationSeconds: 180,
  graceSeconds: 60,
  bunker: RAID_BUNKER,
};

const LIVE_RAID_START = {
  ...FP_BUNKER_VIEW,
  activeLiveRaid: LIVE_RAID_ACTIVE,
  liveRaid: LIVE_RAID_ACTIVE,
};

const LIVE_RAID_RESOLVED = {
  ...FP_BUNKER_VIEW,
  activeLiveRaid: null,
  // The settled raid starts the 4h cooldown, so the HUD swaps the Start
  // button for a countdown (computed at fulfill time, safely in the future
  // for the whole test run).
  nextRaidAvailableAtMs: Date.now() + 4 * 60 * 60 * 1000,
  reward: {
    survived: false,
    vibesGained: 0,
    xpGained: 0,
    defenseXpBefore: 120,
    defenseXpAfter: 120,
    levelBefore: 2,
    levelAfter: 2,
    leveledUp: false,
    beaconLimitBefore: 3,
    beaconLimitAfter: 3,
    newStamps: [],
  },
  newStamps: [],
};

test(
  "first-person live raid starts, animates, and resolves",
  ciCase("E2E-MINE-BUNKER-FP-0019", "@render"),
  async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const resolveBodies: unknown[] = [];
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ json: FP_BUNKER_VIEW });
    });
    await page.route("**/api/bunker/raid/start", async (route) => {
      await route.fulfill({ json: LIVE_RAID_START });
    });
    await page.route("**/api/bunker/raid/resolve", async (route) => {
      resolveBodies.push(route.request().postDataJSON());
      await route.fulfill({ json: LIVE_RAID_RESOLVED });
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

    // Look level into the room so the approaching wave is in frame.
    await aimFp(page, 0, 0);

    // Start the raid: the start control gives way to the raid banner and
    // the player stays inside (fp mode never drops).
    await page.evaluate(() => {
      document.body.dataset.observedRaidVerdicts = "";
      const captureVerdict = () => {
        const verdict = document
          .querySelector('[data-testid="bunker-fp-raid-result"]')
          ?.textContent?.trim();
        if (!verdict) return;
        const observed = document.body.dataset.observedRaidVerdicts ?? "";
        if (!observed.split("|").includes(verdict)) {
          document.body.dataset.observedRaidVerdicts = observed
            ? `${observed}|${verdict}`
            : verdict;
        }
      };
      new MutationObserver(captureVerdict).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      captureVerdict();
    });
    await page.getByTestId("bunker-fp-raid-start-button").click();
    await expect(page.getByTestId("bunker-fp-raid-panel")).toBeVisible({
      timeout: 15_000,
    });
    await expect(status).toHaveAttribute("data-fp-mode", "1");

    // The Clanker render layer actually draws the wave (not just the HUD
    // counting it): its dataset probe reports the number of Clanker bodies
    // it makes visible each frame, and that rises above zero while the raid
    // is live.
    await expect
      .poll(
        async () =>
          Number(await canvas.getAttribute("data-fp-clankers-visible")),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    // Specialists reach the render layer (F-159): a tier-3 wave fields
    // breachers and tanks, and the layer mirrors the distinct kinds it draws.
    await expect
      .poll(async () => canvas.getAttribute("data-fp-clanker-kinds"), {
        timeout: 15_000,
      })
      .toMatch(/breacher/);
    expect(await canvas.getAttribute("data-fp-clanker-kinds")).toMatch(/tank/);

    // Capture a short sequence while the player retreats so the Clanker
    // wave chases into frame, and prove motion with a consecutive-frame
    // diff. Holding "s" backs the miner away from the converging wave: the
    // Clankers stay ahead of the camera (in view) and the raid lasts long
    // enough to catch them crossing the open depth-0 plane, instead of the
    // stationary player being reached in a couple of frames.
    await aimFp(page, 0, -0.28);
    await page.keyboard.down("s");
    const frames: Buffer[] = [];
    for (let i = 0; i < 12; i++) {
      const shot = await canvas.screenshot();
      frames.push(shot);
      await testInfo.attach(`raid-frame-${i}`, {
        body: shot,
        contentType: "image/png",
      });
      if (process.env.FP_RAID_CAPTURE_DIR) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(
          `${process.env.FP_RAID_CAPTURE_DIR}/raid-frame-${i}.png`,
          shot,
        );
      }
    }
    await page.keyboard.up("s");
    // Motion somewhere across the retreat (the sim animates the wave and
    // the walk moves the camera).
    let maxDiff = 0;
    for (let i = 1; i < frames.length; i++) {
      maxDiff = Math.max(
        maxDiff,
        await imagePixelDifferenceRatio(page, frames[i - 1], frames[i]),
      );
    }
    expect(maxDiff).toBeGreaterThan(0.001);

    // The stationary player is reached, so the raid ends and the client
    // submits exactly one bounded outcome report to the resolve route.
    await expect
      .poll(() => resolveBodies.length, { timeout: 120_000 })
      .toBeGreaterThan(0);

    // The result is deliberately brief, so observe the DOM throughout the
    // raid and require the visible loss verdict before checking settled state.
    await expect
      .poll(
        () => page.locator("body").getAttribute("data-observed-raid-verdicts"),
        { timeout: 20_000 },
      )
      .toContain("Bunker breached!");

    // Once settled the view clears the raid. The settled view carries the
    // cooldown deadline, so the Start control is replaced by the countdown,
    // not a button that would 409.
    await expect(page.getByTestId("bunker-fp-raid-cooldown")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("bunker-fp-raid-cooldown")).toContainText(
      "Next raid in",
    );
    await expect(page.getByTestId("bunker-fp-raid-start-button")).toHaveCount(
      0,
    );
  },
);

test(
  "a live raid is a two-sided melee fight, not a fatal first touch",
  ciCase("E2E-MINE-BUNKER-FP-0025", "@functional"),
  async ({ page }) => {
    // The raid sim advances from real frame deltas, capped per frame, so
    // its wall-clock pace tracks the renderer's frame rate. On a fast host
    // this test finishes in seconds; the generous ceilings only come into
    // play on a slow software renderer, where the 6-second staged onset
    // alone can take the better part of a minute of wall clock.
    test.setTimeout(420_000);
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ json: FP_BUNKER_VIEW });
    });
    await page.route("**/api/bunker/raid/start", async (route) => {
      await route.fulfill({ json: LIVE_RAID_START });
    });
    await page.route("**/api/bunker/raid/resolve", async (route) => {
      await route.fulfill({ json: LIVE_RAID_RESOLVED });
    });

    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await digTo(page, 1);
    await page.getByTestId("bunker-fp-enter").click();
    const canvas = page.locator("canvas");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();
    await aimFp(page, 0, 0);

    // Start before arming the pointer: a locked pointer routes every click
    // to the canvas, so the HUD control would never receive one.
    await page.getByTestId("bunker-fp-raid-start-button").click();
    await expect(page.getByTestId("bunker-fp-raid-panel")).toBeVisible({
      timeout: 15_000,
    });
    await armFpPointer(page);

    // The miner starts the raid on a full health bar, so contact can no
    // longer be an instant loss.
    const health = page.getByTestId("bunker-fp-raid-health");
    await expect(health).toBeVisible({ timeout: 15_000 });
    await expect(health).toHaveAttribute("data-health", "100");
    await expect
      .poll(async () =>
        Number(await canvas.getAttribute("data-fp-raid-health")),
      )
      .toBe(100);

    // Hold the primary input for the whole fight: the pick stays in hand
    // for the raid's duration whatever tool is selected, so swings connect
    // with whatever closes on the miner.
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await aimFp(page, 0, 0);
    await page.mouse.down();
    try {
      // The pick swings during a raid (it is the miner's only weapon).
      await expect
        .poll(async () => canvas.getAttribute("data-fp-swinging"), {
          timeout: 20_000,
        })
        .toBe("1");

      // One wall-clock-bounded observation loop rather than a chain of
      // serial waits. The raid sim advances only from clamped frame
      // deltas, so every stage of a raid test is hostage to the renderer's
      // throughput; splitting the budget into separate gates means a slow
      // runner can burn one gate's whole timeout and leave nothing for the
      // rest. Watching all three signals at once uses the budget for
      // whichever arrives, and records the high-water marks so a failure
      // says which signal never came instead of only naming the first gate
      // that expired.
      //
      // The miner turns in place so a converging wave walks into the swing
      // arc rather than the test chasing it, nudging the aim through the
      // fp hook directly because aimFp's settle polls would otherwise
      // dominate the budget. The swing half asserts on strikes landed, not
      // kills, because a kill is only a strike plus enough cooldowns and
      // those are counted in sim ticks. Kill-at-zero-energy is pinned in
      // the sim suite instead.
      let sawClanker = false;
      let sawDamage = false;
      let sawStrike = false;
      let raidCleared = false;
      let maxVisible = 0;
      let minHealth = 100;
      let lastRaidBanner = "";
      // Margin matters more than tightness here. The raid opens with a
      // deliberate 6-second onset plus staggered activation, and the sim
      // advances at renderer speed, so the wait is long by construction:
      // the first green CI run used almost all of a 240s budget. Sized
      // against the 420s test timeout with setup, so a slightly slower
      // runner reports a real result rather than a flake.
      const deadline = Date.now() + 330_000;
      for (let i = 0; !(sawDamage && sawStrike) && Date.now() < deadline; i++) {
        await page.evaluate(
          (yaw) => {
            (
              window as unknown as { __vibebotsFp?: { setYaw?: number } }
            ).__vibebotsFp = { setYaw: yaw };
          },
          (i % 8) * (Math.PI / 4),
        );
        await page.waitForTimeout(300);
        const hp = Number(await canvas.getAttribute("data-fp-raid-health"));
        const strikes = Number(
          await canvas.getAttribute("data-fp-raid-strikes"),
        );
        const visible = Number(
          await canvas.getAttribute("data-fp-clankers-visible"),
        );
        if (visible > maxVisible) maxVisible = visible;
        if (visible > 0) sawClanker = true;
        if (hp >= 0 && hp < minHealth) minHealth = hp;
        if (hp >= 0 && hp < 100) sawDamage = true;
        if (strikes > 0) sawStrike = true;
        // The raid banner carries the countdown, so it proves whether sim
        // time advanced at all when a signal never arrives.
        if (i % 10 === 0) {
          lastRaidBanner =
            (await page
              .getByTestId("bunker-fp-raid-panel")
              .textContent()
              .catch(() => null)) ?? "";
        }
        // -1 means the runtime is gone: the raid settled and nothing more
        // can be observed. Recorded rather than silently broken out of, so
        // the assertion below can say which half went unproven.
        if (hp < 0) {
          raidCleared = true;
          break;
        }
      }
      // A raid that settles before both halves land has not demonstrated
      // the two-sided fight. With the miner standing in the open swinging
      // for the whole 180-second raid that should not happen, so it is a
      // real failure rather than a skip. The extra fields are diagnostics:
      // they distinguish "the wave never reached the room" from "it did but
      // never bit" from "it bit but the pick never connected".
      expect({
        sawClanker,
        sawDamage,
        sawStrike,
        raidCleared,
        maxVisible,
        minHealth,
        lastRaidBanner,
      }).toMatchObject({
        sawClanker: true,
        sawDamage: true,
        sawStrike: true,
        raidCleared: false,
      });
    } finally {
      await page.mouse.up();
    }
  },
);

test(
  "leaving a live raid mid-fight forfeits it instead of re-rolling on re-entry",
  ciCase("E2E-MINE-BUNKER-FP-0020", "@functional"),
  async ({ page }) => {
    test.setTimeout(240_000);
    const forfeitBodies: unknown[] = [];
    let resolveCalls = 0;

    // Pause the render loop on demand. The live raid steps its sim inside the
    // R3F frame loop, and a headless runner stutters rAF and then processes a
    // catch-up burst on each interaction; against a player who spawns at the
    // entry edge (reachable from the un-wallable mine-approach cell directly in
    // front, so no in-bunker wall can seal it), that lets the fight resolve on
    // its own and race the forfeit. Freezing rAF once the raid is on screen
    // holds the sim at its opening tick, so leaving is unambiguously a
    // mid-fight abandon. React effects (the unmount forfeit) run off the
    // scheduler, not rAF, so they still fire while the loop is frozen.
    await page.addInitScript(() => {
      const w = window as unknown as { __freezeRaf?: boolean };
      w.__freezeRaf = false;
      const real = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        real((t) => {
          // While frozen, defer the frame callback instead of running it: keep
          // the rAF chain alive (so R3F's shared render loop resumes cleanly
          // once unfrozen for the re-entry) but never advance the sim.
          if (w.__freezeRaf) {
            window.requestAnimationFrame(cb);
            return;
          }
          cb(t);
        });
    });
    const setFreeze = (frozen: boolean) =>
      page.evaluate((f) => {
        (window as unknown as { __freezeRaf?: boolean }).__freezeRaf = f;
      }, frozen);

    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({ json: FP_BUNKER_VIEW });
    });
    await page.route("**/api/bunker/raid/start", async (route) => {
      await route.fulfill({ json: LIVE_RAID_START });
    });
    await page.route("**/api/bunker/raid/resolve", async (route) => {
      resolveCalls += 1;
      await route.fulfill({ json: LIVE_RAID_RESOLVED });
    });
    // Leaving fp mid-raid settles the abandoned fight as a forfeit; the cleared
    // view carries no active raid, so the store drops it on adoption (F-160).
    await page.route("**/api/bunker/raid/forfeit", async (route) => {
      forfeitBodies.push(route.request().postDataJSON());
      await route.fulfill({
        json: { ...FP_BUNKER_VIEW, activeLiveRaid: null },
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

    await aimFp(page, 0, 0);
    await page.getByTestId("bunker-fp-raid-start-button").click();
    // The raid is up on screen: the HUD banner replaced the Start control.
    await expect(page.getByTestId("bunker-fp-raid-panel")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("bunker-fp-raid-start-button")).toHaveCount(
      0,
    );
    // Freeze the sim at its opening tick so leaving is a clean mid-fight abandon.
    await setFreeze(true);

    // Leave first person while the raid runs. The Exit control is hidden during
    // a raid, so a player abandons a fight the only way they can: Escape drops
    // out of the bunker view (no pointer lock is held in this headless run, so a
    // single Escape reaches the exit handler). The canvas unmounts with the raid
    // unresolved, so the client forfeits the abandoned raid once.
    await page.keyboard.press("Escape");
    await expect(status).toHaveAttribute("data-fp-mode", "0");
    await expect.poll(() => forfeitBodies.length, { timeout: 15_000 }).toBe(1);
    // A forfeit is a server-derived no-reward settlement, not a fought outcome,
    // so the client never submits a resolve report for the abandoned raid.
    expect(resolveCalls).toBe(0);

    // Re-enter with the loop running again: the forfeited raid is gone (the
    // store adopted the cleared view), so the fight does not re-roll. The Start
    // control returns, not the raid panel.
    await setFreeze(false);
    await page.getByTestId("bunker-fp-enter").click();
    await expect(status).toHaveAttribute("data-fp-mode", "1");
    await expect
      .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
        timeout: 45_000,
      })
      .not.toBeNull();
    await expect(page.getByTestId("bunker-fp-raid-start-button")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("bunker-fp-raid-panel")).toHaveCount(0);
  },
);

test.describe("phone viewport (touch abandon)", () => {
  test.use({
    viewport: { width: 390, height: 760 },
    hasTouch: true,
    isMobile: true,
  });

  test(
    "the touch abandon control forfeits a live raid behind a two-step confirm",
    ciCase("E2E-MINE-BUNKER-FP-0024", "@functional"),
    async ({ page, browserName }) => {
      test.skip(browserName !== "chromium", "uses touch tap events");
      test.setTimeout(240_000);
      const forfeitBodies: unknown[] = [];
      let resolveCalls = 0;

      // Same rAF freeze harness as the Escape-forfeit test above: hold the sim at
      // its opening tick so leaving is an unambiguous mid-fight abandon and cannot
      // race a self-resolving fight. See that test for why deferring (not
      // skipping) the frame callback keeps R3F's shared loop alive for re-entry.
      await page.addInitScript(() => {
        const w = window as unknown as { __freezeRaf?: boolean };
        w.__freezeRaf = false;
        const real = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) =>
          real((t) => {
            if (w.__freezeRaf) {
              window.requestAnimationFrame(cb);
              return;
            }
            cb(t);
          });
      });
      const setFreeze = (frozen: boolean) =>
        page.evaluate((f) => {
          (window as unknown as { __freezeRaf?: boolean }).__freezeRaf = f;
        }, frozen);

      await page.route("**/api/bunker", async (route) => {
        await route.fulfill({ json: FP_BUNKER_VIEW });
      });
      await page.route("**/api/bunker/raid/start", async (route) => {
        await route.fulfill({ json: LIVE_RAID_START });
      });
      await page.route("**/api/bunker/raid/resolve", async (route) => {
        resolveCalls += 1;
        await route.fulfill({ json: LIVE_RAID_RESOLVED });
      });
      await page.route("**/api/bunker/raid/forfeit", async (route) => {
        forfeitBodies.push(route.request().postDataJSON());
        await route.fulfill({
          json: { ...FP_BUNKER_VIEW, activeLiveRaid: null },
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

      await aimFp(page, 0, 0);
      await page.getByTestId("bunker-fp-raid-start-button").click();
      await expect(page.getByTestId("bunker-fp-raid-panel")).toBeVisible({
        timeout: 15_000,
      });
      await setFreeze(true);

      // On a phone the abandon control has to be an honest touch target: at least
      // 44px tall and fully inside the 390px viewport, not clipped off-screen.
      const abandon = page.getByTestId("bunker-fp-raid-abandon");
      const box = await abandon.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
      }

      // Touch players have no Escape key, so the raid HUD carries an in-panel
      // abandon affordance. Arming it must NOT leave on its own: a stray tap
      // while fighting cannot cost the raid. The first tap only reveals the
      // confirm.
      await abandon.tap();
      await expect(
        page.getByTestId("bunker-fp-raid-abandon-confirm"),
      ).toBeVisible();
      await expect(page.getByTestId("bunker-fp-raid-abandon")).toHaveCount(0);
      await expect(status).toHaveAttribute("data-fp-mode", "1");
      expect(forfeitBodies.length).toBe(0);

      // "Stay" backs out: the confirm collapses to the arming button and the
      // player is still in first person, still raiding, nothing forfeited.
      await page.getByTestId("bunker-fp-raid-abandon-no").tap();
      await expect(
        page.getByTestId("bunker-fp-raid-abandon-confirm"),
      ).toHaveCount(0);
      await expect(page.getByTestId("bunker-fp-raid-abandon")).toBeVisible();
      await expect(status).toHaveAttribute("data-fp-mode", "1");
      expect(forfeitBodies.length).toBe(0);

      // Re-arm, then commit: "Forfeit" leaves first person and settles the
      // abandoned fight, exactly like the desktop Escape path (F-160).
      await page.getByTestId("bunker-fp-raid-abandon").tap();
      await expect(
        page.getByTestId("bunker-fp-raid-abandon-confirm"),
      ).toBeVisible();
      await page.getByTestId("bunker-fp-raid-abandon-yes").tap();
      await expect(status).toHaveAttribute("data-fp-mode", "0");
      await expect
        .poll(() => forfeitBodies.length, { timeout: 15_000 })
        .toBe(1);
      expect(resolveCalls).toBe(0);

      // Re-enter with the loop running again: the forfeited raid is gone, so the
      // fight does not re-roll. The Start control returns, not the raid panel.
      await setFreeze(false);
      await page.getByTestId("bunker-fp-enter").click();
      await expect(status).toHaveAttribute("data-fp-mode", "1");
      await expect
        .poll(async () => canvas.getAttribute("data-fp-eye-x"), {
          timeout: 45_000,
        })
        .not.toBeNull();
      await expect(page.getByTestId("bunker-fp-raid-start-button")).toBeVisible(
        {
          timeout: 20_000,
        },
      );
      await expect(page.getByTestId("bunker-fp-raid-panel")).toHaveCount(0);
    },
  );
});
