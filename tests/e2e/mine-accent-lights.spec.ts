import { expect, test } from "@playwright/test";
import { START_COL, setCell } from "../../src/sim/mine";
import { ciCase } from "./support/ci-case";
import {
  descendLadderShaft,
  dismissReleaseNotes,
  routeLadderShaftWorld,
} from "./support/mine-helpers";

/**
 * Accent-light pool contract (F-077): the local glow on emitters rides a
 * fixed pool of always-mounted point lights, so the scene's light count
 * never changes (a fluctuating count made three recompile every material
 * program: the 0.1.203 freeze class). The canvas exposes the number of
 * live slots as data-accent-lights; a planted warp beacon must claim one
 * as the miner nears it, and release it as the miner leaves.
 */

const BEACON_ROW = 8;

test(
  "a warp beacon claims an accent light only while nearby",
  ciCase("E2E-MINE-ACCENT-LIGHTS-0001", "@render"),
  async ({ page }) => {
    test.setTimeout(120_000);
    await routeLadderShaftWorld(page, 2026071103, 22, (mine) => {
      setCell(mine, START_COL, BEACON_ROW, {
        kind: "empty",
        ladder: true,
        beacon: true,
      });
    });
    await page.goto("/mine");
    await dismissReleaseNotes(page);

    const canvas = page.locator("canvas");
    // A missing attribute must read as failure (NaN), never as zero: the
    // initial poll would otherwise pass before the layout effect's first
    // write.
    const activeAccentLights = async () => {
      const value = await canvas.getAttribute("data-accent-lights");
      return value === null ? Number.NaN : Number(value);
    };
    // At the surface the beacon sits beyond the lantern window: every slot
    // is parked.
    await expect.poll(activeAccentLights).toBe(0);

    // Climbing to the beacon brings it into the window: one slot activates.
    await descendLadderShaft(page, BEACON_ROW);
    await expect.poll(activeAccentLights).toBe(1);

    // Descending far past the beacon (out of the ~8-row window above the
    // miner) parks the slot again; the pool always exists, so activation
    // and release never change the light count.
    await descendLadderShaft(page, 20);
    await expect.poll(activeAccentLights).toBe(0);
  },
);
