import { describe, expect, it } from "vitest";
import {
  CRUSH_REPORT_AFTER_IMPACT_MS,
  clearMsAfterImpact,
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
