/**
 * Manufactured-part display geometry (parts glow-up, render-only).
 *
 * Every builder produces a visual stand-in for a part's Rapier collider
 * (the `shape` field in src/sim/parts.ts, which render work never
 * touches): the mesh stays inside the collider's bounds (bevels and
 * grooves carve inward, never outward) and is built in the same local
 * frame as the raw primitive it replaces. Cylindrical forms are built
 * along local Y, exactly like CylinderGeometry, so part-visuals'
 * shapeRotation keeps reorienting them for x/z axis colliders.
 *
 * Pure three plus math, no React and no JSX, so the builders run in the
 * node vitest environment (part-geometry.test.ts) and the geometry cache
 * can be shared by every canvas.
 */

import {
  BoxGeometry,
  type BufferGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  MathUtils,
  Path,
  Shape,
  Vector2,
  Vector3,
} from "three";
import type { PartCategory, PartShape } from "@/sim/parts";

/** Vertex budgets per graphics tier. Both tiers stay far under mobile
 * comfort (a whole bot lands around 4-6k triangles on high). */
export interface GeometryDetail {
  /** Radial segments for lathed forms (wheels, domes, columns). */
  radial: number;
  /** Per-axis subdivisions for beveled boxes. */
  boxSegments: number;
}

export const HIGH_DETAIL: GeometryDetail = { radial: 28, boxSegments: 3 };
export const LOW_DETAIL: GeometryDetail = { radial: 18, boxSegments: 2 };

/**
 * Edge treatment per category: cores get a soft fillet (friendly power
 * unit), structure a machined chamfer, weapons a tight crisp edge break
 * so they read as ground steel.
 */
const CUBOID_BEVEL: Record<PartCategory, { scale: number; max: number }> = {
  core: { scale: 0.42, max: 0.07 },
  structure: { scale: 0.35, max: 0.04 },
  mobility: { scale: 0.35, max: 0.04 },
  weapon: { scale: 0.3, max: 0.022 },
};
const DEFAULT_BEVEL = { scale: 0.35, max: 0.04 };

type CylinderRole = "tire" | "blade" | "column";

/**
 * LatheGeometry with repaired normals: three's implementation pushes
 * the raw (unnormalized) previous-segment normal for the last profile
 * point, which leaves cap-center rings with near-zero normals and a
 * black shading artifact. Normalizing every normal fixes the caps and
 * leaves the rest untouched (they are already unit length).
 */
function lathe(points: Vector2[], radial: number): BufferGeometry {
  const geo = new LatheGeometry(points, radial);
  const nor = geo.attributes.normal;
  const n = new Vector3();
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i);
    const len = n.length();
    if (len > 1e-8) nor.setXYZ(i, n.x / len, n.y / len, n.z / len);
  }
  return geo;
}

function cylinderRole(category: PartCategory | undefined): CylinderRole {
  if (category === "mobility") return "tire";
  if (category === "weapon") return "blade";
  return "column";
}

/**
 * Rounded box: a subdivided BoxGeometry with every vertex pulled onto
 * the fillet of the inset core box. Flat regions keep exact face
 * normals, edge and corner vertices get true fillet normals, so smooth
 * shading renders crisp faces with a bright rolled edge highlight (the
 * single strongest "manufactured, not prototyped" cue).
 */
function buildRoundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  segments: number,
): BufferGeometry {
  const minHalf = Math.min(width, height, depth) / 2;
  const r = MathUtils.clamp(radius, minHalf * 0.05, minHalf * 0.95);
  const geo = new BoxGeometry(
    width,
    height,
    depth,
    segments,
    segments,
    segments,
  );
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const inner = new Vector3(width / 2 - r, height / 2 - r, depth / 2 - r);
  const v = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(
      MathUtils.clamp(v.x, -inner.x, inner.x),
      MathUtils.clamp(v.y, -inner.y, inner.y),
      MathUtils.clamp(v.z, -inner.z, inner.z),
    );
    v.sub(c);
    const len = v.length();
    if (len > 1e-8) {
      v.multiplyScalar(1 / len);
      pos.setXYZ(i, c.x + v.x * r, c.y + v.y * r, c.z + v.z * r);
      nor.setXYZ(i, v.x, v.y, v.z);
    }
  }
  return geo;
}

