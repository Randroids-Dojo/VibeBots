import { existsSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";
import { digTo, dismissReleaseNotes, START_COL } from "./support/mine-helpers";

/**
 * Visual regression baselines (process slice, graphics G5 hardening).
 * Deterministic paused Holodeck scenes are screenshotted against
 * committed per-platform baselines, so material and lighting
 * regressions on the WebGL2 fallback (the path CI actually exercises,
 * and the one that has broken silently before) fail a test instead of
 * waiting for an eyeball.
 *
 * Bootstrap and refresh: dispatch the CI workflow with
 * update_visual_baselines=true; the job runs this spec with
 * --update-snapshots and uploads the snapshot directory as an
 * artifact to commit. Until baselines exist for the running platform
 * the tests skip, so adding a new platform never blocks the suite.
 * After an INTENTIONAL look change, refresh the baselines in the same
 * slice that changed the look.
 */

const SNAPSHOT_DIR = path.join(__dirname, "visual-baselines.spec.ts-snapshots");

/** Per scene, not per platform: a freshly added scene must skip until
 * its own baseline is generated (via the CI dispatch or a local
 * UPDATE_VISUAL_BASELINES run), or adding a scene would fail every
 * runner that has baselines only for the older scenes. */
function sceneBaselineExists(name: string): boolean {
  return existsSync(
    path.join(SNAPSHOT_DIR, `${name}-chromium-${process.platform}.png`),
  );
}

/** Explicit opt-in for regeneration runs: Playwright's default
 * "missing" policy would otherwise silently write-and-pass on a
 * runner with no committed baselines, making the suite green while
 * comparing nothing. */
function updatingSnapshots(): boolean {
  return process.env.UPDATE_VISUAL_BASELINES === "1";
}

async function openPausedHolodeck(
  page: Page,
  scenario: string,
  gallerySet?: string,
): Promise<void> {
  await page.goto("/holodeck");
  await dismissReleaseNotes(page);
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 45_000 });
  await page.getByLabel("Scenario").selectOption(scenario);
  if (gallerySet) {
    await page.getByLabel("Block set").selectOption(gallerySet);
  }
  // Let the scene settle and shaders warm before freezing the frame.
  await page.waitForTimeout(2_000);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(600);
}

/**
 * Gallery scenes only, clipped to the block rows: the miner model runs
 * time-driven TSL emissives (chest screen scroll, visor breathing,
 * beacon blink) that never pixel-stabilize even while the rig is
 * paused, so any capture containing the bot fails Playwright's
 * stable-screenshot check. Block materials are the regression target
 * this suite exists for anyway. The clip excludes the bot on the left
 * and the settings panel top-right at the suite's 1280x720 viewport.
 */
const BLOCK_ROW_CLIP = { x: 250, y: 280, width: 770, height: 280 };

const SCENES: ReadonlyArray<{
  caseId: string;
  name: string;
  scenario: string;
  gallerySet?: string;
}> = [
  {
    caseId: "E2E-VISUAL-BASELINES-0001",
    name: "gallery-terrain",
    scenario: "block-gallery",
    gallerySet: "terrain",
  },
  {
    caseId: "E2E-VISUAL-BASELINES-0002",
    name: "gallery-ores-classic",
    scenario: "block-gallery",
    gallerySet: "ores-classic",
  },
];

for (const scene of SCENES) {
  test(
    `visual baseline: ${scene.name}`,
    ciCase(scene.caseId, "@visual"),
    async ({ page }) => {
      test.skip(
        !sceneBaselineExists(scene.name) && !updatingSnapshots(),
        "no committed baseline for this scene on this platform yet",
      );
      test.setTimeout(120_000);
      await openPausedHolodeck(page, scene.scenario, scene.gallerySet);
      await expect(page).toHaveScreenshot(`${scene.name}.png`, {
        clip: BLOCK_ROW_CLIP,
        // Software rasterizers dither slightly across driver updates; the
        // ratio is loose enough to absorb that and tight enough that a
        // material or lighting break (whole surfaces changing) still fails.
        maxDiffPixelRatio: 0.02,
        // Software-GL captures are slow; give the stability check room.
        timeout: 30_000,
      });
    },
  );
}

/** The banked-claim fixture the fp e2e suite drives: deterministic
 * footprint and parts, so the corridor spawn view depends only on the
 * scene's own materials, instancing, and lighting. */
const FP_BASELINE_VIEW = {
  bunker: {
    footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
    layoutVersion: 1,
    parts: [
      { partId: "wall-panel", col: START_COL - 3, row: 1, durability: 90 },
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
};

/** Down the open claim row from the spawn cell: hewn walls both
 * sides, the floor line, fog falloff, and the warm entry fill. The
 * spawn rock face itself is a near-black featureless plane, so the
 * along-row view is the one that can actually catch a material or
 * lighting break. The DOM hotbar and target label sit below the clip. */
const FP_CORRIDOR_CLIP = { x: 240, y: 120, width: 640, height: 400 };
const FP_CORRIDOR_YAW = 1.57;
const FP_CORRIDOR_PITCH = -0.2;

/**
 * First-person corridor from the fixed spawn cell: guards the fp rock
 * instancing, fog, and the corridor lighting (warm entry fill) against
 * silent regressions on the WebGL2 fallback. The aim is pinned through
 * the one-shot test hook so the capture never depends on spawn-default
 * drift.
 */
test(
  "visual baseline: bunker-fp-corridor",
  ciCase("E2E-VISUAL-BASELINES-0003", "@visual"),
  async ({ page }) => {
    test.skip(
      !sceneBaselineExists("bunker-fp-corridor") && !updatingSnapshots(),
      "no committed baseline for this scene on this platform yet",
    );
    test.setTimeout(180_000);
    await page.route("**/api/bunker", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FP_BASELINE_VIEW),
      });
    });
    // The progressive tutorial (F-097) is DOM chrome, not this scene's
    // subject: mark it done so its cards never drift into the clip.
    await page.addInitScript(() => {
      localStorage.setItem("vibebots-bunker-fp-tutorial-done", "1");
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
    await expect(status).toHaveAttribute("data-scene-painted", "true", {
      timeout: 45_000,
    });
    // Pin the aim: down the open claim row, slightly floorward.
    await page.evaluate(
      ([yaw, pitch]) => {
        (
          window as unknown as {
            __vibebotsFp?: { setYaw?: number; setPitch?: number };
          }
        ).__vibebotsFp = { setYaw: yaw, setPitch: pitch };
      },
      [FP_CORRIDOR_YAW, FP_CORRIDOR_PITCH] as const,
    );
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-fp-yaw")), {
        timeout: 10_000,
      })
      .toBeCloseTo(FP_CORRIDOR_YAW, 1);
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-fp-pitch")), {
        timeout: 10_000,
      })
      .toBeCloseTo(FP_CORRIDOR_PITCH, 1);
    // Let the compile-gated first frames and lighting settle.
    await page.waitForTimeout(2_000);
    await expect(page).toHaveScreenshot("bunker-fp-corridor.png", {
      clip: FP_CORRIDOR_CLIP,
      // Headless runs cannot hold pointer lock, so the resume hint stays
      // up mid-frame; mask it (DOM copy is not this baseline's subject).
      mask: [page.locator(".bunker-fp-resume-hint")],
      maxDiffPixelRatio: 0.02,
      timeout: 30_000,
    });
  },
);
