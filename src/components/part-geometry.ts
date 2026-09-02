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
 * Two-tone identity (G3, parts with faces) rides on a per-vertex `color`
 * attribute: a linear multiplier of 1 on the primary surface and the
 * part's `tone` on its accent region (see part-look.ts). One
 * meshStandardMaterial with `vertexColors` on multiplies it by the base
 * colour, so a wheel keeps a dark tread and a light hub in one draw call
 * whether the base is the part's own paint or an arena team colour.
 * Builders that end up single-tone skip the attribute entirely.
 *
 * Pure three plus math, no React and no JSX, so the builders run in the
 * node vitest environment (part-geometry.test.ts) and the geometry cache
 * can be shared by every canvas.
 */

import {
  BoxGeometry,
  type BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  MathUtils,
  Path,
  Shape,
  Vector2,
  Vector3,
} from "three";
import type { PartCategory, PartShape } from "@/sim/parts";
import type { PartAccent, PartToneRegion } from "./part-look";

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

/** Rows or columns a box gains where a tone needs a tight edge: a core's
 * window band and a bar's bright tips fade over one subdivision, so the
 * axis that carries them is cut finer than the tier's default. */
const ACCENT_BOX_SEGMENTS = 6;

/**
 * Accent tones only apply when they would actually split the surface;
 * a tone of 1 (or no accent) is single-tone and skips the attribute.
 */
function toneFor(
  accent: PartAccent | undefined,
  region: PartToneRegion,
): number | null {
  if (!accent || accent.region !== region || accent.tone === 1) return null;
  return accent.tone;
}

/**
 * Bake per-vertex tone multipliers as a `color` attribute. Skipped when
 * every vertex landed on the same tone (a region the form does not have),
 * so call sites can key `vertexColors` off the attribute's presence.
 */
function writeTones(geo: BufferGeometry, tones: Float32Array): void {
  let twoTone = false;
  for (let i = 1; i < tones.length; i++) {
    if (tones[i] !== tones[0]) {
      twoTone = true;
      break;
    }
  }
  if (!twoTone) return;
  const colors = new Float32Array(tones.length * 3);
  for (let i = 0; i < tones.length; i++) {
    colors[i * 3] = tones[i];
    colors[i * 3 + 1] = tones[i];
    colors[i * 3 + 2] = tones[i];
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
}

/** Tone every vertex by its final position (lathes and extrusions). */
function tonesByPosition(
  geo: BufferGeometry,
  toneAt: (x: number, y: number, z: number) => number,
): void {
  const pos = geo.attributes.position;
  const tones = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    tones[i] = toneAt(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  writeTones(geo, tones);
}

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

/** BoxGeometry face ids, recovered per vertex from the pristine
 * axis-aligned normals before the fillet pass rewrites them. */
const FACE_PX = 0;
const FACE_NX = 1;
const FACE_PY = 2;
const FACE_NY = 3;
const FACE_PZ = 4;
const FACE_NZ = 5;

function faceOfNormal(x: number, y: number, z: number): number {
  if (x > 0.5) return FACE_PX;
  if (x < -0.5) return FACE_NX;
  if (y > 0.5) return FACE_PY;
  if (y < -0.5) return FACE_NY;
  if (z > 0.5) return FACE_PZ;
  return FACE_NZ;
}

/**
 * Box tone regions, decided on the pristine grid position and face so
 * the split lands on a subdivision line: a plate's top deck, a core's
 * equator window band, a bar's tips, or a striking front face.
 */
function boxTone(
  region: PartToneRegion,
  tone: number,
  face: number,
  x0: number,
  y0: number,
  width: number,
  height: number,
): number {
  switch (region) {
    case "deck":
      return face === FACE_PY ? tone : 1;
    case "front":
      return face === FACE_NZ ? tone : 1;
    case "ends":
      return face === FACE_PX ||
        face === FACE_NX ||
        Math.abs(x0) >= width / 2 - 1e-6
        ? tone
        : 1;
    case "band":
      return face !== FACE_PY &&
        face !== FACE_NY &&
        Math.abs(y0) <= height * 0.17
        ? tone
        : 1;
    default:
      return 1;
  }
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
  accent?: PartAccent,
): BufferGeometry {
  const minHalf = Math.min(width, height, depth) / 2;
  const r = MathUtils.clamp(radius, minHalf * 0.05, minHalf * 0.95);
  const region = accent?.region ?? "none";
  const tone = accent && accent.tone !== 1 ? accent.tone : null;
  const widthSegments =
    tone !== null && region === "ends"
      ? Math.max(segments, ACCENT_BOX_SEGMENTS)
      : segments;
  const heightSegments =
    tone !== null && region === "band"
      ? Math.max(segments, ACCENT_BOX_SEGMENTS)
      : segments;
  const geo = new BoxGeometry(
    width,
    height,
    depth,
    widthSegments,
    heightSegments,
    segments,
  );
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  let tones: Float32Array | null = null;
  if (tone !== null) {
    tones = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const face = faceOfNormal(nor.getX(i), nor.getY(i), nor.getZ(i));
      tones[i] = boxTone(
        region,
        tone,
        face,
        pos.getX(i),
        pos.getY(i),
        width,
        height,
      );
    }
  }
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
  if (tones) writeTones(geo, tones);
  return geo;
}

/**
 * Forward spike: a beveled bar tapered toward its -z tip (this
 * catalog's mount convention puts the rigid mount on +z and the
 * business end forward at -z, matching the cores' -z "front"). The tip
 * keeps a small flat so it reads as an industrial ram, not a needle.
 * The `tip` tone follows the taper, so the point brightens into ground
 * steel while the shank keeps the base colour.
 */
function buildSpike(
  hx: number,
  hy: number,
  hz: number,
  segments: number,
  accent?: PartAccent,
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
  const tipTone = toneFor(accent, "tip");
  const tones = tipTone !== null ? new Float32Array(pos.count) : null;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = MathUtils.clamp((hz * 0.2 - v.z) / (hz * 1.2), 0, 1);
    const s = 1 - 0.8 * t ** 1.5;
    pos.setXYZ(i, v.x * s, v.y * s, v.z);
    if (tones && tipTone !== null) tones[i] = 1 + (tipTone - 1) * t;
  }
  geo.computeVertexNormals();
  if (tones) writeTones(geo, tones);
  return geo;
}

