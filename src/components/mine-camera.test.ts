import { describe, expect, it } from "vitest";
import { DEFAULT_GEAR, LANTERN_RADIUS } from "@/sim/mine";
import {
  clampMineCameraZoom,
  MINE_CAMERA_BASE_DISTANCE,
  MINE_CAMERA_BUTTON_STEP,
  maxMineCameraZoom,
  maxMineCameraZoomForRadius,
  mineDarknessOpacity,
  mineLampDistanceForRadius,
  mineProjectedVisibilityRadius,
  mineRenderWindow,
  mineVisibilityOpacity,
} from "./mine-camera";

const MINE_CAMERA_FOV_DEGREES = 42;
const PHONE_PORTRAIT_ASPECT = 390 / 844;

function visibleDiagonalAtZoom(zoom: number): number {
  const halfHeight =
    Math.tan((MINE_CAMERA_FOV_DEGREES * Math.PI) / 360) *
    MINE_CAMERA_BASE_DISTANCE *
    zoom;
  const halfWidth = halfHeight * PHONE_PORTRAIT_ASPECT;
  return Math.hypot(halfHeight, halfWidth);
}

describe("mine camera zoom", () => {
  it("caps zoom-out by lantern reach", () => {
    const zoomCaps = LANTERN_RADIUS.map((_, index) =>
      maxMineCameraZoom({ ...DEFAULT_GEAR, lantern: index + 1 }),
    );
    const maxLanternRadius =
      LANTERN_RADIUS[LANTERN_RADIUS.length - 1] ?? LANTERN_RADIUS[0];

    expect(MINE_CAMERA_BUTTON_STEP).toBe(0.16);
    expect(zoomCaps[0]).toBeCloseTo(1.32);
    expect(zoomCaps[1]).toBeCloseTo(1.64);
    expect(zoomCaps[2]).toBeCloseTo(1.96);
    for (let index = 1; index < zoomCaps.length; index += 1) {
      expect(zoomCaps[index] - zoomCaps[index - 1]).toBeCloseTo(0.32);
    }
    expect(zoomCaps.at(-1)).toBeCloseTo(
      maxMineCameraZoomForRadius(maxLanternRadius),
    );
    expect(clampMineCameraZoom(99, DEFAULT_GEAR)).toBe(zoomCaps[0]);
    expect(
      clampMineCameraZoom(99, {
        ...DEFAULT_GEAR,
        lantern: LANTERN_RADIUS.length,
      }),
    ).toBe(zoomCaps.at(-1));
  });

  it("renders real mine cells through the lantern falloff band", () => {
    expect(mineRenderWindow({ ...DEFAULT_GEAR, lantern: 1 }, 1).below).toBe(6);
    expect(mineRenderWindow({ ...DEFAULT_GEAR, lantern: 2 }, 1.1).below).toBe(
      7,
    );
    expect(mineRenderWindow({ ...DEFAULT_GEAR, lantern: 3 }, 1.3).below).toBe(
      9,
    );
  });

  it("brightens the full lantern range as lanterns upgrade", () => {
    const lampDistances = LANTERN_RADIUS.map((radius) =>
      mineLampDistanceForRadius(radius),
    );
    const zoomCaps = LANTERN_RADIUS.map((_, index) =>
      maxMineCameraZoom({ ...DEFAULT_GEAR, lantern: index + 1 }),
    );

    expect(lampDistances[0]).toBe(9);
    for (let index = 1; index < lampDistances.length; index += 1) {
      expect(lampDistances[index] - lampDistances[index - 1]).toBeGreaterThan(
        2,
      );
    }
    for (let index = 0; index < lampDistances.length; index += 1) {
      expect(lampDistances[index]).toBeGreaterThan(
        visibleDiagonalAtZoom(zoomCaps[index]),
      );
    }
  });

  it("renders the lantern falloff at every zoom (F-055, F-065)", () => {
    // Cells inside the lantern circle stay fully lit.
    expect(mineDarknessOpacity(0)).toBe(0);
    // Cells past the lantern fade to the dark cap, and the falloff no
    // longer waits for the zoom-out cap: the same edge cell is obscured
    // whether the player is zoomed in or out.
    expect(mineDarknessOpacity(1)).toBeCloseTo(0.6);
    expect(mineDarknessOpacity(2)).toBeCloseTo(0.88);
    // The ramp is monotonic and saturates at the far cap.
    expect(mineDarknessOpacity(0.5)).toBeGreaterThan(mineDarknessOpacity(0));
    expect(mineDarknessOpacity(4)).toBeCloseTo(0.88);
  });

  it("keeps the lantern footprint stable while zooming out", () => {
    expect(mineProjectedVisibilityRadius(3, 0.72)).toBe(3);
    expect(mineProjectedVisibilityRadius(3, 1)).toBe(3);
    expect(mineProjectedVisibilityRadius(3, 1.32)).toBeCloseTo(3.96);
    expect(mineProjectedVisibilityRadius(5, 1.64)).toBeCloseTo(8.2);
  });

  it("lets daylight lift only the surface visibility mask", () => {
    expect(mineVisibilityOpacity(2, 0, 0)).toBe(0);
    expect(mineVisibilityOpacity(2, 0, 0.5)).toBeCloseTo(0.44);
    expect(mineVisibilityOpacity(2, 0, 1)).toBeCloseTo(0.88);
    expect(mineVisibilityOpacity(2, 1, 0)).toBeCloseTo(0.88);
    expect(mineVisibilityOpacity(2, 8, 1)).toBeCloseTo(0.88);
  });
});
