import { describe, expect, it } from "vitest";
import {
  canDigRock,
  digKindFor,
  hitsFor,
  hitsForCell,
  oreSwingCostFor,
  rockTierAt,
  rockTierForDig,
  swingCostFor,
} from "./digging";
import { DEFAULT_GEAR } from "./gear";

describe("mine digging helpers", () => {
  it("digs every stone body as rock", () => {
    // The renderer sizes crack states from the same count the dig path
    // spends, so a boulder must not fall through to the unknown-kind 1.
    expect(digKindFor({ kind: "boulder" })).toBe("rock");
    expect(hitsForCell({ kind: "boulder" }, DEFAULT_GEAR)).toBe(5);
    expect(
      hitsForCell({ kind: "boulder" }, { ...DEFAULT_GEAR, pickaxe: 2 }),
    ).toBe(4);
    expect(hitsForCell({ kind: "rock" }, DEFAULT_GEAR)).toBe(5);

    // Falling or fallen stone keeps the two-hit floor under any pickaxe.
    expect(
      hitsForCell(
        { kind: "rock", fallen: true },
        { ...DEFAULT_GEAR, pickaxe: 9 },
      ),
    ).toBe(2);
    expect(
      hitsForCell(
        { kind: "boulder", fallIn: 1 },
        { ...DEFAULT_GEAR, pickaxe: 9 },
      ),
    ).toBe(2);
    expect(hitsForCell({ kind: "dirt" }, { ...DEFAULT_GEAR, pickaxe: 9 })).toBe(
      1,
    );
  });

  it("gates fallen stone by where it rests, standing stone by its own tier", () => {
    expect(rockTierForDig({ kind: "boulder" }, 30)).toBe(2);
    expect(rockTierForDig({ kind: "rock", rockTier: 1 }, 30)).toBe(1);
    expect(
      rockTierForDig({ kind: "rock", rockTier: 1, fallen: true }, 30),
    ).toBe(2);
  });

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
