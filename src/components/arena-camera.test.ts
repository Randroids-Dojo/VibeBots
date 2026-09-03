import { describe, expect, it } from "vitest";
import {
  ARENA_PORTRAIT_ASPECT,
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
    // Broadcast framing keeps the rig lower and closer than the old
    // establishing shot; height still scales up with separation.
    expect(frame.height).toBeGreaterThan(3);
    expect(frame.height).toBeLessThan(7.6);
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

  it("frames over the player's shoulder on a portrait viewport (F-245)", () => {
    const bounds = emptyArenaCameraBounds();
    includeArenaCameraPoint(bounds, -4, 1, -1, 1);
    includeArenaCameraPoint(bounds, 6, 1, 3, 1);
    const centers: [{ x: number; z: number }, { x: number; z: number }] = [
      { x: -4, z: -1 },
      { x: 6, z: 3 },
    ];
    const landscape = arenaCameraFrameForBounds(bounds, centers, 16 / 9);
    const portrait = arenaCameraFrameForBounds(bounds, centers, 390 / 760);
    // Landscape looks across the line; portrait looks along it, from
    // behind bot 1 (the player's), a quarter turn away.
    const alongLine = Math.atan2(6 - -4, 3 - -1);
    expect(landscape.yaw).toBeCloseTo(alongLine + Math.PI / 2);
    expect(portrait.yaw).toBeCloseTo(alongLine);
    // And from closer and higher, so the fight fills a tall screen.
    expect(portrait.distance).toBeLessThan(landscape.distance);
    expect(portrait.height).toBeGreaterThan(landscape.height);
    expect(portrait.targetX).toBeCloseTo(landscape.targetX);
    expect(portrait.targetZ).toBeCloseTo(landscape.targetZ);
    // A square-or-wider viewport keeps the broadside shot.
    expect(arenaCameraFrameForBounds(bounds, centers, 1).yaw).toBeCloseTo(
      landscape.yaw,
    );
    expect(ARENA_PORTRAIT_ASPECT).toBe(1);
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
