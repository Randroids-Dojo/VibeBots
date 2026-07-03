import { describe, expect, it } from "vitest";
import {
  advanceCrushTumble,
  CRUSH_TUMBLE_SECONDS,
  CRUSH_TUMBLE_SETTLE_SECONDS,
  createCrushTumble,
  crushTumbleSettled,
} from "./miner-crush-tumble";
import { BODY_REST_Y } from "./miner-rig";

const DT = 1 / 60;

function runFrames(seed: number, frames: number) {
  const state = createCrushTumble(seed);
  const poses = [];
  for (let i = 0; i < frames; i++) poses.push(advanceCrushTumble(state, DT));
  return { state, poses };
}

describe("miner crush tumble", () => {
  it("is deterministic for a given seed", () => {
    const a = runFrames(0.37, 90);
    const b = runFrames(0.37, 90);
    expect(b.poses).toEqual(a.poses);
  });

  it("varies with the seed", () => {
    const a = runFrames(0.12, 30);
    const b = runFrames(0.82, 30);
    expect(b.poses).not.toEqual(a.poses);
  });

  it("launches, bounces, and keeps the wreck inside its cell", () => {
    const { state, poses } = runFrames(0.6, 120);
    const highest = Math.max(...poses.map((p) => p.body.posY));
    expect(highest).toBeGreaterThan(BODY_REST_Y + 0.1);
    expect(state.bounces).toBeGreaterThanOrEqual(1);
    for (const pose of poses) {
      expect(pose.body.posY).toBeGreaterThanOrEqual(-0.33);
      expect(Math.abs(pose.body.posX)).toBeLessThanOrEqual(0.34);
    }
  });

  it("actually moves frame to frame while live", () => {
    const { poses } = runFrames(0.4, 30);
    let moved = 0;
    for (let i = 1; i < poses.length; i++) {
      if (Math.abs(poses[i].body.posY - poses[i - 1].body.posY) > 0.0004)
        moved++;
    }
    expect(moved).toBeGreaterThan(20);
  });

  it("settles into the designed crumple pose", () => {
    const total = Math.ceil(
      ((CRUSH_TUMBLE_SECONDS + CRUSH_TUMBLE_SETTLE_SECONDS) / DT) * 1.2,
    );
    const { state, poses } = runFrames(0.9, total);
    expect(crushTumbleSettled(state)).toBe(true);
    const last = poses[poses.length - 1];
    expect(last.body).toMatchObject({
      posX: 0,
      posY: BODY_REST_Y - 0.16,
      rotZ: 0.34,
      scaleX: 1.06,
      scaleY: 0.82,
      scaleZ: 1.04,
    });
    expect(last.legL.rotX).toBe(0.85);
    expect(last.legR.rotX).toBe(-0.55);
    expect(last.arm.rotZ).toBe(1.15);
  });

  it("clamps runaway frame deltas so the wreck never tunnels", () => {
    const state = createCrushTumble(0.5);
    for (let i = 0; i < 40; i++) {
      const pose = advanceCrushTumble(state, 0.5);
      expect(pose.body.posY).toBeGreaterThanOrEqual(-0.33);
    }
  });
});
