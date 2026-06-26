import { describe, expect, it } from "vitest";
import {
  canDigRock,
  hitsFor,
  oreSwingCostFor,
  rockTierAt,
  swingCostFor,
} from "./digging";
import { DEFAULT_GEAR } from "./gear";

describe("mine digging helpers", () => {
  it("scales hit counts and swing costs by pickaxe level", () => {
    expect(hitsFor("dirt", DEFAULT_GEAR)).toBe(4);
    expect(hitsFor("dirt", { ...DEFAULT_GEAR, pickaxe: 2 })).toBe(3);
    expect(hitsFor("dirt", { ...DEFAULT_GEAR, pickaxe: 5 })).toBe(1);
    expect(hitsFor("empty", DEFAULT_GEAR)).toBe(1);

    expect(swingCostFor("dirt", DEFAULT_GEAR)).toBeCloseTo(0.25, 5);
    expect(swingCostFor("dirt", { ...DEFAULT_GEAR, pickaxe: 2 })).toBeCloseTo(
      0.35,
      5,
    );
    expect(oreSwingCostFor("diamond", DEFAULT_GEAR)).toBeCloseTo(0.6, 5);
  });

  it("maps rock tiers at each authored depth cutover", () => {
    expect(rockTierAt(23)).toBe(1);
    expect(rockTierAt(24)).toBe(2);
    expect(rockTierAt(47)).toBe(2);
    expect(rockTierAt(48)).toBe(3);
    expect(rockTierAt(89)).toBe(3);
    expect(rockTierAt(90)).toBe(4);
    expect(rockTierAt(139)).toBe(4);
    expect(rockTierAt(140)).toBe(5);
    expect(rockTierAt(219)).toBe(5);
    expect(rockTierAt(220)).toBe(6);
    expect(rockTierAt(339)).toBe(6);
    expect(rockTierAt(340)).toBe(7);
    expect(rockTierAt(499)).toBe(7);
    expect(rockTierAt(500)).toBe(8);
    expect(rockTierAt(719)).toBe(8);
    expect(rockTierAt(720)).toBe(9);
  });

  it("gates rock digging at the level-1 and level-2 boundary", () => {
    expect(canDigRock(DEFAULT_GEAR, 1)).toBe(false);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 2 }, 1)).toBe(true);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 2 }, 2)).toBe(false);
  });
});
