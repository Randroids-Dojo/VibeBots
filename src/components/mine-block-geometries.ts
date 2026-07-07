/**
 * Shared geometry singletons for the mine cell block bodies (phone-lag
 * follow-up to F-075). Its sibling `mine-block-materials.ts` already
 * shares one material per (kind, tint); the geometries stayed per-cell.
 *
 * Because block meshes attach shared materials with `dispose={null}`
 * (never dispose a singleton), R3F also stops disposing the per-cell
 * geometry on unmount, so every cell that changed signature or fell out
 * of the F-075 element cache leaked its GPU buffer. Real-phone telemetry
 * showed the symptom: the JS heap trough climbing across a session
 * (about 7 MB to 77 MB) rather than settling. One geometry per shape,
 * reused across every cell of that kind, makes `dispose={null}` correct
 * and removes the leak (and the per-cell ExtrudeGeometry build cost).
 *
 * The rounded cube reproduces drei's `RoundedBox` exactly (extruded
 * rounded rectangle, centered, creased normals at 0.4 rad) so the blocks
 * render pixel-identical; only the allocation changes.
 */

import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  type BufferGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  Shape,
} from "three/webgpu";

const EPS = 0.00001;

/** The rounded-rectangle cross-section drei extrudes; kept identical to
 * its `createShape` so the bevel matches. */
function roundedRectShape(
  width: number,
  height: number,
  radius0: number,
): Shape {
  const shape = new Shape();
  const radius = radius0 - EPS;
  shape.absarc(EPS, EPS, EPS, -Math.PI / 2, -Math.PI, true);
  shape.absarc(EPS, height - radius * 2, EPS, Math.PI, Math.PI / 2, true);
  shape.absarc(
    width - radius * 2,
    height - radius * 2,
    EPS,
    Math.PI / 2,
    0,
    true,
  );
  shape.absarc(width - radius * 2, EPS, EPS, 0, -Math.PI / 2, true);
  return shape;
}

/** One rounded box geometry, built the way drei's `RoundedBox` builds
 * its own (default bevelSegments 4, steps 1, creaseAngle 0.4). */
function roundedBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number,
  smoothness: number,
): BufferGeometry {
  const shape = roundedRectShape(width, height, radius);
  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - radius * 2,
    bevelEnabled: true,
    bevelSegments: 4 * 2,
    steps: 1,
    bevelSize: radius - EPS,
    bevelThickness: radius,
    curveSegments: smoothness,
  });
  geometry.center();
  // toCreasedNormals mutates a non-indexed geometry in place (what
  // ExtrudeGeometry produces) but returns a fresh one for indexed input;
  // return its result so the creasing holds either way.
  return toCreasedNormals(geometry, 0.4);
}

/** Dirt, gas, and ore bodies: a 0.94 beveled cube (radius 0.07). */
export const DIRT_BLOCK_GEOMETRY = roundedBoxGeometry(
  0.94,
  0.94,
  0.94,
  0.07,
  2,
);
/** Metal block: a tighter, slightly deeper beveled cube. */
export const METAL_BLOCK_GEOMETRY = roundedBoxGeometry(
  0.98,
  0.98,
  1.02,
  0.04,
  1,
);
/** Rock body: the faceted dodecahedron (per-cell rotation stays on the mesh). */
export const ROCK_BLOCK_GEOMETRY: BufferGeometry = new DodecahedronGeometry(
  0.62,
  0,
);
/** Boulder body: the faceted icosahedron. */
export const BOULDER_BLOCK_GEOMETRY: BufferGeometry = new IcosahedronGeometry(
  0.56,
  0,
);
