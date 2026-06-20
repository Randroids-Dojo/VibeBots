import { describe, expect, it } from "vitest";
import { DEFAULT_GEAR } from "@/sim/mine";
import {
  actionRepeatMs,
  MAXED_ACTION_REPEAT_MS,
  MAXED_MINER_STEP_SECONDS,
  minerStepSeconds,
  START_ACTION_REPEAT_MS,
  START_MINER_STEP_SECONDS,
} from "./mine-pacing";

describe("mine pacing", () => {
  it("starts held actions and visual steps slower than the prior fast cadence", () => {
    expect(actionRepeatMs(DEFAULT_GEAR)).toBe(START_ACTION_REPEAT_MS);
    expect(actionRepeatMs(DEFAULT_GEAR)).toBeGreaterThan(270);
    expect(minerStepSeconds(DEFAULT_GEAR)).toBe(START_MINER_STEP_SECONDS);
    expect(minerStepSeconds(DEFAULT_GEAR)).toBeGreaterThan(0.26);
  });

  it("ramps down as core mining gear improves", () => {
    const maxed = {
      ...DEFAULT_GEAR,
      pickaxe: 10,
      battery: 10,
      cargo: 10,
      lantern: 8,
      fall: 8,
    };
    expect(actionRepeatMs(maxed)).toBe(MAXED_ACTION_REPEAT_MS);
    expect(minerStepSeconds(maxed)).toBe(MAXED_MINER_STEP_SECONDS);
  });

  it("keeps partial progression between the start and max values", () => {
    const mid = {
      ...DEFAULT_GEAR,
      pickaxe: 3,
      battery: 2,
    };
    expect(actionRepeatMs(mid)).toBeLessThan(START_ACTION_REPEAT_MS);
    expect(actionRepeatMs(mid)).toBeGreaterThan(MAXED_ACTION_REPEAT_MS);
    expect(minerStepSeconds(mid)).toBeLessThan(START_MINER_STEP_SECONDS);
    expect(minerStepSeconds(mid)).toBeGreaterThan(MAXED_MINER_STEP_SECONDS);
  });
});
