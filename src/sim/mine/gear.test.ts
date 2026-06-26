import { describe, expect, it } from "vitest";
import {
  blastRadius,
  cargoCapacity,
  DEFAULT_GEAR,
  dynamiteTier,
  gearUpgradeRequirements,
  lightRadius,
  maxEnergy,
  maxGearLevel,
  normalizeGear,
  recallRopeRange,
  safeFallRows,
  warpRange,
} from "./gear";

describe("mine gear module", () => {
  it("normalizes legacy snapshots and clamps derived levels", () => {
    const gear = normalizeGear({
      ...DEFAULT_GEAR,
      battery: undefined,
      lamp: 3,
      blast: 9,
    });

    expect(gear.battery).toBe(3);
    expect(gear.blast).toBe(4);
    expect(maxEnergy(gear)).toBe(130);
    expect(blastRadius(gear)).toBe(4);
    expect(dynamiteTier({ blast: 0 })).toBe(1);
  });

  it("keeps progression tracks and derived stats in one catalog", () => {
    expect(maxGearLevel("pickaxe")).toBe(10);
    expect(gearUpgradeRequirements("pickaxe", 9)).toEqual({
      playerLevel: 100,
      maxDepth: 820,
    });
    expect(cargoCapacity({ ...DEFAULT_GEAR, cargo: 10 })).toBe(50);
    expect(lightRadius({ ...DEFAULT_GEAR, lantern: 8 })).toBe(17);
    expect(safeFallRows({ ...DEFAULT_GEAR, fall: 8 })).toBe(39);
    expect(warpRange({ ...DEFAULT_GEAR, warpcoil: 7 })).toBe(999);
    expect(recallRopeRange({ ...DEFAULT_GEAR, recall: 6 })).toBe(1000);
  });
});
