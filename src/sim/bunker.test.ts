import { describe, expect, it } from "vitest";
import {
  applyBunkerRaidWear,
  applyBunkerRepairs,
  BASE_PART_CATALOG,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  BUNKER_CORE_MAX_DURABILITY,
  BUNKER_RAID_TIER_CAP,
  BUNKER_SKIN_CATALOG,
  type BunkerRaidTerrainKind,
  basePartOwnedLimit,
  bunkerCells,
  bunkerRepairPlan,
  CLANKER_BREACHER_XP,
  CLANKER_SELF_DESTRUCT_XP,
  CLANKER_TANK_XP,
  canBuyBasePart,
  clankerKindFor,
  clankerXpFor,
  createBunker,
  DEFAULT_BUNKER_SKIN,
  FLOOR_SPIKES_DAMAGE,
  FLOOR_SPIKES_DURABILITY,
  isBunkerPerimeterCell,
  isBunkerSkinId,
  maxBunkerRaidTier,
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

function fullyEnclosedBunker(minerCol: number, minerRow: number) {
  const bunker = createBunker(proposedBunkerFootprint(minerCol, minerRow));
  return {
    ...bunker,
    parts: bunkerCells(bunker.footprint)
      .filter((cell) =>
        isBunkerPerimeterCell(bunker.footprint, cell.col, cell.row),
      )
      .map((cell) => ({
        partId: "wall-panel" as const,
        col: cell.col,
        row: cell.row,
        durability: BASE_PART_CATALOG["wall-panel"].durability,
      })),
  };
}

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

  it("starts new claims with enough parts to fully enclose the player cell", () => {
    expect(STARTER_BASE_PART_INVENTORY).toMatchObject({
      "wall-panel": 6,
      "floor-panel": 4,
      "roof-panel": 4,
      "door-panel": 1,
      "basic-turret": 0,
      "floor-spikes": 0,
    });
  });

  it("the starter kit seals the player cell and survives an open-field raid", () => {
    let base = createBunker(proposedBunkerFootprint(10, 8));
    let inventory = STARTER_BASE_PART_INVENTORY;
    const core = base.core;
    // The sealed 3x3 starter room built from the granted kit alone:
    // floors underneath, roofs overhead, a wall and the door beside.
    const room = [
      ["floor-panel", core.col - 1, core.row + 1],
      ["floor-panel", core.col, core.row + 1],
      ["floor-panel", core.col + 1, core.row + 1],
      ["roof-panel", core.col - 1, core.row - 1],
      ["roof-panel", core.col, core.row - 1],
      ["roof-panel", core.col + 1, core.row - 1],
      ["wall-panel", core.col - 1, core.row],
      ["door-panel", core.col + 1, core.row],
    ] as const;
    for (const [partId, col, row] of room) {
      const placed = placeBasePart(base, inventory, partId, col, row);
      expect(placed.ok, `${partId} at ${col},${row}`).toBe(true);
      if (!placed.ok) return;
      base = placed.bunker;
      inventory = placed.inventory;
    }
    expect(inventory["wall-panel"]).toBeGreaterThan(0);

    const raid = resolveBunkerRaid(base, 1, "sealed-starter-raid", {
      terrainAt: openTerrain,
    });

    // With the room sealed, no clanker can even target the player
    // cell: they fall back to the claim perimeter and never reach in.
    expect(
      raid.clankers.some(
        (clanker) =>
          clanker.targetCol === core.col && clanker.targetRow === core.row,
      ),
    ).toBe(false);
    expect(raid.coreDamage).toBe(0);
    expect(raid.minerKilled).toBe(false);
    expect(raid.survived).toBe(true);
    expect(raid.sealed).toBe(true);
    expect(raid.reward.vibes).toBeGreaterThan(0);
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
    expect(placed.inventory["wall-panel"]).toBe(5);
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
    expect(removed.inventory["wall-panel"]).toBe(6);
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
    expect(placed.inventory["wall-panel"]).toBe(5);
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
    const bunker = fullyEnclosedBunker(4, 5);

    const raid = resolveBunkerRaid(bunker, 1, "test-raid");
    expect(raid.durationSeconds).toBeLessThan(180);
    expect(raid.clankers).toHaveLength(6);
    expect(raid.allClankersDead).toBe(true);
    expect(
      raid.clankers.map((clanker) => `${clanker.col},${clanker.row}`),
    ).toEqual(
      [-2, 10, -3, 11, -4, 12].map(
        (col) => `${col},${bunker.footprint.row - 1}`,
      ),
    );
    expect(raid.partDamage.length).toBeGreaterThan(0);
    expect(raid.incomingDamage).toBeGreaterThan(0);
    expect(
      raid.clankers.every((clanker) => clanker.status === "battery-drained"),
    ).toBe(true);
    expect(
      raid.partDamage.some(
        (event) => event.damage >= BASE_PART_CATALOG["wall-panel"].durability,
      ),
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

  it("spends remaining Clanker battery chewing a surviving blocker", () => {
    const base = fullyEnclosedBunker(10, 8);
    const bunker = {
      ...base,
      parts: base.parts.map((part) => ({ ...part, durability: 500 })),
    };
    const blockingWall = bunker.parts[0];
    expect(blockingWall).toBeDefined();
    if (!blockingWall) return;
    const raid = resolveBunkerRaid(bunker, 1, "chew-raid");
    const clanker = raid.clankers[0];
    const damage = raid.partDamage.find((event) => {
      return event.clankerId === clanker?.id;
    });

    expect(clanker).toMatchObject({
      targetCol: blockingWall.col,
      targetRow: blockingWall.row,
      status: "battery-drained",
      deathStep: 9,
    });
    expect(clanker?.path).toHaveLength(10);
    expect(damage).toMatchObject({
      target: "part",
      partId: "wall-panel",
      damage: 192,
    });
    expect(
      raid.xpPickups.find((pickup) => pickup.id === `${clanker?.id}-xp`),
    ).toMatchObject({
      col: blockingWall.col - 1,
      row: blockingWall.row,
      collected: false,
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

  it("prefers an open bunker route to the miner over biting a nearby wall", () => {
    let base = createBunker(proposedBunkerFootprint(10, 8));
    const placed = placeBasePart(
      base,
      STARTER_BASE_PART_INVENTORY,
      "wall-panel",
      base.footprint.col,
      base.footprint.row,
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    base = placed.bunker;
    const firstSpawn = {
      col: base.footprint.col - 3,
      row: base.footprint.row - 1,
    };
    const open = new Set<string>();
    for (let col = firstSpawn.col; col <= base.footprint.col + 1; col++) {
      open.add(`${col},${firstSpawn.row}`);
    }
    for (let row = base.footprint.row; row <= base.core.row; row++) {
      open.add(`${base.footprint.col + 1},${row}`);
    }
    for (let col = base.footprint.col + 1; col <= base.core.col; col++) {
      open.add(`${col},${base.core.row}`);
    }

    const raid = resolveBunkerRaid(base, 1, "gap-raid", {
      terrainAt: (col, row) => (open.has(`${col},${row}`) ? "empty" : "dirt"),
    });

    expect(raid.clankers[0]).toMatchObject({
      targetCol: base.core.col,
      targetRow: base.core.row,
    });
    expect(raid.clankers[0]?.path).toContainEqual({
      col: base.footprint.col + 1,
      row: base.footprint.row,
    });
    expect(raid.partDamage).not.toContainEqual(
      expect.objectContaining({
        col: base.footprint.col,
        row: base.footprint.row,
        target: "part",
      }),
    );
    expect(raid.minerKilled).toBe(true);
    expect(raid.survived).toBe(false);
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
    expect(raid.sealed).toBe(false);
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
    const base = fullyEnclosedBunker(10, 8);
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

describe("raid tiers (F-084)", () => {
  it("caps the startable tier at one per player level up to the ceiling", () => {
    expect(maxBunkerRaidTier(0)).toBe(1);
    expect(maxBunkerRaidTier(1)).toBe(1);
    expect(maxBunkerRaidTier(3)).toBe(3);
    expect(maxBunkerRaidTier(99)).toBe(BUNKER_RAID_TIER_CAP);
  });

  it("scales the wave and the reward pool with tier", () => {
    const bunker = createBunker(proposedBunkerFootprint(10, 10));
    const low = resolveBunkerRaid(bunker, 1, "raid-low");
    const high = resolveBunkerRaid(bunker, 3, "raid-high");
    expect(high.clankers.length).toBeGreaterThan(low.clankers.length);
    // Each higher-tier Clanker also reaches farther: reward scaling rides
    // the larger wave (more kills, more pickups) while battery makes the
    // wave harder to stop.
    expect(high.clankers[0]?.batterySteps ?? 0).toBeGreaterThan(
      low.clankers[0]?.batterySteps ?? 0,
    );
  });
});

describe("specialist Clankers (F-085)", () => {
  it("assigns kinds deterministically by slot and tier", () => {
    // Tier 1: everyone standard.
    for (let i = 0; i < 8; i++) expect(clankerKindFor(i, 1)).toBe("standard");
    // Tier 2 unlocks breachers on every third slot.
    expect(clankerKindFor(2, 2)).toBe("breacher");
    expect(clankerKindFor(5, 2)).toBe("breacher");
    expect(clankerKindFor(3, 2)).toBe("standard");
    // Tier 3 unlocks tanks on every fourth slot, taking precedence.
    expect(clankerKindFor(3, 3)).toBe("tank");
    expect(clankerKindFor(7, 3)).toBe("tank");
    expect(clankerKindFor(2, 3)).toBe("breacher");
  });

  it("pays more XP for stopping specialists", () => {
    expect(clankerXpFor("standard")).toBe(CLANKER_SELF_DESTRUCT_XP);
    expect(clankerXpFor("breacher")).toBe(CLANKER_BREACHER_XP);
    expect(clankerXpFor("tank")).toBe(CLANKER_TANK_XP);
    expect(CLANKER_TANK_XP).toBeGreaterThan(CLANKER_BREACHER_XP);
    expect(CLANKER_BREACHER_XP).toBeGreaterThan(CLANKER_SELF_DESTRUCT_XP);
  });

  it("stamps every raid clanker with its kind and replays identically", () => {
    const bunker = createBunker(proposedBunkerFootprint(10, 10));
    const a = resolveBunkerRaid(bunker, 3, "raid-kinds");
    const b = resolveBunkerRaid(bunker, 3, "raid-kinds");
    expect(b).toEqual(a);
    const kinds = a.clankers.map((clanker) => clanker.kind);
    expect(kinds).toContain("breacher");
    expect(kinds).toContain("tank");
    for (const [index, kind] of kinds.entries()) {
      expect(kind).toBe(clankerKindFor(index, 3));
    }
  });
});

describe("bunker repairs and stacked rooms (F-086)", () => {
  it("prices repairs proportionally and restores everything", () => {
    const bunker = createBunker(proposedBunkerFootprint(10, 10));
    const wall = BASE_PART_CATALOG["wall-panel"];
    const placed = placeBasePart(
      bunker,
      STARTER_BASE_PART_INVENTORY,
      "wall-panel",
      bunker.core.col - 1,
      bunker.core.row,
    );
    if (!placed.ok) throw new Error(placed.reason);
    // Chip the wall to half and the core by 20.
    const damaged = {
      ...placed.bunker,
      core: {
        ...placed.bunker.core,
        durability: BUNKER_CORE_MAX_DURABILITY - 20,
      },
      parts: placed.bunker.parts.map((part) => ({
        ...part,
        durability: Math.floor(wall.durability / 2),
      })),
    };
    const plan = bunkerRepairPlan(damaged);
    expect(plan.partCount).toBe(1);
    expect(plan.coreMissing).toBe(20);
    // Concrete expectation: the wall (price 6) at half durability costs
    // ceil(0.5 * 6 * 0.5) = 2, the core's 20 missing points cost
    // ceil(20 * 0.25) = 5, so the plan totals 7 vibes.
    expect(plan.totalCost).toBe(7);
    const repaired = applyBunkerRepairs(damaged);
    expect(repaired.core.durability).toBe(BUNKER_CORE_MAX_DURABILITY);
    expect(repaired.parts[0].durability).toBe(wall.durability);
    expect(bunkerRepairPlan(repaired).totalCost).toBe(0);
  });

  it("seals a stacked two-room layout with existing parts", () => {
    // Two rooms one above the other inside the claim: the outer shell
    // plus an interior floor row splitting them. The seal must hold
    // (no clanker can target the core) exactly as in a single room.
    const bunker = createBunker(proposedBunkerFootprint(10, 10));
    const { col, row } = bunker.core;
    let current = bunker;
    let stock = STARTER_BASE_PART_INVENTORY;
    const place = (
      partId: Parameters<typeof placeBasePart>[2],
      c: number,
      r: number,
    ) => {
      const result = placeBasePart(current, stock, partId, c, r);
      if (!result.ok) throw new Error(`${partId}@${c},${r}: ${result.reason}`);
      current = result.bunker;
      stock = result.inventory;
    };
    // Outer shell around a 1-wide, 2-tall interior (core on the lower level).
    place("floor-panel", col, row + 1);
    place("roof-panel", col, row - 2);
    place("wall-panel", col - 1, row);
    place("door-panel", col + 1, row);
    place("wall-panel", col - 1, row - 1);
    place("wall-panel", col + 1, row - 1);
    // Interior floor between the two levels: the second room sits above.
    place("floor-panel", col, row - 1);
    const raid = resolveBunkerRaid(current, 1, "raid-stacked");
    expect(raid.survived).toBe(true);
    expect(raid.sealed).toBe(true);
    expect(raid.coreDamage).toBe(0);
  });
});

describe("bunker skins (F-087)", () => {
  it("keeps the catalog cosmetic and well-formed", () => {
    const skins = Object.values(BUNKER_SKIN_CATALOG);
    expect(skins.map((skin) => skin.id)).toContain(DEFAULT_BUNKER_SKIN);
    expect(BUNKER_SKIN_CATALOG[DEFAULT_BUNKER_SKIN].price).toBe(0);
    for (const skin of skins) {
      expect(skin.name.length).toBeGreaterThan(0);
      expect(skin.price).toBeGreaterThanOrEqual(0);
      // Cosmetic only: the def carries no stats.
      expect(Object.keys(skin).sort()).toEqual([
        "blurb",
        "id",
        "name",
        "price",
      ]);
    }
    expect(isBunkerSkinId("gilded")).toBe(true);
    expect(isBunkerSkinId("nonsense")).toBe(false);
    // Inherited object keys must not pass the guard.
    expect(isBunkerSkinId("toString")).toBe(false);
    expect(isBunkerSkinId("constructor")).toBe(false);
  });
});
