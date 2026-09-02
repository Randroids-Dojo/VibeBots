import { describe, expect, it } from "vitest";
import {
  advance,
  DISSOLVE_SECONDS,
  decay,
  dissolveOpacity,
  dissolveScale,
  dissolveSink,
  ghostOpacity,
  MOUNT_SECONDS,
  PULSE_SECONDS,
  SPARK_COUNT,
  SPARK_SECONDS,
  smoothstep,
  snapScale,
  sparkDirections,
  sparkDrop,
  sparkScale,
  sparkTravel,
} from "./workshop-animation";

describe("workshop bench animation curves", () => {
  it("smoothsteps with clamped, eased ends", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(-2)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    // Eased: a quarter in covers less than a quarter of the rise.
    expect(smoothstep(0.25)).toBeLessThan(0.25);
  });

  it("pops a part in from small and settles to exactly 1", () => {
    // Freshly mounted, no pulse: small.
    expect(snapScale(0, 0)).toBeCloseTo(0.4);
    // Fully mounted, no pulse: exactly full size.
    expect(snapScale(1, 0)).toBeCloseTo(1);
    // Mid-mount grows monotonically.
    expect(snapScale(0.5, 0)).toBeGreaterThan(snapScale(0.25, 0));
    // A live merge pulse overshoots past 1, then settles as it decays. The
    // pulse (K) is punchy: a full pulse reads as a clear ~30% bump.
    expect(snapScale(1, 1)).toBeCloseTo(1.3);
    expect(snapScale(1, 1)).toBeGreaterThan(1.2);
    expect(snapScale(1, 0)).toBeCloseTo(1);
  });

  it("breathes ghost opacity within a subtle band", () => {
    for (const t of [0, 0.3, 0.7, 1.1, 2.5, 4.2]) {
      const o = ghostOpacity(t);
      expect(o).toBeGreaterThanOrEqual(0.28 - 1e-9);
      expect(o).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  it("dissolves a removed part smaller, fainter, and lower until gone", () => {
    expect(dissolveScale(0)).toBeCloseTo(1);
    expect(dissolveOpacity(0)).toBeCloseTo(1);
    expect(dissolveSink(0)).toBeCloseTo(0);
    expect(dissolveScale(1)).toBeCloseTo(0.2);
    expect(dissolveOpacity(1)).toBeCloseTo(0);
    expect(dissolveSink(1)).toBeCloseTo(0.12);
    let last = dissolveScale(0);
    for (const t of [0.2, 0.4, 0.6, 0.8, 1]) {
      const next = dissolveScale(t);
      expect(next).toBeLessThan(last);
      last = next;
    }
    expect(DISSOLVE_SECONDS).toBeGreaterThan(0.15);
    expect(DISSOLVE_SECONDS).toBeLessThan(0.5);
  });

  it("bursts sparks evenly upward, deterministically, and fades them out", () => {
    const dirs = sparkDirections();
    expect(dirs).toHaveLength(SPARK_COUNT);
    for (const d of dirs) {
      expect(d.y).toBeGreaterThan(0.2);
      expect(d.y).toBeLessThan(1);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    }
    expect(sparkDirections()).toEqual(dirs);
    // Spread: not all sparks lean the same way.
    const meanX = dirs.reduce((sum, d) => sum + d.x, 0) / dirs.length;
    expect(Math.abs(meanX)).toBeLessThan(0.3);
    expect(sparkTravel(0)).toBe(0);
    expect(sparkTravel(1)).toBeGreaterThan(sparkTravel(0.5));
    expect(sparkDrop(1)).toBeGreaterThan(sparkDrop(0.5));
    expect(sparkScale(0)).toBeGreaterThan(sparkScale(0.5));
    expect(sparkScale(1)).toBe(0);
    expect(SPARK_SECONDS).toBeLessThan(1);
  });

  it("advances toward 1 and decays toward 0, both clamped", () => {
    expect(advance(0, MOUNT_SECONDS, MOUNT_SECONDS)).toBe(1);
    expect(advance(0.9, 1, MOUNT_SECONDS)).toBe(1);
    expect(advance(0, MOUNT_SECONDS / 2, MOUNT_SECONDS)).toBeCloseTo(0.5);
    expect(decay(1, PULSE_SECONDS, PULSE_SECONDS)).toBe(0);
    expect(decay(0.1, 1, PULSE_SECONDS)).toBe(0);
    expect(decay(1, PULSE_SECONDS / 2, PULSE_SECONDS)).toBeCloseTo(0.5);
  });
});
