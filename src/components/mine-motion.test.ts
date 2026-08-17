import { describe, expect, it } from "vitest";
import {
  CHAIN_EASE_WEIGHT,
  CHAIN_GAP_SECONDS,
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

  it("treats a zero-length track as already complete", () => {
    const track = snapMotion(10, 3, -4, 0);
    expect(motionProgress(track, 10)).toBe(1);
    expect(sampleMotion(track, 10)).toEqual([3, -4]);
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

  it("chains a continuing step into a mostly-linear full-interval glide", () => {
    // Step 1: isolated tap, full ease, settles at 86% of the interval.
    const step1 = retargetMotion(null, 0, 0, 0, 1, 0, 0.533, 0.62);
    expect(step1.easeWeight).toBe(1);
    expect(step1.duration).toBe(0.533);
    // Step 2 fires one repeat interval later, same direction: the gap
    // since step 1 settled (87ms) is inside the chain window.
    const step2 = retargetMotion(step1, 0.62, 1, 0, 2, 0, 0.533, 0.62);
    expect(step2.easeWeight).toBe(CHAIN_EASE_WEIGHT);
    expect(step2.duration).toBe(0.62);
    // Mid-chain sampling is close to linear: a quarter of the time
    // covers nearly a quarter of the distance (full ease covered <25%).
    const [quarterX] = sampleMotion(step2, 0.62 + 0.155);
    expect(quarterX - 1).toBeGreaterThan(0.2);
    expect(quarterX - 1).toBeLessThan(0.25);
    // Step 3 continues seamlessly: step 2 ends exactly as it fires.
    const step3 = retargetMotion(step2, 1.24, 2, 0, 3, 0, 0.533, 0.62);
    expect(step3.easeWeight).toBe(CHAIN_EASE_WEIGHT);
  });

  it("does not chain direction changes or late taps", () => {
    const right = retargetMotion(null, 0, 0, 0, 1, 0, 0.533, 0.62);
    // Reversal: the next step heads the other way, ease fresh.
    const back = retargetMotion(right, 0.62, 1, 0, 0, 0, 0.533, 0.62);
    expect(back.easeWeight).toBe(1);
    expect(back.duration).toBe(0.533);
    // A tap long after the glide settled is isolated even if it
    // continues the same direction.
    const later = retargetMotion(
      right,
      0.533 + CHAIN_GAP_SECONDS + 0.05,
      1,
      0,
      2,
      0,
      0.533,
      0.62,
    );
    expect(later.easeWeight).toBe(1);
  });

  it("keeps full easing when no chain duration is offered", () => {
    const step1 = retargetMotion(null, 0, 0, 0, 1, 0, 0.28);
    const step2 = retargetMotion(step1, 0.3, 1, 0, 2, 0, 0.28);
    expect(step2.easeWeight).toBe(1);
    expect(step2.duration).toBe(0.28);
  });

  it("chains vertical climbs like lateral walks", () => {
    const up1 = retargetMotion(null, 0, 0, 0, 0, 1, 0.533, 0.62);
    const up2 = retargetMotion(up1, 0.62, 0, 1, 0, 2, 0.533, 0.62);
    expect(up2.easeWeight).toBe(CHAIN_EASE_WEIGHT);
    expect(up2.duration).toBe(0.62);
  });
});
