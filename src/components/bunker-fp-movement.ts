import type { BunkerSlot } from "@/sim/bunker";
import {
  FP_COLS,
  FP_DEPTH,
  FP_FACE_ROOF,
  FP_FACE_WALL_NX,
  FP_FACE_WALL_NZ,
  FP_FACE_WALL_PX,
  FP_FACE_WALL_PZ,
  FP_FLOOR_SLAB,
  FP_ROWS,
  FP_SLAB_HEIGHT,
  FP_STAIR_NX,
  FP_STAIR_PX,
  FP_STAIR_PZ,
  type FpFaceGrid,
  type FpSolidGrid,
  fpCellBlocks,
  fpCellIndex,
  fpCellIsStair,
} from "./bunker-fp-grid";

/**
 * First-person movement for the bunker viewer: gravity, jump, and
 * axis-separated AABB push-out against the solid grid. Pure module,
 * unit-tested in node, and allocation-free: stepFpMovement touches
 * only scalar locals and the caller-owned state object, so it is safe
 * inside useFrame (frame-loop-performance rule).
 *
 * The capsule is treated as a box: half-extents FP_CAPSULE_RADIUS in
 * x/z, FP_CAPSULE_HEIGHT tall, with state.py at the capsule BOTTOM
 * (the feet). The eye sits at py + FP_EYE_HEIGHT.
 */

export const FP_EYE_HEIGHT = 0.72;
export const FP_CAPSULE_RADIUS = 0.3;
export const FP_CAPSULE_HEIGHT = 0.95;
export const FP_WALK_SPEED = 3.0;
export const FP_GRAVITY = 22;
export const FP_JUMP_VELOCITY = 7.1;
export const FP_VEL_SMOOTHING = 12;
export const FP_DT_CLAMP = 0.05;
/** Vertical reach of a staircase ramp: the feet ride the sloped surface
 * when they are within this of it, so walking into a stair from the floor
 * climbs smoothly, yet walking off the top edge into open air falls
 * (nothing within reach) and a jump off a stair is not squashed. Half a
 * cell keeps it under the one-cell rise a single stair spans. */
export const FP_STAIR_REACH = 0.55;
/** Horizontal run over which a stair reaches full height; the remaining
 * (1 - run) is a flat top landing. The shelf must be wider than the
 * capsule radius so the mover's body tops out and clears an adjacent
 * solid landing cell before the feet would bump its face. */
export const FP_STAIR_RUN = 0.6;

/** Interior AABB: cell centers span 0..6 in x, 0..4 in y, 0..-4 in
 * world z; the walls sit half a cell beyond the outermost centers. */
const MIN_X = -0.5 + FP_CAPSULE_RADIUS;
const MAX_X = FP_COLS - 1 + 0.5 - FP_CAPSULE_RADIUS;
const MIN_WORLD_Z = -(FP_DEPTH - 1) - 0.5 + FP_CAPSULE_RADIUS;
const MAX_WORLD_Z = 0.5 - FP_CAPSULE_RADIUS;
const FLOOR_Y = -0.5;
const CEILING_Y = FP_ROWS - 1 + 0.5 - FP_CAPSULE_HEIGHT;

export interface FpMoveState {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
}

export interface FpMoveInput {
  /** -1..1, positive walks toward where the camera faces. */
  forward: number;
  /** -1..1, positive strafes right. */
  strafe: number;
  /** Edge-triggered: true grants one takeoff when grounded. */
  jump: boolean;
  /** Minecraft-style auto-jump (F-094), on for coarse-pointer
   * sessions: walking into a one-block step hops it automatically.
   * Desktop keeps this off and jumps with Space instead. */
  autoJump: boolean;
  /** Camera yaw in radians; yaw 0 faces world -z. */
  yaw: number;
}

/**
 * True when a cell's 1x1x1 AABB overlaps the player's capsule box (the
 * same box the movement resolver uses: half-extents FP_CAPSULE_RADIUS
 * in x/z, FP_CAPSULE_HEIGHT tall from the feet at py). The build
 * placement guard rejects place cells that would entomb the player.
 * Pure scalar math, safe per frame.
 */
