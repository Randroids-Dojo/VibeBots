/**
 * Pure kinematics for the miner robot rig. This module is the animation
 * half of the character art pipeline: the canvases own refs and the frame
 * loop, this module owns how inputs (walk distance, swing timers, facing)
 * become joint transforms. Pure TypeScript with no react/three imports so
 * poses are unit-testable, and both the mine canvas and the Holodeck
 * consume the identical motion.
 *
 * The rig is stateful where the motion is stateful (eased yaw, foot-locked
 * stride, eased leg swing): callers keep a MinerRigState per miner and pass
 * it back every frame. advanceMinerRig mutates that state in place (this
 * runs inside useFrame on phones) and returns the frame's pose.
 */

export const PICK_SWING_SECONDS = 0.18;
export const DIG_LUNGE_SECONDS = 0.16;
/** Length of the bounce-off animation when the pick can't cut the rock. */
export const BOUNCE_SECONDS = 0.28;
/** Idle hover bob: frequency multiplier on the clock and amplitude. */
export const IDLE_BOB_RATE = 2.4;
export const IDLE_BOB_AMPLITUDE = 0.018;
/** The body group's rest height above the cell floor. */
export const BODY_REST_Y = -0.14;

export interface MinerRigState {
  /** Foot-locked stride phase, advanced by distance actually travelled. */
  walkPhase: number;
  /** Eased body yaw toward the facing direction. */
  bodyYaw: number;
  /** Eased leg hip rotations. */
  legLRotX: number;
  legRRotX: number;
}

export interface MinerRigInputs {
  /** Clock seconds (drives the idle bob). */
  t: number;
  /** Frame seconds (drives the easings). */
  delta: number;
  /** Walk direction: -1 left, 1 right, 0 camera-facing. */
  facing: number;
  /** World distance moved this frame; the stride is locked to it. */
  stepDistance: number;
  /** Remaining x distance to the glide target (drives the walk lean). */
  leanVx: number;
  /** Seconds left of the pick swing (0 when at rest). */
  swing: number;
  /** Seconds left of the too-hard rebuff bounce (overrides swing). */
  bounce: number;
  /** Dig lunge toward the struck cell, with seconds left in t. */
  lunge: { x: number; y: number; t: number };
  /** Crush squash frame (the falling rock has landed). */
  crushed: boolean;
  /** Freeze the idle bob for a still frame (Holodeck pause). */
  still: boolean;
}

export interface MinerPose {
  body: {
    posX: number;
    posY: number;
    rotY: number;
    rotZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
  };
  legL: { rotX: number; posY: number };
  legR: { rotX: number; posY: number };
  arm: { rotZ: number };
}

/** A fresh rest-pose input set. A factory rather than a shared constant:
 * inputs carry a nested lunge object, and a shared instance would alias
 * it into every naive spread. */
export function minerRigRestInputs(): MinerRigInputs {
  return {
    t: 0,
    delta: 0,
    facing: 0,
    stepDistance: 0,
    leanVx: 0,
    swing: 0,
    bounce: 0,
    lunge: { x: 0, y: 0, t: 0 },
    crushed: false,
    still: false,
  };
}

