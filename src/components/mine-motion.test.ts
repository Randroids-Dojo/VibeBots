import { describe, expect, it } from "vitest";
import {
  motionProgress,
  retargetMotion,
  sampleMotion,
  snapMotion,
} from "./mine-motion";

describe("mine motion tracks", () => {
  it("snaps a track already at its target", () => {
    const track = snapMotion(10, 3, -4, 0.3);
    expect(sampleMotion(track, 10)).toEqual([3, -4]);
    expect(sampleMotion(track, 11)).toEqual([3, -4]);
    expect(motionProgress(track, 10.15)).toBeCloseTo(0.5);
  });

  it("eases between endpoints and clamps outside the window", () => {
    const track = retargetMotion(null, 0, 0, 0, 10, -10, 1);
    expect(sampleMotion(track, 0)).toEqual([0, 0]);
    expect(sampleMotion(track, 1)).toEqual([10, -10]);
    expect(sampleMotion(track, 5)).toEqual([10, -10]);
    const [midX, midY] = sampleMotion(track, 0.5);
    expect(midX).toBeCloseTo(5);
    expect(midY).toBeCloseTo(-5);
    // Eased, not linear: a quarter of the time covers less than a
    // quarter of the distance.
    const [quarterX] = sampleMotion(track, 0.25);
    expect(quarterX).toBeGreaterThan(0);
    expect(quarterX).toBeLessThan(2.5);
  });

  it("keeps a live track when the target is unchanged", () => {
    const track = retargetMotion(null, 0, 0, 0, 5, 5, 1);
    const same = retargetMotion(track, 0.4, 2, 2, 5, 5, 1);
    expect(same).toBe(track);
    const rebased = retargetMotion(track, 0.4, 2, 2, 8, 5, 1);
    expect(rebased).not.toBe(track);
    expect(rebased.fromX).toBe(2);
    expect(rebased.startedAt).toBe(0.4);
  });
});
