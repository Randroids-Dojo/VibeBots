import { expect, type Page, test } from "@playwright/test";
import {
  descendLadderShaft,
  dismissReleaseNotes,
  MINE_KEY_STEP_MS,
  pressMineKey,
  routeLadderShaftWorld,
} from "./support/mine-helpers";

/**
 * Stratum crossings must not rebuild shader programs (the 0.1.206 field
 * regression: swapping the scene fog/background objects per stratum
 * rekeyed the node cache and recompiled every visible pipeline, a 2-3 s
 * frame per crossing on phones). Headless Chromium runs the same WebGL2
 * fallback path as the phone, so counting createProgram calls catches
 * the churn regardless of how fast this machine compiles.
 */

declare global {
  interface Window {
    __programCreates?: number;
  }
}

async function programCreates(page: Page): Promise<number> {
  return page.evaluate(() => window.__programCreates ?? 0);
}

/** Wait until no new programs have been created for a quiet period. */
async function settledProgramCount(page: Page): Promise<number> {
  let last = await programCreates(page);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const next = await programCreates(page);
    if (next === last) return next;
    last = next;
  }
  return last;
}

async function climbTo(page: Page, depth: number): Promise<void> {
  const status = page.getByLabel("Mine status");
  for (let i = 0; i < 40; i++) {
    if (Number(await status.getAttribute("data-depth")) <= depth) return;
    await pressMineKey(page, "ArrowUp");
    await page.waitForTimeout(MINE_KEY_STEP_MS);
  }
}

test("stratum crossings do not recompile shader programs", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    window.__programCreates = 0;
    const wrap = (proto: {
      createProgram: (this: unknown) => WebGLProgram;
    }) => {
      const original = proto.createProgram;
      proto.createProgram = function (this: unknown) {
        window.__programCreates = (window.__programCreates ?? 0) + 1;
        return original.call(this);
      };
    };
    wrap(WebGL2RenderingContext.prototype);
  });
  await routeLadderShaftWorld(page, 2026071101, 30);
  await page.goto("/mine");
  await dismissReleaseNotes(page);

  // Let the material warm-up finish: the load pays every compile once.
  const warmed = await settledProgramCount(page);
  expect(warmed).toBeGreaterThan(0);

  // First crossing of the Clay Beds boundary (row 12) may create a few
  // programs for brand-new grid buckets (each InstancedMesh gets unique
  // shader source, so no warm list can cover them), but those compile in
  // the background on the grid's pending layer, never as a frame stall,
  // and never as the whole pipeline set (the fog-object rekey recompiled
  // ~60 programs here).
  await descendLadderShaft(page, 16);
  const afterFirstCrossing = await settledProgramCount(page);
  console.log(
    `programs: warmed=${warmed} firstCrossingDelta=${afterFirstCrossing - warmed}`,
  );
  expect(afterFirstCrossing - warmed).toBeLessThanOrEqual(3);

  // Re-crossing the same boundary in both directions must be free: the
  // 0.1.206 regression recompiled the full pipeline set on EVERY pass.
  await climbTo(page, 8);
  await descendLadderShaft(page, 16);
  await climbTo(page, 8);
  const afterRecrossings = await settledProgramCount(page);
  console.log(
    `programs: recrossingsDelta=${afterRecrossings - afterFirstCrossing}`,
  );
  expect(afterRecrossings - afterFirstCrossing).toBeLessThanOrEqual(2);
});
