import { describe, expect, it } from "vitest";
import { mineGearSchema } from "./mine-trip-schema";

const gear = {
  pickaxe: 1,
  battery: 1,
  cargo: 1,
  lantern: 1,
  elevator: 0,
  warpcoil: 1,
};

describe("mine trip gear schema", () => {
  it("accepts an arbitrary integer elevator column", () => {
    expect(
      mineGearSchema.safeParse({ ...gear, elevatorColumn: -321 }).success,
    ).toBe(true);
    expect(
      mineGearSchema.safeParse({ ...gear, elevatorColumn: 654 }).success,
    ).toBe(true);
  });

  it("accepts unplaced and legacy snapshots", () => {
    expect(
      mineGearSchema.safeParse({ ...gear, elevatorColumn: null }).success,
    ).toBe(true);
    expect(mineGearSchema.safeParse(gear).success).toBe(true);
  });

  it("rejects fractional and out-of-range columns", () => {
    expect(
      mineGearSchema.safeParse({ ...gear, elevatorColumn: 1.5 }).success,
    ).toBe(false);
    expect(
      mineGearSchema.safeParse({ ...gear, elevatorColumn: 100_001 }).success,
    ).toBe(false);
    expect(
      mineGearSchema.safeParse({ ...gear, elevatorColumn: -100_001 }).success,
    ).toBe(false);
  });
});
