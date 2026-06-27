import { describe, expect, it } from "vitest";
import {
  FATAL_FALL_SECONDS_PER_ROW,
  fatalFallPlaybackSeconds,
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
});