export function createMinerRigState(): MinerRigState {
  return { walkPhase: 0, bodyYaw: 0, legLRotX: 0, legRRotX: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Pick arm rotation for the current swing/bounce timers. */
export function minerArmRotZ(swing: number, bounce: number): number {
  if (bounce > 0) {
    // Too-hard rock: the pick slams down then judders back up instead
    // of biting in. Two phases: a quick slam to impact, then a damped
    // rebound that kicks past rest and settles.
    const e = 1 - bounce / BOUNCE_SECONDS; // 0 -> 1 elapsed
    if (e < 0.32) {
      const p = e / 0.32; // raised to impact
      return -2 * (1 - p) * (1 - p);
    }
    const p = (e - 0.32) / 0.68; // rebound and settle
    return Math.sin(p * Math.PI) * 0.85 * (1 - p * 0.6);
  }
  const k = swing / PICK_SWING_SECONDS;
  return -2.1 * k * k;
}

/**
 * Advance the rig one frame. Mutates `state` in place (hot path) and
 * returns the pose to apply to the miner's animated groups.
 */
export function advanceMinerRig(
  state: MinerRigState,
  inputs: MinerRigInputs,
): MinerPose {
  const { t, delta } = inputs;

  // Body language: face the walk direction, idle bob, dig lunge.
  const targetYaw = inputs.facing * 0.85;
  state.bodyYaw += (targetYaw - state.bodyYaw) * Math.min(1, delta * 8);
  const lk = inputs.lunge.t > 0 ? inputs.lunge.t / DIG_LUNGE_SECONDS : 0;
  const bob = inputs.still
    ? 0
    : Math.sin(t * IDLE_BOB_RATE) * IDLE_BOB_AMPLITUDE;
  const body = {
    posX: inputs.lunge.x * lk,
    posY: BODY_REST_Y + bob + inputs.lunge.y * lk,
    rotY: state.bodyYaw,
    // Lean into the glide while moving between cells.
    rotZ: clamp(-inputs.leanVx * 0.3, -0.16, 0.16),
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
  if (inputs.crushed) {
    body.scaleX = 1.26;
    body.scaleY = 0.58;
    body.scaleZ = 1.18;
    body.posY -= 0.12;
    body.rotZ += 0.24;
  }

  // Legs: a foot-locked walk cycle. The stride advances by the distance
  // actually travelled this frame (no skating), and the legs ease back
  // to a neutral stance when the bot stands still or digs.
  // Teleport-scale jumps (trip resets) must not spin the stride.
  const stepping = inputs.stepDistance > 0.0006 && inputs.stepDistance < 1;
  if (stepping) state.walkPhase += inputs.stepDistance * 10;
  const ph = state.walkPhase;
  const amp = stepping ? 0.6 : 0;
  const k = Math.min(1, delta * 12);
  state.legLRotX += (Math.sin(ph) * amp - state.legLRotX) * k;
  state.legRRotX += (Math.sin(ph + Math.PI) * amp - state.legRRotX) * k;
  // The leg swinging forward lifts a touch off the cell floor.
  const lift = stepping ? 0.02 : 0;
  const legL = {
    rotX: state.legLRotX,
    posY: BODY_REST_Y + Math.max(0, Math.sin(ph)) * lift,
  };
  const legR = {
    rotX: state.legRRotX,
    posY: BODY_REST_Y + Math.max(0, Math.sin(ph + Math.PI)) * lift,
  };

  return {
    body,
    legL,
    legR,
    arm: { rotZ: minerArmRotZ(inputs.swing, inputs.bounce) },
  };
}

/* ---- Showcase clips ----------------------------------------------------
 * Synthetic input generators for the Holodeck's Miner Showcase scenario:
 * each clip plays the real rig math on a deterministic loop so art and
 * animation changes can be inspected without playing the game. The clip
 * ids double as the scenario's select-control values, so the sim-side
 * registry never needs to import this module.
 */

export type MinerClipId = "idle" | "walk" | "dig" | "rebuff" | "crush";

export const MINER_CLIPS: readonly { id: MinerClipId; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "walk", label: "Walk" },
  { id: "dig", label: "Dig" },
  { id: "rebuff", label: "Rebuff" },
  { id: "crush", label: "Crush" },
] as const;

export function minerClipId(value: string | undefined): MinerClipId {
  return MINER_CLIPS.find((clip) => clip.id === value)?.id ?? MINER_CLIPS[0].id;
}

/** One dig action's worth of loop, matching the start-gear cadence feel. */
const DIG_LOOP_SECONDS = 0.62;
const REBUFF_LOOP_SECONDS = 0.9;
const WALK_SPEED = 1.35;

export function minerClipInputs(
  clip: MinerClipId,
  t: number,
  delta: number,
  still: boolean,
): MinerRigInputs {
  const base: MinerRigInputs = { ...minerRigRestInputs(), t, delta, still };
  if (still) return base;
  switch (clip) {
    case "idle":
      return base;
    case "walk":
      return {
        ...base,
        facing: 1,
        stepDistance: WALK_SPEED * delta,
        leanVx: 0.4,
      };
    case "dig": {
      const phase = t % DIG_LOOP_SECONDS;
      return {
        ...base,
        swing: Math.max(0, PICK_SWING_SECONDS - phase),
        lunge: { x: 0, y: -0.13, t: Math.max(0, DIG_LUNGE_SECONDS - phase) },
      };
    }
    case "rebuff": {
      const phase = t % REBUFF_LOOP_SECONDS;
      return { ...base, bounce: Math.max(0, BOUNCE_SECONDS - phase) };
    }
    case "crush":
      return { ...base, crushed: true };
  }
}