/**
 * Machined sphere: polar flats (mount bosses) and an equatorial seam
 * groove make the ball read as two machined hemisphere shells bolted
 * together instead of a raw primitive. The `poles` tone colours the two
 * flats (a sensor's dark collar, a hammer's bright machined boss).
 */
function buildMachinedBall(
  radius: number,
  radial: number,
  accent?: PartAccent,
): BufferGeometry {
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
  const geo = lathe(pts, radial);
  const poleTone = toneFor(accent, "poles");
  if (poleTone !== null) {
    const flatY = Math.cos(flat) * radius - 1e-4;
    tonesByPosition(geo, (_x, y) => (Math.abs(y) >= flatY ? poleTone : 1));
  }
  return geo;
}

/**
 * Tire and drum: chamfered tread shoulders plus a recessed hub with a
 * raised rim on both faces. One material still covers it: the `tread`
 * tone darkens everything from the rim lip outward to rubber while the
 * recessed hub keeps the base colour. Built along local Y like
 * CylinderGeometry.
 */
function buildTire(
  radius: number,
  halfHeight: number,
  radial: number,
  accent?: PartAccent,
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
  const geo = lathe(pts, radial);
  const treadTone = toneFor(accent, "tread");
  if (treadTone !== null) {
    const lipEdge = lip - 1e-4;
    tonesByPosition(geo, (x, _y, z) =>
      Math.hypot(x, z) >= lipEdge ? treadTone : 1,
    );
  }
  return geo;
}

/**
 * Toothed disc for spinning weapons: twelve teeth cut into the rim, an
 * arbor hole, and a thin edge bevel. Teeth sit at the collider radius
 * and gullets carve inward, so the silhouette matches the physics
 * circle players aim with while the spin finally looks lethal. The
 * `arbor` tone sits on the hole ring and grades out to the bright rim
 * across the cap, the look of a ground disc darkening toward its hub.
 */
function buildToothedDisc(
  radius: number,
  halfHeight: number,
  accent?: PartAccent,
): BufferGeometry {
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
  const arborRadius = radius * 0.14;
  const arbor = new Path();
  arbor.absarc(0, 0, arborRadius, 0, Math.PI * 2, true);
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
  const arborTone = toneFor(accent, "arbor");
  if (arborTone !== null) {
    // The hole's bevel ring sits a bevel outside the arbor radius.
    const arborEdge = arborRadius + bevel + 1e-3;
    tonesByPosition(geo, (x, _y, z) =>
      Math.hypot(x, z) <= arborEdge ? arborTone : 1,
    );
  }
  return geo;
}

