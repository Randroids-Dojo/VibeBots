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
/** Downward speed (world units/sec) at which the fall pose reads full
 * (F-057). Below it the pose eases out toward the grounded stance. */
export const FALL_POSE_SPEED = 2.2;
/** Seconds the landing squash takes to spring back after a fall. */
export const LAND_SQUASH_SECONDS = 0.22;

export interface MinerRigState {
  /** Foot-locked stride phase, advanced by distance actually travelled. */
  walkPhase: number;
  /** Eased body yaw toward the facing direction. */
  bodyYaw: number;
  /** Eased leg hip rotations. */
  legLRotX: number;
  legRRotX: number;
  /** Eased 0..1 blend into the fall pose, so drops read as falls (F-057). */
  fallBlend: number;
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
  /** Downward speed while unsupported; drives the fall pose (F-057). 0 when
   * grounded or rising. */
  fall: number;
  /** Seconds left of the post-landing squash (F-057). */
  land: number;
  /** 0..1 progress of the out-of-battery power-down slump (F-058). */
  powerDown: number;
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

/** Field-by-field pose copy; the pose shape's single home is this
 * module, so create/copy live beside the type. */
export function copyMinerPose(from: MinerPose, to: MinerPose): void {
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

/** Allocate a pose tree once; frame loops reuse it as the advance* out
 * parameter so posing a miner allocates nothing per frame. */
export function createMinerPose(): MinerPose {
  return {
    body: {
      posX: 0,
      posY: BODY_REST_Y,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    },
    legL: { rotX: 0, posY: BODY_REST_Y },
    legR: { rotX: 0, posY: BODY_REST_Y },
    arm: { rotZ: 0 },
  };
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
    fall: 0,
    land: 0,
    powerDown: 0,
    still: false,
  };
}

export function createMinerRigState(): MinerRigState {
  return {
    walkPhase: 0,
    bodyYaw: 0,
    legLRotX: 0,
    legRRotX: 0,
    fallBlend: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
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
 * Advance the rig one frame. Mutates `state` in place and writes the
 * frame's pose into the caller-owned `out` (both hot-path rules: this
 * runs inside useFrame, so it must not allocate). Returns `out`.
 */
export function advanceMinerRig(
  state: MinerRigState,
  inputs: MinerRigInputs,
  out: MinerPose = createMinerPose(),
): MinerPose {
  const { t, delta } = inputs;

  // Body language: face the walk direction, idle bob, dig lunge.
  const targetYaw = inputs.facing * 0.85;
  state.bodyYaw += (targetYaw - state.bodyYaw) * Math.min(1, delta * 8);
  const lk = inputs.lunge.t > 0 ? inputs.lunge.t / DIG_LUNGE_SECONDS : 0;
  const bob = inputs.still
    ? 0
    : Math.sin(t * IDLE_BOB_RATE) * IDLE_BOB_AMPLITUDE;
  // Ease into the fall pose so a drop reads as a fall, not a glide (F-057).
  const fallTarget = clamp(inputs.fall / FALL_POSE_SPEED, 0, 1);
  state.fallBlend += (fallTarget - state.fallBlend) * Math.min(1, delta * 10);
  const fallBlend = state.fallBlend;
  const body = out.body;
  body.posX = inputs.lunge.x * lk;
  body.posY = BODY_REST_Y + bob + inputs.lunge.y * lk;
  body.rotY = state.bodyYaw;
  // Lean into the glide while moving between cells.
  body.rotZ = clamp(-inputs.leanVx * 0.3, -0.16, 0.16);
  body.scaleX = 1;
  body.scaleY = 1;
  body.scaleZ = 1;
  if (inputs.crushed) {
    // A designed crumple, not a pancake: the old 0.58 Y-squash drove the
    // hat and visor through the torso. Compress a little, drop and tip
    // the body, and let the splayed legs and hanging arm sell the hit.
    body.scaleX = 1.06;
    body.scaleY = 0.82;
    body.scaleZ = 1.04;
    body.posY -= 0.16;
    body.rotZ += 0.34;
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
  out.legL.rotX = state.legLRotX;
  out.legL.posY = BODY_REST_Y + Math.max(0, Math.sin(ph)) * lift;
  out.legR.rotX = state.legRRotX;
  out.legR.posY = BODY_REST_Y + Math.max(0, Math.sin(ph + Math.PI)) * lift;

  if (inputs.crushed) {
    // Knees buckle outward and the pick arm drops limp.
    out.legL.rotX = 0.85;
    out.legR.rotX = -0.55;
    out.arm.rotZ = 1.15;
    return out;
  }

  out.arm.rotZ = minerArmRotZ(inputs.swing, inputs.bounce);

  // Fall pose (F-057): legs tuck, the free arm windmills up, and the body
  // stretches with a slow sway. Blended in by fallBlend so it eases on and
  // off around the drop.
  if (fallBlend > 0.001) {
    out.legL.rotX = lerp(out.legL.rotX, 0.9, fallBlend);
    out.legR.rotX = lerp(out.legR.rotX, 0.62, fallBlend);
    out.arm.rotZ = lerp(out.arm.rotZ, -1.4, fallBlend);
    body.scaleY = lerp(body.scaleY, 1.08, fallBlend);
    body.scaleX = lerp(body.scaleX, 0.96, fallBlend);
    body.scaleZ = lerp(body.scaleZ, 0.96, fallBlend);
    body.rotZ += Math.sin(t * 12) * 0.06 * fallBlend;
  }

  // Landing squash (F-057): a brief springy compress as the fall lands.
  if (inputs.land > 0) {
    const l = clamp(inputs.land / LAND_SQUASH_SECONDS, 0, 1);
    body.scaleY *= 1 - 0.2 * l;
    body.scaleX *= 1 + 0.14 * l;
    body.scaleZ *= 1 + 0.14 * l;
    body.posY -= 0.05 * l;
    out.legL.rotX = lerp(out.legL.rotX, 0.4, l);
    out.legR.rotX = lerp(out.legR.rotX, -0.3, l);
  }

  // Out-of-battery power-down (F-058): the miner loses power and slumps.
  // A 0..1 progress sinks and tips the body, buckles the knees, and lets
  // the pick arm hang.
  if (inputs.powerDown > 0) {
    const p = clamp(inputs.powerDown, 0, 1);
    body.posY -= 0.16 * p;
    body.rotZ += 0.5 * p;
    body.scaleY = lerp(body.scaleY, 0.9, p);
    out.legL.rotX = lerp(out.legL.rotX, 0.55, p);
    out.legR.rotX = lerp(out.legR.rotX, -0.4, p);
    out.arm.rotZ = lerp(out.arm.rotZ, 1.2, p);
  }

  return out;
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
