import {
  FP_COLS,
  FP_DEPTH,
  FP_ROWS,
  type FpSolidGrid,
  fpCellBlocks,
  fpCellIndex,
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
  /** Camera yaw in radians; yaw 0 faces world -z. */
  yaw: number;
}

enum Axis {
  X = 0,
  Z = 1,
  Y = 2,
}

/**
 * Push the capsule box out of every blocking cell it overlaps, along
 * one axis only (the axis that just integrated). Scans only the cells
 * the box overlaps, all scalar math. Returns true when a downward Y
 * resolution landed the capsule on a cell top.
 */
function resolveAxis(
  state: FpMoveState,
  solid: FpSolidGrid,
  axis: Axis,
): boolean {
  const r = FP_CAPSULE_RADIUS;
  let landed = false;
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
        } else if (axis === Axis.Z) {
          if (state.pz >= -gz) state.pz += overlapZ;
          else state.pz -= overlapZ;
          state.vz = 0;
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
  return landed;
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
  resolveAxis(state, solid, Axis.X);

  state.pz += state.vz * clamped;
  if (state.pz < MIN_WORLD_Z) {
    state.pz = MIN_WORLD_Z;
    state.vz = Math.max(0, state.vz);
  } else if (state.pz > MAX_WORLD_Z) {
    state.pz = MAX_WORLD_Z;
    state.vz = Math.min(0, state.vz);
  }
  resolveAxis(state, solid, Axis.Z);

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
}