/**
 * Structural column: chamfered end caps, and for slender spars (masts)
 * a thinner shaft between two full-radius collars so the pole reads as
 * an assembled strut rather than an unfinished dowel. The `shaft` tone
 * colours the shaft (or a stout column's barrel) against its collars.
 */
function buildColumn(
  radius: number,
  halfHeight: number,
  radial: number,
  accent?: PartAccent,
): BufferGeometry {
  const hh = halfHeight;
  const ch = Math.min(radius, hh) * 0.3;
  const pts: Vector2[] = [];
  const axisEps = radius * 0.02;
  const slender = radius < hh * 0.45;
  const band = hh * 0.18;
  if (slender) {
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
  const geo = lathe(pts, radial);
  const shaftTone = toneFor(accent, "shaft");
  if (shaftTone !== null) {
    const fullRadius = radius - 1e-4;
    const collarY = hh - band + 1e-4;
    tonesByPosition(geo, (x, y, z) => {
      const r = Math.hypot(x, z);
      if (slender) {
        // Between the collars and thinner than them: the shaft points.
        return r < fullRadius && Math.abs(y) < collarY ? shaftTone : 1;
      }
      // A stout column's full-radius barrel against its chamfered caps.
      return r >= fullRadius ? shaftTone : 1;
    });
  }
  return geo;
}

function accentKey(accent: PartAccent | undefined): string {
  if (!accent || accent.region === "none" || accent.tone === 1) return "flat";
  return `${accent.region}:${accent.tone}`;
}

function geometryKey(
  shape: PartShape,
  category: PartCategory | undefined,
  detail: GeometryDetail,
  accent: PartAccent | undefined,
): string {
  const tone = accentKey(accent);
  switch (shape.type) {
    case "cuboid":
      return `cuboid:${shape.hx}:${shape.hy}:${shape.hz}:${category ?? "none"}:${detail.boxSegments}:${tone}`;
    case "ball":
      return `ball:${shape.radius}:${detail.radial}:${tone}`;
    case "cylinder":
      return `cyl:${shape.radius}:${shape.halfHeight}:${cylinderRole(category)}:${detail.radial}:${tone}`;
  }
}

function buildShape(
  shape: PartShape,
  category: PartCategory | undefined,
  detail: GeometryDetail,
  accent: PartAccent | undefined,
): BufferGeometry {
  switch (shape.type) {
    case "cuboid": {
      if (
        category === "weapon" &&
        shape.hz >= 2 * Math.max(shape.hx, shape.hy)
      ) {
        return buildSpike(
          shape.hx,
          shape.hy,
          shape.hz,
          detail.boxSegments,
          accent,
        );
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
        accent,
      );
    }
    case "ball":
      return buildMachinedBall(shape.radius, detail.radial, accent);
    case "cylinder": {
      switch (cylinderRole(category)) {
        case "tire":
          return buildTire(
            shape.radius,
            shape.halfHeight,
            detail.radial,
            accent,
          );
        case "blade":
          return buildToothedDisc(shape.radius, shape.halfHeight, accent);
        default:
          return buildColumn(
            shape.radius,
            shape.halfHeight,
            detail.radial,
            accent,
          );
      }
    }
  }
}

/** Shared, never-disposed geometry cache: the catalog is small and
 * fixed, and every mesh showing the same part shares one geometry. */
const cache = new Map<string, BufferGeometry>();

/**
 * The display geometry for a collider shape. `accent` requests the
 * part's two-tone split (part-look.ts); omit it for a single-tone form.
 * Check `geometry.hasAttribute("color")` to learn whether the built form
 * actually carries tones before enabling `vertexColors`.
 */
export function partShapeGeometry(
  shape: PartShape,
  category: PartCategory | undefined,
  detail: GeometryDetail,
  accent?: PartAccent,
): BufferGeometry {
  const key = geometryKey(shape, category, detail, accent);
  const hit = cache.get(key);
  if (hit) return hit;
  const built = buildShape(shape, category, detail, accent);
  cache.set(key, built);
  return built;
}
