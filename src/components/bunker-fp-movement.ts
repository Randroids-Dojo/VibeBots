import {
  FP_COLS,
  FP_DEPTH,
  FP_ROWS,
  FP_STAIR_NX,
  FP_STAIR_PX,
  FP_STAIR_PZ,
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
  if (Math.abs(px - gx) > 0.5 || Math.abs(-pz - gz) > 0.5) return null;
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

/** Cap the feet so the head does not ride a ramp up into a solid ceiling
 * cell in the capsule's column (a mis-built stair with no clearance blocks
 * the climb instead of clipping through). Returns the capped feet height. */
function stairCeilingCap(
  solid: FpSolidGrid,
  px: number,
  py: number,
  pz: number,
): number {
  const gx = Math.round(px);
  const gz = Math.round(-pz);
  if (gx < 0 || gx >= FP_COLS || gz < 0 || gz >= FP_DEPTH) return py;
  const headCellY = Math.floor(py + FP_CAPSULE_HEIGHT + 0.5 - 1e-6);
  if (headCellY < 0 || headCellY >= FP_ROWS) return py;
  if (!fpCellBlocks(solid[fpCellIndex(gx, headCellY, gz)])) return py;
  return Math.min(py, headCellY - 0.5 - FP_CAPSULE_HEIGHT);
}

export function stepFpMovement(
  state: FpMoveState,
  input: FpMoveInput,
  solid: FpSolidGrid,
  dt: number,
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

  state.grounded = false;
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

  // Ride a staircase ramp: within a stair cell the sloped surface is the
  // floor, so clamp the feet onto it (up while climbing, down while
  // descending), leaving a jump off the stair intact. A ceiling cap keeps
  // the head from riding into a solid cell above.
  const rampFloor = stairRampFloor(solid, state.px, state.py, state.pz);
  if (rampFloor !== null) {
    if (state.py <= rampFloor) {
      state.py = stairCeilingCap(solid, state.px, rampFloor, state.pz);
      if (state.vy < 0) state.vy = 0;
      state.grounded = true;
    } else if (state.vy <= 0) {
      state.py = stairCeilingCap(solid, state.px, rampFloor, state.pz);
      state.vy = 0;
      state.grounded = true;
    }
  }
}
