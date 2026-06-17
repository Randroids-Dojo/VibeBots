import { describe, expect, it } from "vitest";
import { DEFAULT_GEAR } from "@/sim/mine";
import {
  clampMineCameraZoom,
  maxMineCameraZoom,
  mineRenderWindow,
} from "./mine-camera";

describe("mine camera zoom", () => {
  it("caps zoom-out by lantern reach", () => {
    const base = { ...DEFAULT_GEAR, lantern: 1 };
    const upgraded = { ...DEFAULT_GEAR, lantern: 3 };

    expect(maxMineCameraZoom(base)).toBeGreaterThan(1);
    expect(maxMineCameraZoom(upgraded)).toBeGreaterThan(
      maxMineCameraZoom(base),
    );
    expect(clampMineCameraZoom(99, base)).toBe(maxMineCameraZoom(base));
    expect(clampMineCameraZoom(99, upgraded)).toBe(maxMineCameraZoom(upgraded));
  });

  it("renders real mine rows down through the lantern falloff band", () => {
    expect(mineRenderWindow({ ...DEFAULT_GEAR, lantern: 1 }, 1).below).toBe(5);
    expect(mineRenderWindow({ ...DEFAULT_GEAR, lantern: 2 }, 1.1).below).toBe(
      7,
    );
    expect(mineRenderWindow({ ...DEFAULT_GEAR, lantern: 3 }, 1.3).below).toBe(
      9,
    );
  });
});