export function fpCellIntersectsCapsule(
  cellX: number,
  cellY: number,
  cellZ: number,
  px: number,
  py: number,
  pz: number,
): boolean {
  return (
    Math.abs(px - cellX) < 0.5 + FP_CAPSULE_RADIUS &&
    py < cellY + 0.5 &&
    py + FP_CAPSULE_HEIGHT > cellY - 0.5 &&
    Math.abs(pz - -cellZ) < 0.5 + FP_CAPSULE_RADIUS
  );
}

/**
 * True when a thin slot would overlap the player's current capsule. Floors
 * are allowed under the player because the next movement step lifts the feet
 * onto the walkable slab. Other faces use their rendered 0.08 thickness.
 */
export function fpSlotIntersectsCapsule(
  slot: BunkerSlot | undefined,
  cellX: number,
  cellY: number,
  cellZ: number,
  px: number,
  py: number,
  pz: number,
): boolean {
  if (slot === undefined || slot === "mount") {
    return fpCellIntersectsCapsule(cellX, cellY, cellZ, px, py, pz);
  }
  if (slot === "floor") return false;

  let minX = cellX - 0.5;
  let maxX = cellX + 0.5;
  let minY = cellY - 0.5;
  const maxY = cellY + 0.5;
  let minZ = -cellZ - 0.5;
  let maxZ = -cellZ + 0.5;
  if (slot === "wall-px") minX = cellX + 0.42;
  else if (slot === "wall-nx") maxX = cellX - 0.42;
  else if (slot === "wall-pz") maxZ = -cellZ - 0.42;
  else if (slot === "wall-nz") minZ = -cellZ + 0.42;
  else if (slot === "roof") minY = cellY + 0.42;

  return (
    px + FP_CAPSULE_RADIUS > minX &&
    px - FP_CAPSULE_RADIUS < maxX &&
    py < maxY &&
    py + FP_CAPSULE_HEIGHT > minY &&
    pz + FP_CAPSULE_RADIUS > minZ &&
    pz - FP_CAPSULE_RADIUS < maxZ
  );
}

enum Axis {
  X = 0,
  Z = 1,
  Y = 2,
}

/** Module scratch: the last blocking cell an X or Z resolution pushed
 * the capsule out of this step (grid coords). Hoisted so the per-frame
 * step allocates nothing; only meaningful right after a horizontal
 * resolveAxis pass returned true. */
let axisBlockerX = 0;
let axisBlockerY = 0;
let axisBlockerZ = 0;

function fpWallCellOverlapsCapsuleY(state: FpMoveState, y: number): boolean {
  return state.py < y + 0.5 && state.py + FP_CAPSULE_HEIGHT > y - 0.5;
}

function resolveWallFacesX(
  state: FpMoveState,
  walls: FpFaceGrid,
  beforeX: number,
): void {
  if (state.vx === 0) return;
  const positive = state.vx > 0;
  const beforeEdge =
    beforeX + (positive ? FP_CAPSULE_RADIUS : -FP_CAPSULE_RADIUS);
  const afterEdge =
    state.px + (positive ? FP_CAPSULE_RADIUS : -FP_CAPSULE_RADIUS);
  for (let z = 0; z < FP_DEPTH; z++) {
    const cellMinZ = -z - 0.5;
    const cellMaxZ = -z + 0.5;
    if (
      state.pz + FP_CAPSULE_RADIUS <= cellMinZ ||
      state.pz - FP_CAPSULE_RADIUS >= cellMaxZ
    ) {
      continue;
    }
    for (let y = 0; y < FP_ROWS; y++) {
      if (!fpWallCellOverlapsCapsuleY(state, y)) continue;
      for (let x = 0; x < FP_COLS; x++) {
        const bit = positive ? FP_FACE_WALL_PX : FP_FACE_WALL_NX;
        if ((walls[fpCellIndex(x, y, z)] & bit) === 0) continue;
        const plane = x + (positive ? 0.5 : -0.5);
        const crossed = positive
          ? beforeEdge <= plane && afterEdge > plane
          : beforeEdge >= plane && afterEdge < plane;
        if (!crossed) continue;
        state.px = plane + (positive ? -FP_CAPSULE_RADIUS : FP_CAPSULE_RADIUS);
        state.vx = 0;
        return;
      }
    }
  }
}

