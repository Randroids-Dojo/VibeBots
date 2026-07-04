import { describe, expect, it } from "vitest";
import { clientToNdc, pickNearestSlot } from "./workshop-drag";

describe("pickNearestSlot", () => {
  it("returns -1 when there are no slots", () => {
    expect(pickNearestSlot([], { x: 0, y: 0 }, 0.5)).toBe(-1);
  });

  it("picks the slot closest to the pointer", () => {
    const slots = [
      { x: -0.5, y: 0, z: 0 },
      { x: 0.1, y: 0.05, z: 0 },
      { x: 0.8, y: 0, z: 0 },
    ];
    expect(pickNearestSlot(slots, { x: 0.12, y: 0.04 }, 0.5)).toBe(1);
  });

  it("returns -1 when the nearest slot is beyond maxDist", () => {
    expect(
      pickNearestSlot([{ x: 0.9, y: 0.9, z: 0 }], { x: 0, y: 0 }, 0.4),
    ).toBe(-1);
  });

  it("ignores slots outside the frustum depth (behind camera / past far)", () => {
    const behind = { x: 0, y: 0, z: 1.4 };
    const inFront = { x: 0.3, y: 0.3, z: 0 };
    // The exactly-on-pointer slot is behind the camera, so the farther but
    // in-frustum slot wins.
    expect(pickNearestSlot([behind, inFront], { x: 0, y: 0 }, 0.9)).toBe(1);
  });

  it("keeps the earlier slot on a tie (deterministic design order)", () => {
    const a = { x: 0.2, y: 0, z: 0 };
    const b = { x: -0.2, y: 0, z: 0 };
    expect(pickNearestSlot([a, b], { x: 0, y: 0 }, 0.5)).toBe(0);
  });
});

describe("clientToNdc", () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 };

  it("maps the element center to the origin", () => {
    const ndc = clientToNdc(100, 50, rect);
    expect(ndc.x).toBeCloseTo(0);
    expect(ndc.y).toBeCloseTo(0);
  });

  it("maps corners with a flipped y axis", () => {
    expect(clientToNdc(0, 0, rect)).toEqual({ x: -1, y: 1 });
    expect(clientToNdc(200, 100, rect)).toEqual({ x: 1, y: -1 });
  });

  it("accounts for a non-zero element offset", () => {
    const offset = { left: 100, top: 50, width: 200, height: 100 };
    const ndc = clientToNdc(200, 100, offset);
    expect(ndc.x).toBeCloseTo(0);
    expect(ndc.y).toBeCloseTo(0);
  });
});
