import { describe, expect, it } from "vitest";
import {
  applyBunkerRaidWear,
  BASE_PART_CATALOG,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  type BunkerRaidTerrainKind,
  basePartOwnedLimit,
  CLANKER_SELF_DESTRUCT_XP,
  canBuyBasePart,
  createBunker,
  FLOOR_SPIKES_DAMAGE,
  FLOOR_SPIKES_DURABILITY,
  moveBasePart,
  overallPlayerLevel,
  placeBasePart,
  playerLevelProgress,
  proposedBunkerFootprint,
  removeBasePart,
  resolveBunkerRaid,
  STARTER_BASE_PART_INVENTORY,
} from "./bunker";

const openTerrain = (): BunkerRaidTerrainKind => "empty";

describe("bunker vertical slice sim", () => {
  it("proposes a fixed underground footprint with the miner bottom-center", () => {
    const footprint = proposedBunkerFootprint(10, 8);
    expect(footprint).toEqual({
      col: 7,
      row: 4,
      width: BUNKER_CLAIM_WIDTH,
      height: BUNKER_CLAIM_HEIGHT,
    });
    expect(footprint.col + Math.floor(footprint.width / 2)).toBe(10);
    expect(footprint.row + footprint.height - 1).toBe(8);
  });

  it("starts new claims with enough parts for a 3x1 starter base", () => {
    expect(STARTER_BASE_PART_INVENTORY).toMatchObject({
      "wall-panel": 2,
      "floor-panel": 3,
      "roof-panel": 3,
      "door-panel": 1,
      "basic-turret": 0,
      "floor-spikes": 0,
    });
  });

  it("places and removes consumable wall parts", () => {
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
    expect(placed.inventory["wall-panel"]).toBe(1);
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
    expect(removed.inventory["wall-panel"]).toBe(2);
    expect(removed.bunker.parts).toHaveLength(0);
  });

  it("moves a placed part without changing inventory or durability", () => {
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
    const moved = moveBasePart(
      placed.bunker,
      bunker.footprint.col,
      bunker.footprint.row,
      bunker.footprint.col + 1,
      bunker.footprint.row,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(placed.inventory["wall-panel"]).toBe(1);
    expect(moved.bunker.parts).toEqual([
      {
        partId: "wall-panel",
        col: bunker.footprint.col + 1,
        row: bunker.footprint.row,
        durability: BASE_PART_CATALOG["wall-panel"].durability,
      },
    ]);
  });

  it("resolves a tier-one Clanker raid into damage, dead clankers, and XP pickups", () => {
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
    expect(raid.durationSeconds).toBeLessThan(180);
    expect(raid.clankers).toHaveLength(6);
    expect(raid.allClankersDead).toBe(true);
    expect(
      raid.clankers.map((clanker) => `${clanker.col},${clanker.row}`),
    ).toEqual(
      [-2, 10, -3, 11, -4, 12].map((col) => `${col},${base.footprint.row - 1}`),
    );
    expect(raid.partDamage.length).toBeGreaterThan(0);
    expect(raid.incomingDamage).toBeGreaterThan(0);
    expect(
      raid.clankers.every((clanker) => clanker.status === "self-destructed"),
    ).toBe(true);
    expect(raid.xpPickups).toHaveLength(6);
    expect(
      raid.xpPickups.every(
        (pickup) => pickup.defenseXp === CLANKER_SELF_DESTRUCT_XP,
      ),
    ).toBe(true);
    expect(raid.survived).toBe(true);
    expect(raid.reward).toEqual({ vibes: 30, defenseXp: 150 });
    expect(playerLevelProgress(raid.reward.defenseXp)).toMatchObject({
      level: 2,
      progressXp: 50,
      beaconLimit: 3,
    });
  });

  it("plans clanker paths through open cells toward the player cell", () => {
    const base = createBunker(proposedBunkerFootprint(10, 8));
    const firstSpawn = {
      col: base.footprint.col - 3,
      row: base.footprint.row - 1,
    };
    const open = new Set<string>();
    for (let col = firstSpawn.col; col <= base.footprint.col; col++) {
      open.add(`${col},${firstSpawn.row}`);
    }
    for (let row = base.footprint.row; row <= base.core.row; row++) {
      open.add(`${base.footprint.col},${row}`);
    }
    for (let col = base.footprint.col; col <= base.core.col; col++) {
      open.add(`${col},${base.core.row}`);
    }

    const raid = resolveBunkerRaid(base, 1, "open-raid", {
      terrainAt: (col, row) => (open.has(`${col},${row}`) ? "empty" : "dirt"),
    });

    expect(raid.clankers[0].path).toEqual([
      { col: firstSpawn.col, row: firstSpawn.row },
      { col: firstSpawn.col + 1, row: firstSpawn.row },
      { col: firstSpawn.col + 2, row: firstSpawn.row },
      { col: firstSpawn.col + 3, row: firstSpawn.row },
      { col: base.footprint.col, row: base.footprint.row },
      { col: base.footprint.col + 1, row: base.footprint.row },
      { col: base.footprint.col + 2, row: base.footprint.row },
      { col: base.core.col, row: base.footprint.row },
      { col: base.core.col, row: base.footprint.row + 1 },
      { col: base.core.col, row: base.core.row },
    ]);
  });

  it("kills the miner and clears XP when an open route reaches the player cell", () => {
    const base = createBunker(proposedBunkerFootprint(10, 8));
    const raid = resolveBunkerRaid(base, 1, "core-raid", {
      terrainAt: openTerrain,
    });

    expect(
      raid.clankers.some((clanker) => clanker.targetCol === base.core.col),
    ).toBe(true);
    expect(
      raid.clankers.some((clanker) => {
        return clanker.status === "self-destructed";
      }),
    ).toBe(true);
    expect(raid.coreDamage).toBeGreaterThan(0);
    expect(raid.xpPickups).toHaveLength(0);
    expect(raid.minerKilled).toBe(true);
    expect(raid.survived).toBe(false);
    expect(raid.reward).toEqual({ vibes: 0, defenseXp: 0 });
  });

  it("never spawns clankers inside occupied generated cells", () => {
    const base = createBunker(proposedBunkerFootprint(10, 8));
    const blocked = new Map<string, BunkerRaidTerrainKind>([
      [`${base.footprint.col - 3},${base.footprint.row - 1}`, "dirt"],
      [`${base.footprint.col - 4},${base.footprint.row - 1}`, "ore"],
      [`${base.footprint.col - 5},${base.footprint.row - 1}`, "part-cache"],
    ]);

    const raid = resolveBunkerRaid(base, 1, "blocked-spawn-raid", {
      terrainAt: (col, row) => {
        if (row === 0) return "empty";
        return blocked.get(`${col},${row}`) ?? "dirt";
      },
    });

    expect(raid.clankers[0].row).toBe(0);
    expect(raid.clankers[0].path?.[0]).toEqual({
      col: base.footprint.col - 3,
      row: 0,
    });
  });

  it("chews a short ore cell route when it beats a long open detour", () => {
    const base = createBunker(proposedBunkerFootprint(10, 8));
    const placed = placeBasePart(
      base,
      { ...STARTER_BASE_PART_INVENTORY, "wall-panel": 1 },
      "wall-panel",
      base.footprint.col,
      base.footprint.row,
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const oreKey = `${base.footprint.col - 1},${base.footprint.row - 1}`;
    const openKeys = new Set<string>([
      `${base.footprint.col - 3},${base.footprint.row - 1}`,
      `${base.footprint.col - 2},${base.footprint.row - 1}`,
      `${base.footprint.col},${base.footprint.row - 1}`,
      oreKey,
    ]);

    const raid = resolveBunkerRaid(placed.bunker, 1, "ore-raid", {
      terrainAt: (col, row) => {
        const key = `${col},${row}`;
        if (key === oreKey) return "ore";
        return openKeys.has(key) ? "empty" : "rock";
      },
    });

    expect(raid.clankers[0].targetCol).toBe(base.footprint.col);
    expect(raid.clankers[0].targetRow).toBe(base.footprint.row);
    expect(raid.clankers[0].path).toContainEqual({
      col: base.footprint.col - 1,
      row: base.footprint.row - 1,
    });
  });

  it("spreads clanker targets instead of stacking every route", () => {
    const base = createBunker(proposedBunkerFootprint(10, 8));
    const raid = resolveBunkerRaid(base, 1, "spread-raid", {
      terrainAt: openTerrain,
    });

    const targetKeys = new Set(
      raid.clankers.map(
        (clanker) => `${clanker.targetCol},${clanker.targetRow}`,
      ),
    );
    expect(targetKeys.size).toBeGreaterThan(3);
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
    expect(
      raid.clankers.filter((clanker) => clanker.status === "turret-destroyed"),
    ).toHaveLength(3);
    expect(
      raid.clankers.some((clanker) => {
        return clanker.status === "self-destructed";
      }),
    ).toBe(true);
    expect(raid.xpPickups.length).toBeGreaterThan(0);
    expect(raid.survived).toBe(true);

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
    expect(raid.coreDamage).toBeGreaterThan(0);

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

  it("uses only collected defense XP for overall player level", () => {
    expect(overallPlayerLevel(10_000, 0)).toBe(1);
    expect(overallPlayerLevel(90, 0)).toBe(1);
    expect(overallPlayerLevel(90, 99)).toBe(1);
    expect(overallPlayerLevel(90, 100)).toBe(2);
    expect(overallPlayerLevel(120, 180)).toBe(2);
  });

  it("raises the beacon limit at level two and keeps later levels open", () => {
    expect(playerLevelProgress(0)).toMatchObject({
      level: 1,
      cap: 100,
      progressXp: 0,
      neededXp: 100,
      beaconLimit: 2,
    });
    expect(playerLevelProgress(100)).toMatchObject({
      level: 2,
      cap: 100,
      progressXp: 0,
      neededXp: 100,
      nextLevelXp: 200,
      beaconLimit: 3,
    });
    expect(playerLevelProgress(10_000)).toMatchObject({
      level: 100,
      cap: 100,
      neededXp: 0,
      nextLevelXp: null,
      beaconLimit: 3,
    });
  });
});