function resolveWallFacesZ(
  state: FpMoveState,
  walls: FpFaceGrid,
  beforeZ: number,
): void {
  if (state.vz === 0) return;
  const positive = state.vz > 0;
  const beforeEdge =
    beforeZ + (positive ? FP_CAPSULE_RADIUS : -FP_CAPSULE_RADIUS);
  const afterEdge =
    state.pz + (positive ? FP_CAPSULE_RADIUS : -FP_CAPSULE_RADIUS);
  for (let z = 0; z < FP_DEPTH; z++) {
    const bit = positive ? FP_FACE_WALL_NZ : FP_FACE_WALL_PZ;
    const plane = -z + (positive ? 0.5 : -0.5);
    const crossed = positive
      ? beforeEdge <= plane && afterEdge > plane
      : beforeEdge >= plane && afterEdge < plane;
    if (!crossed) continue;
    for (let y = 0; y < FP_ROWS; y++) {
      if (!fpWallCellOverlapsCapsuleY(state, y)) continue;
      for (let x = 0; x < FP_COLS; x++) {
        if (
          state.px + FP_CAPSULE_RADIUS <= x - 0.5 ||
          state.px - FP_CAPSULE_RADIUS >= x + 0.5
        ) {
          continue;
        }
        if ((walls[fpCellIndex(x, y, z)] & bit) === 0) continue;
        state.pz = plane + (positive ? -FP_CAPSULE_RADIUS : FP_CAPSULE_RADIUS);
        state.vz = 0;
        return;
      }
    }
  }
}

function resolveRoofFacesY(
  state: FpMoveState,
  barriers: FpFaceGrid,
  beforeY: number,
): boolean {
  if (state.vy === 0) return false;
  const rising = state.vy > 0;
  const beforeEdge = rising ? beforeY + FP_CAPSULE_HEIGHT : beforeY;
  const afterEdge = rising ? state.py + FP_CAPSULE_HEIGHT : state.py;
  const r = FP_CAPSULE_RADIUS;
  const x0 = Math.max(0, Math.ceil(state.px - r - 0.5 + 1e-6));
  const x1 = Math.min(FP_COLS - 1, Math.floor(state.px + r + 0.5 - 1e-6));
  const z0 = Math.max(0, Math.ceil(-(state.pz + r) - 0.5 + 1e-6));
  const z1 = Math.min(FP_DEPTH - 1, Math.floor(-(state.pz - r) + 0.5 - 1e-6));
  for (let y = 0; y < FP_ROWS; y++) {
    const plane = rising ? y + 0.5 - FP_SLAB_HEIGHT : y + 0.5;
    const crossed = rising
      ? beforeEdge <= plane && afterEdge > plane
      : beforeEdge >= plane && afterEdge < plane;
    if (!crossed) continue;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if ((barriers[fpCellIndex(x, y, z)] & FP_FACE_ROOF) === 0) continue;
        state.py = rising ? plane - FP_CAPSULE_HEIGHT : plane;
        state.vy = 0;
        return !rising;
      }
    }
  }
  return false;
}

/**
 * Push the capsule box out of every blocking cell it overlaps, along
 * one axis only (the axis that just integrated). Scans only the cells
 * the box overlaps, all scalar math. For the Y axis, returns true when
 * a downward resolution landed the capsule on a cell top; for X and Z,
 * returns true when any blocking cell pushed the capsule out (the
 * blocker's grid cell lands in the axis-blocker scratch).
 */
