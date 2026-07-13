import {
  FP_CORE,
  FP_DOOR_OWNED,
  FP_OPEN,
  FP_ROCK_UNDUG,
  FP_SPIKES,
  type FpSolidGrid,
  fpCellIndex,
  fpCellInGrid,
} from "./bunker-fp-grid";

/**
 * Crosshair raycast for the first-person bunker viewer: an
 * Amanatides-Woo DDA over the 7x5x5 solidity grid. Pure module (no
 * three imports) so targeting unit-tests in node, and allocation-free:
 * raycastFpGrid writes into a caller-owned out record and touches only
 * scalar locals, so it is safe inside useFrame every frame
 * (frame-loop-performance rule).
 *
 * Coordinates: the ray origin and direction arrive in WORLD space (the
 * camera's space, where a cell (x, y, z) sits at world (x, y, -z));
 * the z axis flips internally so hit cells come back in room-local
 * grid coordinates (z = depth, growing into the rock). The direction
 * must be normalized for distances to be in world units.
 */

export const FP_MAX_REACH = 3.5;

/** What the crosshair ray stopped on. "rock" is the boundary shell
 * around the volume: a placement surface, never diggable or removable.
 * Interior undug rock is "rock-diggable". */
export type FpRayHitKind =
  | "part"
  | "core"
  | "spikes"
  | "door"
  | "rock-diggable"
  | "rock";

/** Entered-face indices, room-local grid axes (z = depth): the face of
 * the hit cell whose normal points back toward the ray. */
export const FP_FACE_POS_X = 0;
export const FP_FACE_NEG_X = 1;
export const FP_FACE_POS_Y = 2;
export const FP_FACE_NEG_Y = 3;
export const FP_FACE_POS_Z = 4;
export const FP_FACE_NEG_Z = 5;

export interface FpRayHit {
  hit: boolean;
  /** Hit cell in room-local grid coordinates. Boundary hits sit one
   * cell outside the volume (matching the rendered rock shell). */
  x: number;
  y: number;
  z: number;
  /** Entered face of the hit cell (FP_FACE_*), toward the ray. */
  face: number;
  kind: FpRayHitKind;
  /** World-unit distance along the (normalized) ray to the hit face. */
  distance: number;
  /** The last OPEN cell the ray traversed before the hit: the cell a
   * build action places into. All -1 when no open cell was crossed. */
  placeX: number;
  placeY: number;
  placeZ: number;
}

export function createFpRayHit(): FpRayHit {
  return {
    hit: false,
    x: -1,
    y: -1,
    z: -1,
    face: 0,
    kind: "rock",
    distance: 0,
    placeX: -1,
    placeY: -1,
    placeZ: -1,
  };
}

function kindForSolidity(value: number): FpRayHitKind {
  switch (value) {
    case FP_CORE:
      return "core";
    case FP_SPIKES:
      return "spikes";
    case FP_DOOR_OWNED:
      return "door";
    case FP_ROCK_UNDUG:
      return "rock-diggable";
    default:
      // FP_SOLID_PART: walls, floors, roofs, and turrets alike.
      return "part";
  }
}

function missFpRay(out: FpRayHit, maxDist: number): void {
  out.hit = false;
  out.x = -1;
  out.y = -1;
  out.z = -1;
  out.face = 0;
  out.kind = "rock";
  out.distance = maxDist;
  out.placeX = -1;
  out.placeY = -1;
  out.placeZ = -1;
}

/**
 * Marches the ray cell by cell until it reaches a non-open cell, exits
 * the volume (the boundary rock shell), or runs past maxDist. The cell
 * containing the origin is never reported as a hit (the player cannot
 * target the cell they stand in), but it seeds the place cell when
 * open. Writes every field of `out` on every call.
 */
export function raycastFpGrid(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  solid: FpSolidGrid,
  maxDist: number,
  out: FpRayHit,
): void {
  // Flip world z into grid depth space so the walk is uniform.
  const gz = -oz;
  const gdz = -dz;

  // The + 0 folds IEEE negative zero (from rounding -0.0 world z)
  // back to +0 so probe signatures and test equality stay exact.
  let cx = Math.round(ox) + 0;
  let cy = Math.round(oy) + 0;
  let cz = Math.round(gz) + 0;

  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const stepZ = gdz >= 0 ? 1 : -1;
  let tMaxX = dx !== 0 ? (cx + 0.5 * stepX - ox) / dx : Infinity;
  let tMaxY = dy !== 0 ? (cy + 0.5 * stepY - oy) / dy : Infinity;
  let tMaxZ = gdz !== 0 ? (cz + 0.5 * stepZ - gz) / gdz : Infinity;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = gdz !== 0 ? Math.abs(1 / gdz) : Infinity;

  let placeX = -1;
  let placeY = -1;
  let placeZ = -1;
  if (fpCellInGrid(cx, cy, cz) && solid[fpCellIndex(cx, cy, cz)] === FP_OPEN) {
    placeX = cx;
    placeY = cy;
    placeZ = cz;
  }

  // The volume is 7x5x5; 32 steps outlasts any reach the UI allows.
  for (let step = 0; step < 32; step++) {
    let t: number;
    let face: number;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
      face = stepX > 0 ? FP_FACE_NEG_X : FP_FACE_POS_X;
    } else if (tMaxY <= tMaxZ) {
      t = tMaxY;
      tMaxY += tDeltaY;
      cy += stepY;
      face = stepY > 0 ? FP_FACE_NEG_Y : FP_FACE_POS_Y;
    } else {
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      cz += stepZ;
      face = stepZ > 0 ? FP_FACE_NEG_Z : FP_FACE_POS_Z;
    }
    if (t > maxDist) {
      missFpRay(out, maxDist);
      return;
    }
    if (!fpCellInGrid(cx, cy, cz)) {
      // Boundary rock shell: a placement surface, never removable.
      out.hit = true;
      out.x = cx;
      out.y = cy;
      out.z = cz;
      out.face = face;
      out.kind = "rock";
      out.distance = t;
      out.placeX = placeX;
      out.placeY = placeY;
      out.placeZ = placeZ;
      return;
    }
    const value = solid[fpCellIndex(cx, cy, cz)];
    if (value === FP_OPEN) {
      placeX = cx;
      placeY = cy;
      placeZ = cz;
      continue;
    }
    out.hit = true;
    out.x = cx;
    out.y = cy;
    out.z = cz;
    out.face = face;
    out.kind = kindForSolidity(value);
    out.distance = t;
    out.placeX = placeX;
    out.placeY = placeY;
    out.placeZ = placeZ;
    return;
  }
  missFpRay(out, maxDist);
}
