import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { dismissReleaseNotes } from "./support/mine-helpers";

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

function platformBaselinesExist(): boolean {
  if (!existsSync(SNAPSHOT_DIR)) return false;
  const suffix = `-${process.platform}.png`;
  return readdirSync(SNAPSHOT_DIR).some((file) => file.endsWith(suffix));
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
  name: string;
  scenario: string;
  gallerySet?: string;
}> = [
  { name: "gallery-terrain", scenario: "block-gallery", gallerySet: "terrain" },
  {
    name: "gallery-ores-classic",
    scenario: "block-gallery",
    gallerySet: "ores-classic",
  },
];

for (const scene of SCENES) {
  test(`visual baseline: ${scene.name}`, async ({ page }) => {
    test.skip(
      !platformBaselinesExist() && !updatingSnapshots(),
      "no committed visual baselines for this platform yet",
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
  });
}
