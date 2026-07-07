/**
 * Physically integrated crush tumble: the render-layer death animation
 * that replaces the static crumple frame when a falling block lands on
 * the miner. Pure TypeScript with no react/three imports, mirroring the
 * miner-rig contract: canvases own refs and the frame loop, this module
 * owns how time becomes joint transforms, so the motion is unit-testable
 * and the mine canvas and the Holodeck play the identical wreck.
 *
 * The body integrates as a rigid slab (gravity, ground bounces with
 * restitution and friction, decaying spin) while the limbs flail on
 * damped oscillators; everything blends into the exact rig crumple pose
 * as the energy dies, so the wreck the trip report hovers over matches
 * the pose the game has always shown. Deliberately not rapier: the mine
 * page never loads the physics WASM today, and a cosmetic two-second
 * tumble does not justify fetching it on the mobile-critical path.
 */

import { BODY_REST_Y, createMinerPose, type MinerPose } from "./miner-rig";

/** Seconds of live physics before the pose eases into the crumple. */
export const CRUSH_TUMBLE_SECONDS = 1.55;
/** Seconds the settle blend takes after the live physics window. */
export const CRUSH_TUMBLE_SETTLE_SECONDS = 0.45;

const GRAVITY = 10.5;
const RESTITUTION = 0.4;
const GROUND_Y = -0.3;

export interface CrushTumbleState {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotZ: number;
  vrot: number;
  /** Squash pulse energy, refreshed by each ground contact. */
  squash: number;
  bounces: number;
  /** Deterministic 0..1 variance so every crush reads a little different. */
  seed: number;
}

/** The rig's designed crumple, the tumble's final resting pose. Never
 * mutated: advanceCrushTumble copies or blends it into the out pose. */
const CRUMPLE_REST: MinerPose = {
  body: {
    posX: 0,
    posY: BODY_REST_Y - 0.16,
    rotY: 0,
    rotZ: 0.34,
    scaleX: 1.06,
    scaleY: 0.82,
    scaleZ: 1.04,
  },
  legL: { rotX: 0.85, posY: BODY_REST_Y },
  legR: { rotX: -0.55, posY: BODY_REST_Y },
  arm: { rotZ: 1.15 },
};

export function createCrushTumble(seed: number): CrushTumbleState {
  const s = seed - Math.floor(seed);
  const dir = s < 0.5 ? -1 : 1;
  return {
    t: 0,
    x: 0,
    y: BODY_REST_Y,
    // The block hammers the bot down and kicks it sideways: a low, hard
    // launch that pops off the floor rather than a cartoon moon-shot.
    vx: dir * (0.5 + s * 0.7),
    vy: 1.6 + s * 1.1,
    rotZ: 0,
    vrot: -dir * (5 + s * 5),
    squash: 1,
    bounces: 0,
    seed: s,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function crushTumbleSettled(state: CrushTumbleState): boolean {
  return state.t >= CRUSH_TUMBLE_SECONDS + CRUSH_TUMBLE_SETTLE_SECONDS;
}

/**
 * Advance the tumble one frame. Mutates `state` in place and writes the
 * frame's pose into the caller-owned `out` (this runs inside useFrame,
 * so it must not allocate). Time steps are clamped so a hitching device
 * cannot launch the wreck through the floor. Returns `out`.
 */
export function advanceCrushTumble(
  state: CrushTumbleState,
  delta: number,
  out: MinerPose = createMinerPose(),
): MinerPose {
  const dt = clamp(delta, 0, 1 / 20);
  state.t += dt;
  if (state.t < CRUSH_TUMBLE_SECONDS) {
    state.vy -= GRAVITY * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.rotZ += state.vrot * dt;
    if (state.y <= GROUND_Y && state.vy < 0) {
      state.y = GROUND_Y;
      state.vy = -state.vy * RESTITUTION;
      state.vx *= 0.55;
      state.vrot *= -0.5;
      state.bounces += 1;
      state.squash = 1;
    }
    state.squash = Math.max(0, state.squash - dt * 4);
    // Keep the wreck inside its crush cell: the block that did this is
    // sitting right there.
    state.x = clamp(state.x, -0.34, 0.34);
  }

  // Blend weight: pure physics through the live window, then an eased
  // hand-off into the designed crumple so the report hovers over the
  // same wreck the game has always framed.
  const settleT =
    (state.t - CRUSH_TUMBLE_SECONDS) / CRUSH_TUMBLE_SETTLE_SECONDS;
  const w = clamp(1 - settleT, 0, 1);
  if (w <= 0) {
    copyPose(CRUMPLE_REST, out);
    return out;
  }

  const squashY = 1 - state.squash * 0.3;
  const flail = Math.exp(-state.t * 2.2);
  const wave = Math.sin(state.t * 16 + state.seed * 6.28);
  const body = out.body;
  body.posX = state.x;
  body.posY = state.y - 0.02;
  body.rotY = 0;
  body.rotZ = state.rotZ;
  body.scaleX = 1 + state.squash * 0.18;
  body.scaleY = squashY;
  body.scaleZ = 1 + state.squash * 0.12;
  out.legL.rotX = wave * 1.1 * flail;
  out.legL.posY = BODY_REST_Y;
  out.legR.rotX = -wave * 0.9 * flail;
  out.legR.posY = BODY_REST_Y;
  out.arm.rotZ = 0.6 + wave * 0.9 * flail;
  if (w >= 1) return out;
  const rest = CRUMPLE_REST;
  body.posX = mixToward(body.posX, rest.body.posX, w);
  body.posY = mixToward(body.posY, rest.body.posY, w);
  body.rotZ = mixToward(body.rotZ, rest.body.rotZ, w);
  body.scaleX = mixToward(body.scaleX, rest.body.scaleX, w);
  body.scaleY = mixToward(body.scaleY, rest.body.scaleY, w);
  body.scaleZ = mixToward(body.scaleZ, rest.body.scaleZ, w);
  out.legL.rotX = mixToward(out.legL.rotX, rest.legL.rotX, w);
  out.legR.rotX = mixToward(out.legR.rotX, rest.legR.rotX, w);
  out.arm.rotZ = mixToward(out.arm.rotZ, rest.arm.rotZ, w);
  return out;
}

/** Weighted blend: w=1 keeps the live value, w=0 lands on the rest. */
function mixToward(live: number, rest: number, w: number): number {
  return rest + (live - rest) * w;
}

function copyPose(from: MinerPose, to: MinerPose): void {
  to.body.posX = from.body.posX;
  to.body.posY = from.body.posY;
  to.body.rotY = from.body.rotY;
  to.body.rotZ = from.body.rotZ;
  to.body.scaleX = from.body.scaleX;
  to.body.scaleY = from.body.scaleY;
  to.body.scaleZ = from.body.scaleZ;
  to.legL.rotX = from.legL.rotX;
  to.legL.posY = from.legL.posY;
  to.legR.rotX = from.legR.rotX;
  to.legR.posY = from.legR.posY;
  to.arm.rotZ = from.arm.rotZ;
}
