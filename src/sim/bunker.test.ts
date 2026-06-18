import { describe, expect, it } from "vitest";
import {
  BASE_PART_CATALOG,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  createBunker,
  overallPlayerLevel,
  placeBasePart,
  proposedBunkerFootprint,
  removeBasePart,
  resolveBunkerRaid,
  STARTER_BASE_PART_INVENTORY,
} from "./bunker";

describe("bunker vertical slice sim", () => {
  it("proposes a fixed underground footprint around the miner", () => {
    expect(proposedBunkerFootprint(10, 8)).toEqual({
      col: 7,
      row: 6,
      width: BUNKER_CLAIM_WIDTH,
      height: BUNKER_CLAIM_HEIGHT,
    });
  });

  it("places and removes consumable wall panels", () => {
    const bunker = createBunker(proposedBunkerFootprint(10, 8));
    const placed = placeBasePart(
      bunker,
      STARTER_BASE_PART_INVENTORY,
      "wall-panel",
      bunker.footprint.col,
      bunker.footprint.row,
    );

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.inventory["wall-panel"]).toBe(3);
    expect(placed.bunker.parts).toEqual([
      {
        partId: "wall-panel",
        col: bunker.footprint.col,
        row: bunker.footprint.row,
        durability: BASE_PART_CATALOG["wall-panel"].durability,
      },
    ]);

    const removed = removeBasePart(
      placed.bunker,
      placed.inventory,
      bunker.footprint.col,
      bunker.footprint.row,
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.inventory["wall-panel"]).toBe(4);
    expect(removed.bunker.parts).toHaveLength(0);
  });

  it("resolves a tier-one Clanker raid into deterministic rewards", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    let bunker = base;
    let inventory = { ...STARTER_BASE_PART_INVENTORY, "wall-panel": 8 };
    for (let i = 0; i < 8; i++) {
      const placed = placeBasePart(
        bunker,
        inventory,
        "wall-panel",
        base.footprint.col + (i % base.footprint.width),
        base.footprint.row + Math.floor(i / base.footprint.width),
      );
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;
      bunker = placed.bunker;
      inventory = placed.inventory;
    }

    const raid = resolveBunkerRaid(bunker, 1, "test-raid");
    expect(raid.durationSeconds).toBe(180);
    expect(raid.clankers).toHaveLength(6);
    expect(raid.survived).toBe(true);
    expect(raid.reward).toEqual({ vibes: 30, defenseXp: 60 });
  });

  it("combines track XP and defense XP into overall level", () => {
    expect(overallPlayerLevel(90, 0)).toBe(1);
    expect(overallPlayerLevel(90, 10)).toBe(2);
    expect(overallPlayerLevel(120, 180)).toBe(4);
  });
});