function resolveAxis(
  state: FpMoveState,
  solid: FpSolidGrid,
  axis: Axis,
): boolean {
  const r = FP_CAPSULE_RADIUS;
  let landed = false;
  let collided = false;
  const minX = state.px - r;
  const maxX = state.px + r;
  const minY = state.py;
  const maxY = state.py + FP_CAPSULE_HEIGHT;
  const minZ = state.pz - r;
  const maxZ = state.pz + r;
  // Cell (x, y, z) occupies world x [x-0.5, x+0.5], y [y-0.5, y+0.5],
  // world z [-z-0.5, -z+0.5].
  const x0 = Math.max(0, Math.ceil(minX - 0.5));
  const x1 = Math.min(FP_COLS - 1, Math.floor(maxX + 0.5));
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(FP_ROWS - 1, Math.floor(maxY + 0.5));
  const gz0 = Math.max(0, Math.ceil(-maxZ - 0.5));
  const gz1 = Math.min(FP_DEPTH - 1, Math.floor(-minZ + 0.5));
  for (let gz = gz0; gz <= gz1; gz++) {
    const cellMinZ = -gz - 0.5;
    const cellMaxZ = -gz + 0.5;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!fpCellBlocks(solid[fpCellIndex(x, y, gz)])) continue;
        // Re-read the live box on every hit: an earlier push-out this
        // pass may already have cleared this cell.
        const overlapX =
          Math.min(state.px + r, x + 0.5) - Math.max(state.px - r, x - 0.5);
        if (overlapX <= 0) continue;
        const overlapY =
          Math.min(state.py + FP_CAPSULE_HEIGHT, y + 0.5) -
          Math.max(state.py, y - 0.5);
        if (overlapY <= 0) continue;
        const overlapZ =
          Math.min(state.pz + r, cellMaxZ) - Math.max(state.pz - r, cellMinZ);
        if (overlapZ <= 0) continue;
        if (axis === Axis.X) {
          if (state.px >= x) state.px += overlapX;
          else state.px -= overlapX;
          state.vx = 0;
          collided = true;
          axisBlockerX = x;
          axisBlockerY = y;
          axisBlockerZ = gz;
        } else if (axis === Axis.Z) {
          if (state.pz >= -gz) state.pz += overlapZ;
          else state.pz -= overlapZ;
          state.vz = 0;
          collided = true;
          axisBlockerX = x;
          axisBlockerY = y;
          axisBlockerZ = gz;
        } else {
          const center = state.py + FP_CAPSULE_HEIGHT * 0.5;
          if (center >= y) {
            // Resolved from below: the capsule lands on the cell top.
            state.py += overlapY;
            if (state.vy <= 0) landed = true;
            state.vy = Math.max(0, state.vy);
          } else {
            state.py -= overlapY;
            state.vy = Math.min(0, state.vy);
          }
        }
      }
    }
  }
  return axis === Axis.Y ? landed : collided;
}

/** Passable for a hop: inside the grid and not a blocking cell. Above
 * the top row counts as blocked (the room ceiling would bonk). */
function fpHopCellPassable(
  solid: FpSolidGrid,
  x: number,
  y: number,
  z: number,
): boolean {
  if (x < 0 || x >= FP_COLS || y >= FP_ROWS || z < 0 || z >= FP_DEPTH) {
    return false;
  }
  return !fpCellBlocks(solid[fpCellIndex(x, y, z)]);
}

/**
 * Minecraft-style auto-jump (F-094): a grounded mover pressing into a
 * blocking cell hops it with the manual jump impulse when the step is
 * exactly one block tall at feet level: the cell above the blocker is
 * passable (a landing, not the face of a taller wall) AND the two
 * cells above the mover's own feet cell are passable, so the arc
 * cannot bonk a ceiling. Reads the axis-blocker scratch the X/Z
 * resolution just recorded; scalar math only, safe per frame.
 */
