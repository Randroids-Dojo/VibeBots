import { describe, expect, it } from "vitest";
import {
  advanceMinerRig,
  BODY_REST_Y,
  BOUNCE_SECONDS,
  createMinerRigState,
  DIG_LUNGE_SECONDS,
  FALL_POSE_SPEED,
  LAND_SQUASH_SECONDS,
  MINER_CLIPS,
  type MinerRigInputs,
  minerArmRotZ,
  minerClipId,
  minerClipInputs,
  minerRigRestInputs,
  PICK_SWING_SECONDS,
} from "./miner-rig";

const rest = (over: Partial<MinerRigInputs> = {}) => ({
  ...minerRigRestInputs(),
  ...over,
});

describe("miner rig kinematics", () => {
  it("holds a neutral pose at rest", () => {
    const state = createMinerRigState();
    const pose = advanceMinerRig(state, rest({ t: 0, delta: 1 / 60 }));
    expect(pose.body.posX).toBe(0);
    expect(pose.body.rotY).toBe(0);
    expect(pose.body.scaleY).toBe(1);
    expect(pose.legL.rotX).toBeCloseTo(0, 10);
    expect(pose.legR.rotX).toBeCloseTo(0, 10);
    expect(pose.arm.rotZ).toBeCloseTo(0, 10);
    expect(pose.legL.posY).toBe(BODY_REST_Y);
  });

  it("bobs the body over time and freezes when still", () => {
    const state = createMinerRigState();
    const a = advanceMinerRig(state, rest({ t: 0.2, delta: 1 / 60 }));
    const b = advanceMinerRig(state, rest({ t: 0.5, delta: 1 / 60 }));
    expect(a.body.posY).not.toBe(b.body.posY);
    const stillA = advanceMinerRig(
      state,
      rest({ t: 0.2, delta: 1 / 60, still: true }),
    );
    const stillB = advanceMinerRig(
      state,
      rest({ t: 0.5, delta: 1 / 60, still: true }),
    );
    expect(stillA.body.posY).toBe(BODY_REST_Y);
    expect(stillA.body.posY).toBe(stillB.body.posY);
  });

  it("eases the body yaw toward the facing direction", () => {
    const state = createMinerRigState();
    const first = advanceMinerRig(state, rest({ facing: 1, delta: 1 / 60 }));
    expect(first.body.rotY).toBeGreaterThan(0);
    expect(first.body.rotY).toBeLessThan(0.85);
    for (let i = 0; i < 240; i++) {
      advanceMinerRig(state, rest({ facing: 1, delta: 1 / 60 }));
    }
    const settled = advanceMinerRig(state, rest({ facing: 1, delta: 1 / 60 }));
    expect(settled.body.rotY).toBeCloseTo(0.85, 3);
  });

  it("keeps the stride foot-locked and antiphase while walking", () => {
    const state = createMinerRigState();
    // Walk far enough that the eased hip rotations catch the stride.
    let pose = advanceMinerRig(state, rest({ delta: 1 / 60 }));
    for (let i = 0; i < 30; i++) {
      pose = advanceMinerRig(
        state,
        rest({ stepDistance: 0.03, delta: 1 / 60 }),
      );
    }
    expect(state.walkPhase).toBeCloseTo(31 * 0.03 * 10 - 0.3, 5);
    expect(Math.abs(pose.legL.rotX)).toBeGreaterThan(0.01);
    // Antiphase: the hips never settle toward the same swing target.
    expect(Math.sign(pose.legL.rotX)).not.toBe(Math.sign(pose.legR.rotX));
    // Teleport-scale jumps must not spin the stride.
    const phaseBefore = state.walkPhase;
    advanceMinerRig(state, rest({ stepDistance: 4, delta: 1 / 60 }));
    expect(state.walkPhase).toBe(phaseBefore);
  });

  it("eases the legs back to neutral when the walk stops", () => {
    const state = createMinerRigState();
    for (let i = 0; i < 30; i++) {
      advanceMinerRig(state, rest({ stepDistance: 0.03, delta: 1 / 60 }));
    }
    for (let i = 0; i < 240; i++) {
      advanceMinerRig(state, rest({ delta: 1 / 60 }));
    }
    const settled = advanceMinerRig(state, rest({ delta: 1 / 60 }));
    expect(Math.abs(settled.legL.rotX)).toBeLessThan(0.001);
    expect(settled.legL.posY).toBe(BODY_REST_Y);
  });

  it("swings the pick with a squared falloff", () => {
    expect(minerArmRotZ(PICK_SWING_SECONDS, 0)).toBeCloseTo(-2.1, 5);
    expect(minerArmRotZ(PICK_SWING_SECONDS / 2, 0)).toBeCloseTo(-2.1 / 4, 5);
    expect(minerArmRotZ(0, 0)).toBeCloseTo(0, 10);
  });

  it("plays the rebuff slam then a damped rebound", () => {
    // Slam phase: raised at the start, at the rock by 32% elapsed.
    expect(minerArmRotZ(0, BOUNCE_SECONDS)).toBeCloseTo(-2, 5);
    const impact = minerArmRotZ(0, BOUNCE_SECONDS * (1 - 0.32));
    expect(impact).toBeCloseTo(0, 5);
    // Rebound kicks the arm past rest and settles back down.
    const mid = minerArmRotZ(0, BOUNCE_SECONDS * (1 - 0.66));
    expect(mid).toBeGreaterThan(0.2);
    const settle = minerArmRotZ(0, BOUNCE_SECONDS * 0.01);
    expect(Math.abs(settle)).toBeLessThan(0.2);
  });

  it("lunges the body toward the struck cell and decays with the timer", () => {
    const state = createMinerRigState();
    const fresh = advanceMinerRig(
      state,
      rest({
        still: true,
        lunge: { x: 0.16, y: -0.13, t: DIG_LUNGE_SECONDS },
        delta: 1 / 60,
      }),
    );
    expect(fresh.body.posX).toBeCloseTo(0.16, 5);
    expect(fresh.body.posY).toBeCloseTo(BODY_REST_Y - 0.13, 5);
    const half = advanceMinerRig(
      state,
      rest({
        still: true,
        lunge: { x: 0.16, y: -0.13, t: DIG_LUNGE_SECONDS / 2 },
        delta: 1 / 60,
      }),
    );
    expect(half.body.posX).toBeCloseTo(0.08, 5);
  });

  it("crumples the body on a crush frame", () => {
    const state = createMinerRigState();
    const pose = advanceMinerRig(
      state,
      rest({ crushed: true, still: true, delta: 1 / 60 }),
    );
    // Compressed but never pancaked: a hard squash drives the hat and
    // visor through the torso geometry.
    expect(pose.body.scaleY).toBeLessThan(0.9);
    expect(pose.body.scaleY).toBeGreaterThan(0.7);
    expect(pose.body.scaleX).toBeGreaterThan(1);
    expect(pose.body.posY).toBeLessThan(BODY_REST_Y);
    expect(pose.body.rotZ).toBeGreaterThan(0.25);
    // The hit reads through the limbs: splayed knees, limp pick arm.
    expect(pose.legL.rotX).toBeGreaterThan(0.5);
    expect(pose.legR.rotX).toBeLessThan(-0.3);
    expect(pose.arm.rotZ).toBeGreaterThan(1);
  });

  it("eases into a fall pose while dropping and back out on landing (F-057)", () => {
    const state = createMinerRigState();
    let pose = advanceMinerRig(
      state,
      rest({ fall: FALL_POSE_SPEED * 2, still: true, delta: 1 / 60 }),
    );
    for (let i = 0; i < 40; i++) {
      pose = advanceMinerRig(
        state,
        rest({ fall: FALL_POSE_SPEED * 2, still: true, delta: 1 / 60 }),
      );
    }
    // Legs tuck, the free arm windmills up, and the body stretches.
    expect(state.fallBlend).toBeGreaterThan(0.9);
    expect(pose.legL.rotX).toBeGreaterThan(0.5);
    expect(pose.arm.rotZ).toBeLessThan(-1);
    expect(pose.body.scaleY).toBeGreaterThan(1);
    // Landing squash compresses vertically and spreads out.
    const landed = advanceMinerRig(
      state,
      rest({ land: LAND_SQUASH_SECONDS, still: true, delta: 1 / 60 }),
    );
    expect(landed.body.scaleY).toBeLessThan(1);
    expect(landed.body.scaleX).toBeGreaterThan(1);
    // Grounded again, the pose eases back to neutral.
    for (let i = 0; i < 60; i++) {
      pose = advanceMinerRig(state, rest({ still: true, delta: 1 / 60 }));
    }
    expect(state.fallBlend).toBeLessThan(0.05);
    expect(pose.body.scaleY).toBeCloseTo(1, 2);
  });

  it("slumps the body on the out-of-battery power-down (F-058)", () => {
    const state = createMinerRigState();
    const pose = advanceMinerRig(
      state,
      rest({ powerDown: 1, still: true, delta: 1 / 60 }),
    );
    // Sinks, tips over, compresses, and the pick arm hangs.
    expect(pose.body.posY).toBeLessThan(BODY_REST_Y);
    expect(pose.body.rotZ).toBeGreaterThan(0.25);
    expect(pose.body.scaleY).toBeLessThan(1);
    expect(pose.arm.rotZ).toBeGreaterThan(0.8);
    // A zero progress leaves the neutral stance untouched.
    const upright = advanceMinerRig(
      createMinerRigState(),
      rest({ powerDown: 0, still: true, delta: 1 / 60 }),
    );
    expect(upright.body.scaleY).toBe(1);
  });

  it("clamps the walk lean", () => {
    const state = createMinerRigState();
    const pose = advanceMinerRig(
      state,
      rest({ leanVx: 4, still: true, delta: 1 / 60 }),
    );
    expect(pose.body.rotZ).toBe(-0.16);
  });
});

