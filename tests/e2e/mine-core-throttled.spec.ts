import { expect, test } from "@playwright/test";
import {
  awaitMineSceneReady,
  dismissReleaseNotes,
} from "./support/mine-helpers";

// F-127 regression guard.
//
// The critical smoke "mine actions begin immediately and settle smoothly"
// flaked in CI because it polled the ANIMATED data-miner-x on a 1-2s budget.
// Under load a single Playwright round-trip (getAttribute / keyboard press /
// screenshot) runs 1-6 seconds, because the retry captures a DOM snapshot per
// action, so the poll's deadline expired before the matcher evaluated the
// already-correct value (verified from CI trace 8301188352: after ArrowRight
// the snapshot already read data-miner-x=1.00, yet the first poll getAttribute
// ran ~1.6s and the 2s deadline passed before delivery). The input never
// dropped; the harness deadline did.
//
// This guard throttles the browser CPU so every round-trip runs seconds long,
// then proves the acceptance-first pattern survives: the authoritative,
// discrete, immediately-correct store signal data-horizontal-distance
// (miner.col - START_COL) on a budget that absorbs the per-op latency. A
// revert to the old tight animated-position poll would flake here.
//
// It is intentionally CPU-throttled and therefore slow, so it runs only in the
// full E2E matrix (its title is outside the critical-shard grep) with an
// extended per-test timeout. F127_THROTTLE overrides the slowdown multiplier.

const THROTTLE = Number(process.env.F127_THROTTLE ?? "8");

test("mine input registers under CPU starvation (F-127 regression)", async ({
  page,
}) => {
  // The throttle makes the whole flow legitimately exceed the default 60s cap;
  // this is deliberate simulated load, not a slow product.
  test.setTimeout(150_000);

  const client = await page.context().newCDPSession(page);
  if (THROTTLE > 1) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  }

  const canvas = page.locator("canvas");
  const status = page.getByLabel("Mine status");

  await test.step("mine loads and paints under throttle", async () => {
    await page.goto("/mine");
    await dismissReleaseNotes(page);
    await awaitMineSceneReady(page);
    await expect(status).toHaveAttribute("data-scene-painted", "true", {
      timeout: 40_000,
    });
  });

  const initialX = Number(await canvas.getAttribute("data-miner-x"));
  const initialDistance = Number(
    await status.getAttribute("data-horizontal-distance"),
  );

  await test.step("ArrowRight registers via the authoritative store signal", async () => {
    await page.keyboard.press("ArrowRight");
    // The discrete store distance advances one column on the next commit and
    // stays there; a generous budget passes on the first successful read even
    // when each getAttribute round-trip runs seconds long under the throttle.
    await expect(status).toHaveAttribute(
      "data-horizontal-distance",
      String(initialDistance + 1),
      { timeout: 30_000 },
    );
    // The rendered miner glides to and rests at the new column.
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
        timeout: 30_000,
      })
      .toBeGreaterThan(initialX + 0.85);
  });

  await test.step("a second ArrowRight also registers", async () => {
    await page.waitForTimeout(700);
    await page.keyboard.press("ArrowRight");
    await expect(status).toHaveAttribute(
      "data-horizontal-distance",
      String(initialDistance + 2),
      { timeout: 30_000 },
    );
  });
});
