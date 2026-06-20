import { describe, expect, it } from "vitest";
import { DEFAULT_GEAR, LANTERN_RADIUS } from "@/sim/mine";
import {
  clampMineCameraZoom,
  maxMineCameraZoom,
  maxMineCameraZoomForRadius,
  mineLampDistanceForRadius,
  mineRenderWindow,
} from "./mine-camera";

describe("mine camera zoom", () => {
  it("caps zoom-out by lantern reach", () => {
    const zoomCaps = LANTERN_RADIUS.map((_, index) =>
      maxMineCameraZoom({ ...DEFAULT_GEAR, lantern: index + 1 }),
    );
    const maxLanternRadius =
      LANTERN_RADIUS[LANTERN_RADIUS.length - 1] ?? LANTERN_RADIUS[0];

    expect(zoomCaps[0]).toBeGreaterThan(1);
    for (let index = 1; index < zoomCaps.length; index += 1) {
      expect(zoomCaps[index] - zoomCaps[index - 1]).toBeGreaterThanOrEqual(
        0.16,
      );
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

    expect(lampDistances[0]).toBe(9);
    for (let index = 1; index < lampDistances.length; index += 1) {
      expect(lampDistances[index] - lampDistances[index - 1]).toBeGreaterThan(
        2,
      );
    }
  });
});
