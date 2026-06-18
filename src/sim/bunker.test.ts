import { describe, expect, it } from "vitest";
import {
  applyBunkerRaidWear,
  BASE_PART_CATALOG,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  basePartOwnedLimit,
  canBuyBasePart,
  createBunker,
  FLOOR_SPIKES_DAMAGE,
  FLOOR_SPIKES_DURABILITY,
  overallPlayerLevel,
  placeBasePart,
  playerLevelProgress,
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

  it("lets Basic Turrets autofire with limited ammo during raids", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const placed = placeBasePart(
      base,
      { ...STARTER_BASE_PART_INVENTORY, "basic-turret": 1 },
      "basic-turret",
      base.footprint.col,
      base.footprint.row,
    );

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const raid = resolveBunkerRaid(placed.bunker, 1, "turret-raid");

    expect(raid.turretShots).toBe(3);
    expect(raid.turretDamage).toBe(54);
    expect(raid.incomingDamage).toBe(102);

    const worn = applyBunkerRaidWear(placed.bunker, raid);
    expect(worn.parts).toEqual([
      {
        partId: "basic-turret",
        col: base.footprint.col,
        row: base.footprint.row,
        durability: 2,
      },
    ]);
  });

  it("damages Clankers with Floor Spikes and wears them down", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const placed = placeBasePart(
      base,
      { ...STARTER_BASE_PART_INVENTORY, "floor-spikes": 1 },
      "floor-spikes",
      base.footprint.col,
      base.footprint.row,
    );

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const raid = resolveBunkerRaid(placed.bunker, 1, "spike-raid");

    expect(raid.spikeTriggers).toBe(1);
    expect(raid.spikeDamage).toBe(FLOOR_SPIKES_DAMAGE);
    expect(raid.incomingDamage).toBe(140);

    const worn = applyBunkerRaidWear(placed.bunker, raid);
    expect(worn.parts).toEqual([
      {
        partId: "floor-spikes",
        col: base.footprint.col,
        row: base.footprint.row,
        durability: FLOOR_SPIKES_DURABILITY - 1,
      },
    ]);
  });

  it("removes Floor Spikes when their durability reaches zero", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const bunker = {
      ...base,
      parts: [
        {
          partId: "floor-spikes" as const,
          col: base.footprint.col,
          row: base.footprint.row,
          durability: 1,
        },
      ],
    };

    const worn = applyBunkerRaidWear(bunker, {
      clankers: [],
      spikeTriggers: 1,
      turretShots: 0,
    });

    expect(worn.parts).toEqual([]);
  });

  it("removes Basic Turrets when enough Clankers survive the autofire", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const bunker = {
      ...base,
      parts: [
        {
          partId: "basic-turret" as const,
          col: base.footprint.col,
          row: base.footprint.row,
          durability: 2,
        },
      ],
    };

    const worn = applyBunkerRaidWear(bunker, {
      clankers: [
        { id: "c1", col: 1, row: 1, targetCol: 2, targetRow: 1 },
        { id: "c2", col: 1, row: 2, targetCol: 2, targetRow: 2 },
        { id: "c3", col: 1, row: 3, targetCol: 2, targetRow: 3 },
      ],
      spikeTriggers: 0,
      turretShots: 1,
    });

    expect(worn.parts).toEqual([]);
  });

  it("gates turret and spike purchases by level and owned limits", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));

    expect(BASE_PART_CATALOG["basic-turret"].price).toBe(
      BASE_PART_CATALOG["floor-spikes"].price * 10,
    );
    expect(BASE_PART_CATALOG["basic-turret"].durability).toBe(5);
    expect(basePartOwnedLimit("floor-spikes", 1)).toBe(4);
    expect(basePartOwnedLimit("floor-spikes", 2)).toBe(6);
    expect(basePartOwnedLimit("basic-turret", 1)).toBe(0);
    expect(basePartOwnedLimit("basic-turret", 2)).toBe(1);

    expect(
      canBuyBasePart("basic-turret", 1, null, STARTER_BASE_PART_INVENTORY, 1),
    ).toEqual({ ok: false, reason: "level", minLevel: 2 });
    expect(
      canBuyBasePart(
        "floor-spikes",
        1,
        base,
        { ...STARTER_BASE_PART_INVENTORY, "floor-spikes": 4 },
        1,
      ),
    ).toEqual({ ok: false, reason: "limit", limit: 4 });
    expect(
      canBuyBasePart(
        "floor-spikes",
        2,
        base,
        { ...STARTER_BASE_PART_INVENTORY, "floor-spikes": 5 },
        1,
      ),
    ).toEqual({ ok: true });
  });

  it("combines track XP and defense XP into overall level", () => {
    expect(overallPlayerLevel(90, 0)).toBe(1);
    expect(overallPlayerLevel(90, 99)).toBe(1);
    expect(overallPlayerLevel(90, 100)).toBe(2);
    expect(overallPlayerLevel(120, 180)).toBe(2);
  });

  it("caps player level at two and raises the beacon limit at level two", () => {
    expect(playerLevelProgress(0)).toMatchObject({
      level: 1,
      cap: 2,
      progressXp: 0,
      neededXp: 100,
      beaconLimit: 2,
    });
    expect(playerLevelProgress(100)).toMatchObject({
      level: 2,
      cap: 2,
      progressXp: 100,
      neededXp: 0,
      nextLevelXp: null,
      beaconLimit: 3,
    });
  });
});