/**
 * Forward spike: a beveled bar tapered toward its -z tip (this
 * catalog's mount convention puts the rigid mount on +z and the
 * business end forward at -z, matching the cores' -z "front"). The tip
 * keeps a small flat so it reads as an industrial ram, not a needle.
 */
function buildSpike(
  hx: number,
  hy: number,
  hz: number,
  segments: number,
): BufferGeometry {
  const bevel = Math.min(0.014, Math.min(hx, hy) * 0.5);
  const geo = buildRoundedBox(
    hx * 2,
    hy * 2,
    hz * 2,
    bevel,
    Math.max(segments, 3),
  );
  const pos = geo.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = MathUtils.clamp((hz * 0.2 - v.z) / (hz * 1.2), 0, 1);
    const s = 1 - 0.8 * t ** 1.5;
    pos.setXYZ(i, v.x * s, v.y * s, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Machined sphere: polar flats (mount bosses) and an equatorial seam
 * groove make the ball read as two machined hemisphere shells bolted
 * together instead of a raw primitive.
 */
function buildMachinedBall(radius: number, radial: number): BufferGeometry {
  const flat = 0.35; // half-angle of each polar flat, radians
  const seam = 0.1; // half-width of the seam band, radians
  const seamDepth = 0.045; // radial carve, fraction of radius
  const half = Math.PI / 2;
  const pts: Vector2[] = [];
  const rim = (phi: number, scale = 1) =>
    pts.push(
      new Vector2(
        Math.max(Math.sin(phi) * radius * scale, radius * 0.02),
        -Math.cos(phi) * radius,
      ),
    );
  pts.push(new Vector2(radius * 0.02, -Math.cos(flat) * radius));
  const arcSteps = 5;
  for (let i = 0; i <= arcSteps; i++) {
    rim(flat + (half - seam - flat) * (i / arcSteps));
  }
  rim(half - seam * 0.4, 1 - seamDepth * 0.8);
  rim(half, 1 - seamDepth);
  rim(half + seam * 0.4, 1 - seamDepth * 0.8);
  for (let i = 0; i <= arcSteps; i++) {
    rim(half + seam + (half - seam - flat) * (i / arcSteps));
  }
  pts.push(new Vector2(radius * 0.02, Math.cos(flat) * radius));
  return lathe(pts, radial);
}

/**
 * Tire and drum: chamfered tread shoulders plus a recessed hub with a
 * raised rim on both faces. One material still covers it; the recess
 * shading alone separates "rubber ring" from "hub" under the studio
 * lights. Built along local Y like CylinderGeometry.
 */
function buildTire(
  radius: number,
  halfHeight: number,
  radial: number,
): BufferGeometry {
  const hh = halfHeight;
  const shoulder = Math.min(radius * 0.16, hh * 0.6);
  const recess = Math.min(0.05, hh * 0.5);
  const hub = radius * 0.5;
  const lip = radius * 0.58;
  const pts = [
    new Vector2(radius * 0.02, -hh + recess),
    new Vector2(hub, -hh + recess),
    new Vector2(lip, -hh),
    new Vector2(radius - shoulder, -hh),
    new Vector2(radius, -hh + shoulder),
    new Vector2(radius, hh - shoulder),
    new Vector2(radius - shoulder, hh),
    new Vector2(lip, hh),
    new Vector2(hub, hh - recess),
    new Vector2(radius * 0.02, hh - recess),
  ];
  return lathe(pts, radial);
}

/**
 * Toothed disc for spinning weapons: twelve teeth cut into the rim, an
 * arbor hole, and a thin edge bevel. Teeth sit at the collider radius
 * and gullets carve inward, so the silhouette matches the physics
 * circle players aim with while the spin finally looks lethal.
 */
function buildToothedDisc(radius: number, halfHeight: number): BufferGeometry {
  const teeth = 12;
  const bevel = Math.min(halfHeight * 0.3, 0.012);
  const outer = radius - bevel;
  const root = outer * 0.8;
  const step = (Math.PI * 2) / teeth;
  const shape = new Shape();
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const tipEnd = a + step * 0.45;
    const rootStart = a + step * 0.58;
    if (i === 0) shape.moveTo(Math.cos(a) * outer, Math.sin(a) * outer);
    else shape.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    shape.lineTo(Math.cos(tipEnd) * outer, Math.sin(tipEnd) * outer);
    shape.lineTo(Math.cos(rootStart) * root, Math.sin(rootStart) * root);
    shape.lineTo(Math.cos(a + step) * root, Math.sin(a + step) * root);
  }
  shape.closePath();
  const arbor = new Path();
  arbor.absarc(0, 0, radius * 0.14, 0, Math.PI * 2, true);
  shape.holes.push(arbor);
  const depth = Math.max(halfHeight * 2 - bevel * 2, halfHeight);
  const geo = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 8,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  // Extrude runs along +z; re-seat on local Y to match the cylinder
  // convention shapeRotation expects.
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Structural column: chamfered end caps, and for slender spars (masts)
 * a thinner shaft between two full-radius collars so the pole reads as
 * an assembled strut rather than an unfinished dowel.
 */
function buildColumn(
  radius: number,
  halfHeight: number,
  radial: number,
): BufferGeometry {
  const hh = halfHeight;
  const ch = Math.min(radius, hh) * 0.3;
  const pts: Vector2[] = [];
  const axisEps = radius * 0.02;
  if (radius < hh * 0.45) {
    const band = hh * 0.18;
    const shaft = radius * 0.8;
    pts.push(new Vector2(axisEps, -hh));
    pts.push(new Vector2(radius - ch, -hh));
    pts.push(new Vector2(radius, -hh + ch));
    pts.push(new Vector2(radius, -hh + band));
    pts.push(new Vector2(shaft, -hh + band + ch));
    pts.push(new Vector2(shaft, hh - band - ch));
    pts.push(new Vector2(radius, hh - band));
    pts.push(new Vector2(radius, hh - ch));
    pts.push(new Vector2(radius - ch, hh));
    pts.push(new Vector2(axisEps, hh));
  } else {
    pts.push(new Vector2(axisEps, -hh));
    pts.push(new Vector2(radius - ch, -hh));
    pts.push(new Vector2(radius, -hh + ch));
    pts.push(new Vector2(radius, hh - ch));
    pts.push(new Vector2(radius - ch, hh));
    pts.push(new Vector2(axisEps, hh));
  }
  return lathe(pts, radial);
}

function geometryKey(
  shape: PartShape,
  category: PartCategory | undefined,
  detail: GeometryDetail,
): string {
  switch (shape.type) {
    case "cuboid":
      return `cuboid:${shape.hx}:${shape.hy}:${shape.hz}:${category ?? "none"}:${detail.boxSegments}`;
    case "ball":
      return `ball:${shape.radius}:${detail.radial}`;
    case "cylinder":
      return `cyl:${shape.radius}:${shape.halfHeight}:${cylinderRole(category)}:${detail.radial}`;
  }
}

function buildShape(
  shape: PartShape,
  category: PartCategory | undefined,
  detail: GeometryDetail,
): BufferGeometry {
  switch (shape.type) {
    case "cuboid": {
      if (
        category === "weapon" &&
        shape.hz >= 2 * Math.max(shape.hx, shape.hy)
      ) {
        return buildSpike(shape.hx, shape.hy, shape.hz, detail.boxSegments);
      }
      const style = category ? CUBOID_BEVEL[category] : DEFAULT_BEVEL;
      const minHalf = Math.min(shape.hx, shape.hy, shape.hz);
      const bevel = Math.min(style.max, style.scale * minHalf);
      return buildRoundedBox(
        shape.hx * 2,
        shape.hy * 2,
        shape.hz * 2,
        bevel,
        detail.boxSegments,
      );
    }
    case "ball":
      return buildMachinedBall(shape.radius, detail.radial);
    case "cylinder": {
      switch (cylinderRole(category)) {
        case "tire":
          return buildTire(shape.radius, shape.halfHeight, detail.radial);
        case "blade":
          return buildToothedDisc(shape.radius, shape.halfHeight);
        default:
          return buildColumn(shape.radius, shape.halfHeight, detail.radial);
      }
    }
  }
}

/** Shared, never-disposed geometry cache: the catalog is small and
 * fixed, and every mesh showing the same part shares one geometry. */
const cache = new Map<string, BufferGeometry>();

export function partShapeGeometry(
  shape: PartShape,
  category: PartCategory | undefined,
  detail: GeometryDetail,
): BufferGeometry {
  const key = geometryKey(shape, category, detail);
  const hit = cache.get(key);
  if (hit) return hit;
  const built = buildShape(shape, category, detail);
  cache.set(key, built);
  return built;
}
