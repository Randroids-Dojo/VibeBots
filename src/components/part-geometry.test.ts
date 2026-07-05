import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PART_CATALOG, type PartShape } from "@/sim/parts";
import {
  type GeometryDetail,
  HIGH_DETAIL,
  LOW_DETAIL,
  partShapeGeometry,
} from "./part-geometry";

/**
 * Half extents of the collider in the geometry's local build frame.
 * Cylindrical forms build along local Y (the CylinderGeometry
 * convention); shapeRotation reorients them, so the bound check happens
 * pre-rotation.
 */
function colliderHalfExtents(shape: PartShape): Vector3 {
  switch (shape.type) {
    case "cuboid":
      return new Vector3(shape.hx, shape.hy, shape.hz);
    case "ball":
      return new Vector3(shape.radius, shape.radius, shape.radius);
    case "cylinder":
      return new Vector3(shape.radius, shape.halfHeight, shape.radius);
  }
}

const DETAILS: [string, GeometryDetail][] = [
  ["high", HIGH_DETAIL],
  ["low", LOW_DETAIL],
];

describe("partShapeGeometry", () => {
  for (const [tier, detail] of DETAILS) {
    for (const part of Object.values(PART_CATALOG)) {
      it(`${part.id} (${tier}) stays inside its collider with sane normals`, () => {
        const geo = partShapeGeometry(part.shape, part.category, detail);
        const pos = geo.attributes.position;
        const nor = geo.attributes.normal;
        expect(pos.count).toBeGreaterThan(0);
        expect(nor.count).toBe(pos.count);
        const bound = colliderHalfExtents(part.shape);
        const eps = 1e-3;
        const v = new Vector3();
        const n = new Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          n.fromBufferAttribute(nor, i);
          expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
          expect(Number.isFinite(n.x + n.y + n.z)).toBe(true);
          // Render-only contract: the visual never grows the collider.
          expect(Math.abs(v.x)).toBeLessThanOrEqual(bound.x + eps);
          expect(Math.abs(v.y)).toBeLessThanOrEqual(bound.y + eps);
          expect(Math.abs(v.z)).toBeLessThanOrEqual(bound.z + eps);
          // Normals stay unit-ish (no zero or exploded normals).
          expect(n.length()).toBeGreaterThan(0.5);
          expect(n.length()).toBeLessThan(1.5);
        }
        // Mobile budget: no single part balloons past a couple of
        // thousand triangles even on the high tier.
        const tris = (geo.index ? geo.index.count : pos.count) / 3;
        expect(tris).toBeLessThan(2000);
      });
    }
  }

  it("shares one geometry instance per shape treatment", () => {
    const wheel = PART_CATALOG["drive-wheel"];
    const a = partShapeGeometry(wheel.shape, wheel.category, HIGH_DETAIL);
    const b = partShapeGeometry(wheel.shape, wheel.category, HIGH_DETAIL);
    expect(a).toBe(b);
    const c = partShapeGeometry(wheel.shape, wheel.category, LOW_DETAIL);
    expect(c).not.toBe(a);
  });

  it("keeps lathe normals facing outward on the wheel tread", () => {
    const wheel = PART_CATALOG["drive-wheel"];
    if (wheel.shape.type !== "cylinder") throw new Error("expected cylinder");
    const geo = partShapeGeometry(wheel.shape, wheel.category, HIGH_DETAIL);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const v = new Vector3();
    const n = new Vector3();
    let outward = 0;
    let sampled = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Sample tread vertices (near full radius).
      const radial = Math.hypot(v.x, v.z);
      if (radial < wheel.shape.radius * 0.95) continue;
      n.fromBufferAttribute(nor, i);
      sampled++;
      if ((n.x * v.x + n.z * v.z) / radial > 0.2) outward++;
    }
    expect(sampled).toBeGreaterThan(0);
    expect(outward / sampled).toBeGreaterThan(0.9);
  });
});
