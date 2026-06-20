import { describe, expect, it } from "vitest";
import {
  arenaCameraBoundsCenter,
  arenaCameraFrameForBounds,
  emptyArenaCameraBounds,
  includeArenaCameraBounds,
  includeArenaCameraPoint,
} from "./arena-camera";

describe("arena camera framing", () => {
  it("targets the midpoint between the visible bots", () => {
    const bounds = emptyArenaCameraBounds();
    includeArenaCameraPoint(bounds, -4, 1, -1, 1);
    includeArenaCameraPoint(bounds, 6, 1, 3, 1);

    const frame = arenaCameraFrameForBounds(bounds, [
      { x: -4, z: -1 },
      { x: 6, z: 3 },
    ]);

    expect(frame.targetX).toBeCloseTo(1);
    expect(frame.targetZ).toBeCloseTo(1);
    expect(frame.height).toBeGreaterThan(5);
  });

  it("combines bounds and exposes their center", () => {
    const left = emptyArenaCameraBounds();
    const right = emptyArenaCameraBounds();
    const combined = emptyArenaCameraBounds();
    includeArenaCameraPoint(left, -4, 1, -2, 1);
    includeArenaCameraPoint(right, 8, 3, 4, 2);

    includeArenaCameraBounds(combined, left);
    includeArenaCameraBounds(combined, right);

    expect(arenaCameraBoundsCenter(combined)).toEqual({
      x: 2.5,
      y: 2.5,
      z: 1.5,
    });
  });

  it("backs up when the bots spread apart", () => {
    const closeBounds = emptyArenaCameraBounds();
    includeArenaCameraPoint(closeBounds, -1, 1, 0, 1);
    includeArenaCameraPoint(closeBounds, 1, 1, 0, 1);

    const wideBounds = emptyArenaCameraBounds();
    includeArenaCameraPoint(wideBounds, -10, 1, -4, 1);
    includeArenaCameraPoint(wideBounds, 10, 1, 4, 1);

    const close = arenaCameraFrameForBounds(closeBounds, [
      { x: -1, z: 0 },
      { x: 1, z: 0 },
    ]);
    const wide = arenaCameraFrameForBounds(wideBounds, [
      { x: -10, z: -4 },
      { x: 10, z: 4 },
    ]);

    expect(wide.distance).toBeGreaterThan(close.distance);
    expect(wide.height).toBeGreaterThan(close.height);
  });
});
