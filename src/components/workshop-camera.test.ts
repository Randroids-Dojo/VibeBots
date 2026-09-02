import { describe, expect, it } from "vitest";
import {
  boundsCenter,
  DEFAULT_CAMERA_OFFSET,
  defaultCameraPosition,
  FRAME_TOWARD_PART,
  frameTarget,
  glideFraction,
  isSettled,
} from "./workshop-camera";

describe("workshop camera framing", () => {
  it("defaults to the front three-quarter: the -z side every core faces", () => {
    expect(DEFAULT_CAMERA_OFFSET.z).toBeLessThan(0);
    expect(DEFAULT_CAMERA_OFFSET.y).toBeGreaterThan(0);
    expect(DEFAULT_CAMERA_OFFSET.x).not.toBe(0);
  });

  it("centres the bounds of the given corners, or the origin when empty", () => {
    expect(boundsCenter([])).toEqual({ x: 0, y: 0, z: 0 });
    // A core at the origin and a wheel hung off its right axle: the centre
    // shifts toward the wheel by half the reach past the core's edge.
    const center = boundsCenter([
      { x: -0.3, y: -0.3, z: -0.3 },
      { x: 0.3, y: 0.3, z: 0.3 },
      { x: 0.39, y: -0.34, z: -0.34 },
      { x: 0.55, y: 0.34, z: 0.34 },
    ]);
    expect(center.x).toBeCloseTo(0.125, 6);
    expect(center.y).toBeCloseTo(0, 6);
    expect(center.z).toBeCloseTo(0, 6);
  });

  it("frames most of the way toward a tapped part, and the centre without one", () => {
    const center = { x: 0, y: 0, z: 0 };
    const part = { x: 1, y: 0.5, z: -2 };
    const framed = frameTarget(center, part);
    expect(framed.x).toBeCloseTo(FRAME_TOWARD_PART, 6);
    expect(framed.y).toBeCloseTo(0.5 * FRAME_TOWARD_PART, 6);
    expect(framed.z).toBeCloseTo(-2 * FRAME_TOWARD_PART, 6);
    // Not all the way: the rest of the bot must stay in shot.
    expect(FRAME_TOWARD_PART).toBeGreaterThan(0.5);
    expect(FRAME_TOWARD_PART).toBeLessThan(1);
    expect(frameTarget(center, null)).toEqual(center);
    expect(frameTarget({ x: 0.2, y: 0, z: 0 }, null)).toEqual({
      x: 0.2,
      y: 0,
      z: 0,
    });
  });

  it("puts the recentred camera at the default offset from the target", () => {
    const target = { x: 0.1, y: 0.2, z: 0.3 };
    expect(defaultCameraPosition(target)).toEqual({
      x: 0.1 + DEFAULT_CAMERA_OFFSET.x,
      y: 0.2 + DEFAULT_CAMERA_OFFSET.y,
      z: 0.3 + DEFAULT_CAMERA_OFFSET.z,
    });
  });

  it("glides frame-rate independently and never overshoots", () => {
    const one = glideFraction(1 / 60);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1);
    // Two half-frames compound to the same distance as one whole frame.
    const half = glideFraction(1 / 120);
    const twoHalves = 1 - (1 - half) * (1 - half);
    expect(twoHalves).toBeCloseTo(one, 9);
    // About 95% of the way in half a second at the default rate.
    expect(glideFraction(0.5)).toBeGreaterThan(0.94);
    expect(glideFraction(0.5)).toBeLessThan(0.96);
    // A stalled or negative frame delta moves nothing.
    expect(glideFraction(0)).toBe(0);
    expect(glideFraction(-1)).toBe(0);
    expect(glideFraction(Number.NaN)).toBe(0);
  });

  it("settles inside the epsilon and not outside it", () => {
    const a = { x: 0, y: 0, z: 0 };
    expect(isSettled(a, { x: 0.001, y: 0, z: 0 })).toBe(true);
    expect(isSettled(a, { x: 0.01, y: 0, z: 0 })).toBe(false);
    expect(isSettled(a, { x: 0.5, y: 0, z: 0 }, 1)).toBe(true);
  });
});
