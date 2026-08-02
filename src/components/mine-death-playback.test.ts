import { describe, expect, it } from "vitest";
import { DEFAULT_GEAR, LANTERN_RADIUS } from "@/sim/mine";
import {
  clampMineCameraZoom,
  maxMineCameraZoom,
  mineRenderWindow,
} from "./mine-camera";
import {
  CRUSH_REPORT_AFTER_IMPACT_MS,
  clearMsAfterImpact,
  FALL_ANCHOR_STEP_ROWS,
  FALL_REPORT_AFTER_IMPACT_MS,
  FATAL_FALL_SECONDS_PER_ROW,
  fatalFallPlaybackSeconds,
  POWER_DOWN_HOLD_SECONDS,
  POWER_DOWN_REPORT_AFTER_IMPACT_MS,
  wreckReportCeilingMs,
} from "./mine-death-playback";

describe("mine death playback", () => {
  it("scales fatal-fall playback with the full fall distance", () => {
    expect(fatalFallPlaybackSeconds(1)).toBe(0.42);
    expect(fatalFallPlaybackSeconds(8)).toBeCloseTo(
      8 * FATAL_FALL_SECONDS_PER_ROW,
    );
    expect(fatalFallPlaybackSeconds(40)).toBeCloseTo(
      40 * FATAL_FALL_SECONDS_PER_ROW,
    );
  });

  it("scales the report ceiling with the fall length", () => {
    // Crushes carry no fall distance; the ceiling still covers the
    // minimum playback plus the 4s canvas-dead allowance.
    expect(wreckReportCeilingMs(undefined)).toBe(4420);
    expect(wreckReportCeilingMs(0)).toBe(4420);
    // Short falls stay at the floor; long falls extend the ceiling past
    // their own playback time so a healthy canvas always lands first.
    expect(wreckReportCeilingMs(3)).toBe(4420);
    expect(wreckReportCeilingMs(40)).toBe(8400);
    expect(wreckReportCeilingMs(40)).toBeGreaterThan(
      fatalFallPlaybackSeconds(40) * 1000,
    );
  });

  it("keeps the impact-relative clear window past the report delay", () => {
    // The wreck must stay on camera until after the report lands.
    expect(clearMsAfterImpact({ kind: "fall" })).toBeGreaterThan(
      FALL_REPORT_AFTER_IMPACT_MS,
    );
    expect(clearMsAfterImpact({ kind: "crush" })).toBeGreaterThan(
      CRUSH_REPORT_AFTER_IMPACT_MS,
    );
  });

  // The render window is one band of rows around an anchor, and a fatal
  // fall is longer than that band is tall. Anchoring on the death row for
  // the whole playback culled every row above `toRow - above`, which read
  // on a phone as the top few rows of dirt vanishing mid-fall. The anchor
  // walks down instead, and every step has to land inside rows that are
  // already loaded, or the void just moves.
  it("re-anchors the fall window before the bot outruns the loaded rows", () => {
    const gears = LANTERN_RADIUS.map((_, index) => ({
      ...DEFAULT_GEAR,
      lantern: index + 1,
    }));
    for (const gear of gears) {
      const zooms = [
        clampMineCameraZoom(0, gear),
        1,
        maxMineCameraZoom(gear),
      ];
      for (const zoom of zooms) {
        const { above, below } = mineRenderWindow(gear, zoom);
        // The rows the bot falls into during one step are already drawn.
        expect(FALL_ANCHOR_STEP_ROWS).toBeLessThan(below);
        // And the rows it just left stay drawn, so the shaft above the bot
        // never blanks between steps.
        expect(FALL_ANCHOR_STEP_ROWS).toBeLessThan(above);
      }
    }
  });

  it("keeps re-anchoring rarer than the frames it runs on", () => {
    // The anchor advance runs every frame but only re-renders on a step,
    // so a step must cover many frames. At the slowest fall (one row per
    // FATAL_FALL_SECONDS_PER_ROW) a step is this many seconds apart.
    const secondsPerStep = FALL_ANCHOR_STEP_ROWS * FATAL_FALL_SECONDS_PER_ROW;
    expect(secondsPerStep).toBeGreaterThan(0.25);
    // A long fall still re-renders a bounded number of times.
    expect(Math.ceil(120 / FALL_ANCHOR_STEP_ROWS)).toBeLessThanOrEqual(30);
  });

  it("holds the powered-down wreck past its report delay (F-058)", () => {
    // The out-of-battery slump stays on camera until after the report
    // lands, the same contract fall and crush keep.
    expect(clearMsAfterImpact({ kind: "powerdown" })).toBeGreaterThan(
      POWER_DOWN_REPORT_AFTER_IMPACT_MS,
    );
    expect(clearMsAfterImpact({ kind: "powerdown" })).toBeGreaterThan(
      POWER_DOWN_HOLD_SECONDS * 1000,
    );
  });
});