function maybeAutoJump(state: FpMoveState, solid: FpSolidGrid): void {
  // A grounded capsule's feet rest on a cell boundary; the epsilon
  // keeps the boundary in the cell above it.
  const feetY = Math.floor(state.py + 0.5 + 1e-6);
  if (axisBlockerY !== feetY) return;
  if (!fpHopCellPassable(solid, axisBlockerX, feetY + 1, axisBlockerZ)) return;
  const cellX = Math.round(state.px);
  const cellZ = Math.round(-state.pz);
  if (!fpHopCellPassable(solid, cellX, feetY + 1, cellZ)) return;
  if (!fpHopCellPassable(solid, cellX, feetY + 2, cellZ)) return;
  state.vy = FP_JUMP_VELOCITY;
}

/**
 * Sloped surface height (world y) of a stair cell at the given world XZ.
 * `t` runs 0 at the ramp's low edge to 1 at its high edge along the ascent
 * axis; the surface spans the cell bottom (gy - 0.5) to top (gy + 0.5).
 * Grid +z is world -z, so the +z stair rises as world z decreases. Scalar
 * math only.
 */
function stairSurface(
  value: number,
  gx: number,
  gy: number,
  gz: number,
  px: number,
  pz: number,
): number {
  let t: number;
  if (value === FP_STAIR_PX) t = px - gx + 0.5;
  else if (value === FP_STAIR_NX) t = gx - px + 0.5;
  else if (value === FP_STAIR_PZ) t = -gz - pz + 0.5;
  else t = pz + gz + 0.5;
  // Rise over the first FP_STAIR_RUN of the cell, then a flat top landing.
  const height = t <= 0 ? 0 : t >= FP_STAIR_RUN ? 1 : t / FP_STAIR_RUN;
  return gy - 0.5 + height;
}

/**
 * The highest stair-ramp surface within reach of the feet in the capsule's
 * own column, or null when the mover is not over a stair. Uses the capsule
 * center for the footprint test; a diagonal flight's cells meet at equal
 * height on their shared edge, so the surface stays continuous as the
 * center crosses between columns. Bounded scalar scan, safe per frame.
 */
function stairRampFloor(
  solid: FpSolidGrid,
  px: number,
  py: number,
  pz: number,
): number | null {
  const gx = Math.round(px);
  const gz = Math.round(-pz);
  if (gx < 0 || gx >= FP_COLS || gz < 0 || gz >= FP_DEPTH) return null;
  let best: number | null = null;
  for (let gy = 0; gy < FP_ROWS; gy++) {
    const value = solid[fpCellIndex(gx, gy, gz)];
    if (!fpCellIsStair(value)) continue;
    const surface = stairSurface(value, gx, gy, gz, px, pz);
    if (surface < py - FP_STAIR_REACH || surface > py + FP_STAIR_REACH)
      continue;
    if (best === null || surface > best) best = surface;
  }
  return best;
}

/** Highest step a mover takes onto a slab's top without jumping: covers the
 * 0.08 lip when walking onto a deck from a stair top or the ground, while a
 * deck a full level up stays out of reach. */
export const FP_SLAB_STEP_UP = 0.12;

/**
 * The walkable slab top the mover lands on this step, or null. Scans every
 * FP_FLOOR_SLAB cell the capsule's XZ footprint overlaps (all rows, bounded
 * scalar scan, allocation-free) and takes the highest top that is (a) not
 * more than a small step above the feet BEFORE the vertical move, so a deck
 * overhead is never magnetic, and (b) at or above the feet AFTER it, so a
 * fast fall that crosses the thin top in one step still catches. The caller
 * gates on vy <= 0, which is what makes the slab a one-way platform: a
 * rising jump passes through from below and lands on the way down.
 */
function fpSlabLanding(
  solid: FpSolidGrid,
  px: number,
  feetBefore: number,
  py: number,
  pz: number,
): number | null {
  const r = FP_CAPSULE_RADIUS;
  const x0 = Math.max(0, Math.ceil(px - r - 0.5 + 1e-6));
  const x1 = Math.min(FP_COLS - 1, Math.floor(px + r + 0.5 - 1e-6));
  const gz0 = Math.max(0, Math.ceil(-(pz + r) - 0.5 + 1e-6));
  const gz1 = Math.min(FP_DEPTH - 1, Math.floor(-(pz - r) + 0.5 - 1e-6));
  let best: number | null = null;
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = 0; gy < FP_ROWS; gy++) {
        if (solid[fpCellIndex(gx, gy, gz)] !== FP_FLOOR_SLAB) continue;
        const top = gy - 0.5 + FP_SLAB_HEIGHT;
        if (top > feetBefore + FP_SLAB_STEP_UP) continue;
        if (py > top) continue;
        if (best === null || top > best) best = top;
      }
    }
  }
  return best;
}