describe("miner showcase clips", () => {
  it("resolves unknown clip ids to idle", () => {
    expect(minerClipId(undefined)).toBe("idle");
    expect(minerClipId("nope")).toBe("idle");
    expect(minerClipId("dig")).toBe("dig");
  });

  it("generates motion inputs per clip", () => {
    const walk = minerClipInputs("walk", 1, 1 / 60, false);
    expect(walk.stepDistance).toBeGreaterThan(0);
    expect(walk.facing).toBe(1);
    const dig = minerClipInputs("dig", 0.05, 1 / 60, false);
    expect(dig.swing).toBeGreaterThan(0);
    expect(dig.lunge.t).toBeGreaterThan(0);
    const rebuff = minerClipInputs("rebuff", 0.05, 1 / 60, false);
    expect(rebuff.bounce).toBeGreaterThan(0);
    const crush = minerClipInputs("crush", 0, 1 / 60, false);
    expect(crush.crushed).toBe(true);
    // Paused showcase renders a fully still frame regardless of clip.
    const still = minerClipInputs("walk", 1, 1 / 60, true);
    expect(still.stepDistance).toBe(0);
    expect(still.still).toBe(true);
  });

  it("loops every clip deterministically", () => {
    for (const clip of MINER_CLIPS) {
      const a = minerClipInputs(clip.id, 0.1, 1 / 60, false);
      const b = minerClipInputs(clip.id, 0.1, 1 / 60, false);
      expect(b).toEqual(a);
    }
  });
});
