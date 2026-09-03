import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PART_CATALOG, type PartShape } from "@/sim/parts";
import {
  type GeometryDetail,
  HIGH_DETAIL,
  LOW_DETAIL,
  partShapeGeometry,
} from "./part-geometry";
import { MAX_PART_TONE, partAccent, partLook } from "./part-look";

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
        // Built with the part's accent, exactly as the canvases render it.
        const geo = partShapeGeometry(
          part.shape,
          part.category,
          detail,
          partAccent(part),
        );
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
    const accent = partAccent(wheel);
    const a = partShapeGeometry(
      wheel.shape,
      wheel.category,
      HIGH_DETAIL,
      accent,
    );
    const b = partShapeGeometry(wheel.shape, wheel.category, HIGH_DETAIL, {
      ...accent,
    });
    expect(a).toBe(b);
    const c = partShapeGeometry(
      wheel.shape,
      wheel.category,
      LOW_DETAIL,
      accent,
    );
    expect(c).not.toBe(a);
    // A different tone is a different geometry (its attribute differs).
    const d = partShapeGeometry(wheel.shape, wheel.category, HIGH_DETAIL, {
      region: accent.region,
      tone: accent.tone * 0.5,
    });
    expect(d).not.toBe(a);
  });

  it("keeps lathe normals facing outward on the wheel tread", () => {
    const wheel = PART_CATALOG["drive-wheel"];
    if (wheel.shape.type !== "cylinder") throw new Error("expected cylinder");
    const geo = partShapeGeometry(
      wheel.shape,
      wheel.category,
      HIGH_DETAIL,
      partAccent(wheel),
    );
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

describe("two-tone vertex colours", () => {
  const twoToneParts = Object.values(PART_CATALOG).filter((part) => {
    const look = partLook(part);
    return look.region !== "none" && look.tone !== 1;
  });

  it("covers the whole catalog (every part has a face)", () => {
    expect(twoToneParts.length).toBe(Object.keys(PART_CATALOG).length);
  });

  for (const [tier, detail] of DETAILS) {
    for (const part of twoToneParts) {
      it(`${part.id} (${tier}) bakes its two tones into a color attribute`, () => {
        const look = partLook(part);
        const geo = partShapeGeometry(
          part.shape,
          part.category,
          detail,
          partAccent(part),
        );
        const color = geo.getAttribute("color");
        expect(color).toBeDefined();
        expect(color.itemSize).toBe(3);
        expect(color.count).toBe(geo.attributes.position.count);
        const tones = new Set<number>();
        for (let i = 0; i < color.count; i++) {
          const r = color.getX(i);
          // Grey multipliers: the three channels agree.
          expect(color.getY(i)).toBe(r);
          expect(color.getZ(i)).toBe(r);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(MAX_PART_TONE);
          tones.add(r);
        }
        expect(tones.size).toBeGreaterThanOrEqual(2);
        // Both the primary surface and the accent are present.
        const values = [...tones];
        expect(values.some((t) => Math.abs(t - 1) < 1e-5)).toBe(true);
        expect(values.some((t) => Math.abs(t - look.tone) < 1e-5)).toBe(true);
      });
    }
  }

  it("skips the attribute for single-tone forms", () => {
    const wheel = PART_CATALOG["drive-wheel"];
    const plain = partShapeGeometry(wheel.shape, wheel.category, HIGH_DETAIL);
    expect(plain.hasAttribute("color")).toBe(false);
    const unit = partShapeGeometry(wheel.shape, wheel.category, HIGH_DETAIL, {
      region: "tread",
      tone: 1,
    });
    expect(unit.hasAttribute("color")).toBe(false);
    // A region the form does not have leaves it single-tone as well, so
    // a future part with a mismatched look still renders in one colour.
    const mismatched = partShapeGeometry(
      wheel.shape,
      wheel.category,
      HIGH_DETAIL,
      { region: "deck", tone: 1.2 },
    );
    expect(mismatched.hasAttribute("color")).toBe(false);
  });

  it("puts the dark tone on the wheel tread and keeps the hub light", () => {
    const wheel = PART_CATALOG["drive-wheel"];
    if (wheel.shape.type !== "cylinder") throw new Error("expected cylinder");
    const look = partLook(wheel);
    const geo = partShapeGeometry(
      wheel.shape,
      wheel.category,
      HIGH_DETAIL,
      partAccent(wheel),
    );
    const pos = geo.attributes.position;
    const color = geo.getAttribute("color");
    let tread = 0;
    let hub = 0;
    for (let i = 0; i < pos.count; i++) {
      const radial = Math.hypot(pos.getX(i), pos.getZ(i));
      if (radial >= wheel.shape.radius * 0.95) {
        expect(color.getX(i)).toBeCloseTo(look.tone, 5);
        tread++;
      } else if (radial <= wheel.shape.radius * 0.45) {
        expect(color.getX(i)).toBeCloseTo(1, 5);
        hub++;
      }
    }
    expect(tread).toBeGreaterThan(0);
    expect(hub).toBeGreaterThan(0);
  });

  it("brightens the spike tip, not its mount", () => {
    const spike = PART_CATALOG["ram-spike"];
    if (spike.shape.type !== "cuboid") throw new Error("expected cuboid");
    const look = partLook(spike);
    const geo = partShapeGeometry(
      spike.shape,
      spike.category,
      HIGH_DETAIL,
      partAccent(spike),
    );
    const pos = geo.attributes.position;
    const color = geo.getAttribute("color");
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z >= spike.shape.hz * 0.2 - 1e-6) {
        expect(color.getX(i)).toBeCloseTo(1, 5);
      } else if (z <= -spike.shape.hz + 1e-6) {
        expect(color.getX(i)).toBeCloseTo(look.tone, 5);
      }
    }
  });
});
