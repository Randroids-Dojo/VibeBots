import { expect, test } from "@playwright/test";
import { ciCase } from "./support/ci-case";
import {
  awaitMineSceneReady,
  dismissReleaseNotes,
} from "./support/mine-helpers";

// F-127 load stress smoke.
//
// The critical smoke "mine actions begin immediately and settle smoothly"
// flaked in CI, not because input dropped, but because it polled the ANIMATED
// data-miner-x on 1-2s budgets. Under CI load a single Playwright round-trip
// costs 1-6 seconds, dominated by the retry's per-action DOM snapshot
// serialization against the full-suite DOM and hardware, so the poll deadline
// passed before the matcher evaluated the already-correct value (verified from
// CI trace 8301188352). The fix proves each action through the authoritative,
// discrete data-horizontal-distance store signal.
//
// Honest scope of THIS guard: it exercises the acceptance-first input and
// readiness path under a CDP CPU throttle. It is NOT a red-green regression
// for the harness structure: the CI failure is a trace-snapshot latency race
// that a CDP throttle on a fast machine with a fresh DOM does not reproduce
// (the old tight-poll structure still passed locally at 8x, 12x, and 16x, with
// and without trace). Its value is catching a PRODUCT regression that breaks
// mine input under CPU starvation, and documenting the robust acceptance-first
// pattern. The definitive evidence that the structure is the fix is the CI
// trace analysis recorded on F-127, not this test.
//
// The throttle slows the flow only modestly (much of load is rendering and I/O,
// not JS main-thread), so it runs in about 18s at 8x and keeps the default 60s
// bound. It runs only in the full E2E matrix (its title is outside the
// critical-shard grep). F127_THROTTLE overrides the slowdown multiplier.

const THROTTLE = Number(process.env.F127_THROTTLE ?? "8");

test(
  "mine input registers under CPU starvation (F-127)",
  ciCase("E2E-MINE-CORE-THROTTLED-0001", "@soak"),
  async ({ page }) => {
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
      // Canvas readiness: it exposes a numeric miner position.
      await expect(canvas).toHaveAttribute("data-miner-x", /^-?\d/, {
        timeout: 20_000,
      });
    });

    const initialX = Number(await canvas.getAttribute("data-miner-x"));
    const initialDistance = Number(
      await status.getAttribute("data-horizontal-distance"),
    );

    await test.step("ArrowRight registers and glides under throttle", async () => {
      await page.keyboard.press("ArrowRight");
      // Acceptance through the discrete store signal, correct on the next commit
      // and stable, on a budget that absorbs the throttled round-trip latency.
      await expect(status).toHaveAttribute(
        "data-horizontal-distance",
        String(initialDistance + 1),
        { timeout: 20_000 },
      );
      // Smooth motion (not a snap): at least one in-flight frame.
      await expect
        .poll(
          async () =>
            Number(await canvas.getAttribute("data-miner-motion-frames")),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
      // The rendered miner glides to and rests at the new column.
      await expect
        .poll(async () => Number(await canvas.getAttribute("data-miner-x")), {
          timeout: 20_000,
        })
        .toBeGreaterThan(initialX + 0.85);
    });

    await test.step("a second ArrowRight also registers", async () => {
      await page.waitForTimeout(700);
      await page.keyboard.press("ArrowRight");
      await expect(status).toHaveAttribute(
        "data-horizontal-distance",
        String(initialDistance + 2),
        { timeout: 20_000 },
      );
    });
  },
);