/** Cap the feet so the head does not ride a ramp up into a solid ceiling
 * (a mis-built stair with no clearance blocks the climb instead of clipping
 * through). Scans every cell the capsule's XZ footprint overlaps at the head
 * row, not just its center column, so a blocker at a cell boundary still
 * stops it. Returns the capped feet height. */
function stairCeilingCap(
  solid: FpSolidGrid,
  px: number,
  py: number,
  pz: number,
): number {
  const headCellY = Math.floor(py + FP_CAPSULE_HEIGHT + 0.5 - 1e-6);
  if (headCellY < 0 || headCellY >= FP_ROWS) return py;
  const r = FP_CAPSULE_RADIUS;
  // The 1e-6 nudge drops cells the capsule only grazes at an exact
  // boundary (matching resolveAxis's overlap-greater-than-zero skip), so a
  // ceiling column the body merely touches does not falsely cap the climb.
  const x0 = Math.max(0, Math.ceil(px - r - 0.5 + 1e-6));
  const x1 = Math.min(FP_COLS - 1, Math.floor(px + r + 0.5 - 1e-6));
  const gz0 = Math.max(0, Math.ceil(-(pz + r) - 0.5 + 1e-6));
  const gz1 = Math.min(FP_DEPTH - 1, Math.floor(-(pz - r) + 0.5 - 1e-6));
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = x0; gx <= x1; gx++) {
      if (fpCellBlocks(solid[fpCellIndex(gx, headCellY, gz)])) {
        return Math.min(py, headCellY - 0.5 - FP_CAPSULE_HEIGHT);
      }
    }
  }
  return py;
}

function thinRoofCeilingCap(
  barriers: FpFaceGrid | undefined,
  px: number,
  py: number,
  pz: number,
): number {
  if (!barriers) return py;
  const r = FP_CAPSULE_RADIUS;
  const x0 = Math.max(0, Math.ceil(px - r - 0.5 + 1e-6));
  const x1 = Math.min(FP_COLS - 1, Math.floor(px + r + 0.5 - 1e-6));
  const z0 = Math.max(0, Math.ceil(-(pz + r) - 0.5 + 1e-6));
  const z1 = Math.min(FP_DEPTH - 1, Math.floor(-(pz - r) + 0.5 - 1e-6));
  let capped = py;
  for (let y = 0; y < FP_ROWS; y++) {
    const underside = y + 0.5 - FP_SLAB_HEIGHT;
    if (capped >= underside || capped + FP_CAPSULE_HEIGHT <= underside) {
      continue;
    }
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if ((barriers[fpCellIndex(x, y, z)] & FP_FACE_ROOF) === 0) continue;
        capped = Math.min(capped, underside - FP_CAPSULE_HEIGHT);
      }
    }
  }
  return capped;
}

