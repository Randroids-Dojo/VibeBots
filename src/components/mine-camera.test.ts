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
  mineRenderWindow,
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
    expect(mineRenderWindow({ ...DEFAULT_GEAR, lantern: 1 }, 1).below).toBe(5);
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

  it("only renders falloff after zoom reaches the lantern cap", () => {
    const defaultEdge = mineDarknessOpacity(2, 1, 1.32);
    const availableZoomEdge = mineDarknessOpacity(2, 1.16, 1.32);
    const zoomedEdge = mineDarknessOpacity(2, 1.32, 1.32);
    const zoomedNear = mineDarknessOpacity(1, 1.32, 1.32);

    expect(defaultEdge).toBe(0);
    expect(availableZoomEdge).toBe(0);
    expect(zoomedEdge).toBeCloseTo(0.57);
    expect(zoomedNear).toBeCloseTo(0.445);
  });
});