export function stepFpMovement(
  state: FpMoveState,
  input: FpMoveInput,
  solid: FpSolidGrid,
  dt: number,
  walls?: FpFaceGrid,
): void {
  const clamped = Math.min(dt, FP_DT_CLAMP);
  if (clamped <= 0) return;

  // Desired XZ velocity from the yaw basis (yaw 0 faces -z).
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  let desiredX = (-sin * input.forward + cos * input.strafe) * FP_WALK_SPEED;
  let desiredZ = (-cos * input.forward - sin * input.strafe) * FP_WALK_SPEED;
  const desiredSq = desiredX * desiredX + desiredZ * desiredZ;
  if (desiredSq > FP_WALK_SPEED * FP_WALK_SPEED) {
    const scale = FP_WALK_SPEED / Math.sqrt(desiredSq);
    desiredX *= scale;
    desiredZ *= scale;
  }
  const lerp = 1 - Math.exp(-FP_VEL_SMOOTHING * clamped);
  state.vx += (desiredX - state.vx) * lerp;
  state.vz += (desiredZ - state.vz) * lerp;

  state.vy -= FP_GRAVITY * clamped;
  if (input.jump && state.grounded) state.vy = FP_JUMP_VELOCITY;

  // Integrate and resolve one axis at a time (X, then Z, then Y) so a
  // wall slide never wedges into a corner.
  const beforeX = state.px;
  state.px += state.vx * clamped;
  if (state.px < MIN_X) {
    state.px = MIN_X;
    state.vx = Math.max(0, state.vx);
  } else if (state.px > MAX_X) {
    state.px = MAX_X;
    state.vx = Math.min(0, state.vx);
  }
  if (resolveAxis(state, solid, Axis.X) && input.autoJump && state.grounded) {
    maybeAutoJump(state, solid);
  }
  if (walls) resolveWallFacesX(state, walls, beforeX);

  const beforeZ = state.pz;
  state.pz += state.vz * clamped;
  if (state.pz < MIN_WORLD_Z) {
    state.pz = MIN_WORLD_Z;
    state.vz = Math.max(0, state.vz);
  } else if (state.pz > MAX_WORLD_Z) {
    state.pz = MAX_WORLD_Z;
    state.vz = Math.min(0, state.vz);
  }
  if (resolveAxis(state, solid, Axis.Z) && input.autoJump && state.grounded) {
    maybeAutoJump(state, solid);
  }
  if (walls) resolveWallFacesZ(state, walls, beforeZ);

  state.grounded = false;
  // Feet height before the vertical move: the slab ride below needs it to
  // catch a fast fall that crosses a deck's thin top in one step.
  const feetBefore = state.py;
  state.py += state.vy * clamped;
  if (state.py <= FLOOR_Y) {
    state.py = FLOOR_Y;
    if (state.vy <= 0) {
      state.vy = 0;
      state.grounded = true;
    }
  } else if (state.py > CEILING_Y) {
    state.py = CEILING_Y;
    state.vy = Math.min(0, state.vy);
  }
  if (resolveAxis(state, solid, Axis.Y)) state.grounded = true;
  if (walls && resolveRoofFacesY(state, walls, feetBefore)) {
    state.grounded = true;
  }

  // Ride a staircase ramp: within a stair cell the sloped surface is the
  // floor, so clamp the feet onto it (up while climbing, down while
  // descending), leaving a jump off the stair intact. Clamp when the feet
  // are at or below the ramp (climbing) or settling onto it (vy <= 0); a
  // ceiling cap keeps the head from riding into a solid cell above.
  const rampFloor = stairRampFloor(solid, state.px, state.py, state.pz);
  if (rampFloor !== null && (state.py <= rampFloor || state.vy <= 0)) {
    state.py = thinRoofCeilingCap(
      walls,
      state.px,
      stairCeilingCap(solid, state.px, rampFloor, state.pz),
      state.pz,
    );
    if (state.vy < 0) state.vy = 0;
    state.grounded = true;
  }

  // Ride a floor slab (thin deck at the bottom of its cell): a falling or
  // walking mover whose feet reach the slab's top lands on it, including a
  // small step up onto the 0.08 lip from a stair top or the ground. Rising
  // movers pass through from below (one-way platform), then land on the
  // way down, so a jump in the room under a deck cannot wedge on it.
  if (state.vy <= 0) {
    const slabTop = fpSlabLanding(
      solid,
      state.px,
      feetBefore,
      state.py,
      state.pz,
    );
    if (slabTop !== null) {
      state.py = thinRoofCeilingCap(
        walls,
        state.px,
        stairCeilingCap(solid, state.px, slabTop, state.pz),
        state.pz,
      );
      state.vy = 0;
      state.grounded = true;
    }
  }
}
