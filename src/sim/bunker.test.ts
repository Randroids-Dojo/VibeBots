import { describe, expect, it } from "vitest";
import {
  applyBunkerRaidWear,
  applyBunkerRepairs,
  applyBunkerReset,
  BASE_PART_CATALOG,
  BUNKER_CLAIM_DEPTH,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  BUNKER_CORE_MAX_DURABILITY,
  BUNKER_RAID_TIER_CAP,
  BUNKER_SKIN_CATALOG,
  type BunkerRaidTerrainKind,
  type BunkerState,
  basePartOwnedLimit,
  bunkerCells,
  bunkerRepairPlan,
  CLANKER_BREACHER_XP,
  CLANKER_SELF_DESTRUCT_XP,
  CLANKER_TANK_XP,
  canBuyBasePart,
  clankerKindFor,
  clankerXpFor,
  containsBunkerCell3D,
  createBunker,
  creditBunkerDig,
  DEFAULT_BUNKER_SKIN,
  excavateBunkerCell,
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
  settleBunkerDig,
  takeBunkerLootAt,
} from "./bunker";
import {
  bunkerCellBlock,
  bunkerSpawnPocketCells,
  deriveBunkerBlockSeed,
} from "./bunker-blocks";
import { oreReserveAt } from "./mine/ores";
import { createMine } from "./mine/world";

const openTerrain = (): BunkerRaidTerrainKind => "empty";

/** The first ore (col,row,depth) in a bunker's volume, so ore-yield tests
 * do not hardcode a generator-dependent cell. */
function firstBunkerOreCell(
  bunker: BunkerState,
): { col: number; row: number; depth: number } | null {
  const { footprint, blockSeed } = bunker;
  if (blockSeed === undefined) return null;
  const bottomRow = footprint.row + footprint.height - 1;
  for (let depth = 0; depth < BUNKER_CLAIM_DEPTH; depth++) {
    for (let y = 0; y < footprint.height; y++) {
      for (let x = 0; x < footprint.width; x++) {
        if (bunkerCellBlock(blockSeed, footprint, x, y, depth).kind === "ore") {
          return { col: footprint.col + x, row: bottomRow - y, depth };
        }
      }
    }
  }
  return null;
}

/**
 * A bunker with every cell excavated. The redesign makes a fresh claim
 * mostly solid rock (only the spawn pocket is open), so tests that
 * exercise part placement, raids, or repairs (orthogonal to the dig-out
 * mechanic) start from a fully open volume, matching the pre-F-115
 * open-plane behavior once a room has been dug.
 */
function allDugBunker(minerCol: number, minerRow: number): BunkerState {
  const bunker = createBunker(proposedBunkerFootprint(minerCol, minerRow));
  const dug = [];
  for (let depth = 0; depth < BUNKER_CLAIM_DEPTH; depth++) {
    for (const cell of bunkerCells(bunker.footprint)) {
      dug.push({ col: cell.col, row: cell.row, depth });
    }
  }
  return { ...bunker, dug };
}

/** A bunker with the whole depth-0 plane dug out but deeper cells still
 * solid rock: reproduces the pre-F-115 "tunnel plane open, interior
 * rock until dug" shape for tests that exercise the depth axis. */
function planeDugBunker(minerCol: number, minerRow: number): BunkerState {
  const bunker = createBunker(proposedBunkerFootprint(minerCol, minerRow));
  const dug = bunkerCells(bunker.footprint).map((cell) => ({
    col: cell.col,
    row: cell.row,
    depth: 0,
  }));
  return { ...bunker, dug };
}

function fullyEnclosedBunker(minerCol: number, minerRow: number) {
  const bunker = allDugBunker(minerCol, minerRow);
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
        depth: 0,
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
    let base = allDugBunker(10, 8);
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
    const bunker = allDugBunker(10, 8);
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
        depth: 0,
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
    const bunker = allDugBunker(10, 8);
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
        depth: 0,
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
    const base = allDugBunker(10, 8);
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
    let base = allDugBunker(10, 8);
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
    const base = allDugBunker(10, 8);
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
    const base = allDugBunker(10, 8);
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
    const base = allDugBunker(10, 8);
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
    const base = allDugBunker(4, 5);
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
        depth: 0,
        durability: 2,
      },
    ]);
  });

  it("damages Clankers with Floor Spikes and wears them down", () => {
    const base = allDugBunker(4, 5);
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
        depth: 0,
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
          depth: 0,
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
    const base = allDugBunker(4, 5);
    const bunker = {
      ...base,
      parts: [
        {
          partId: "basic-turret" as const,
          col: base.footprint.col,
          row: base.footprint.row,
          depth: 0,
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
    const base = allDugBunker(4, 5);

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
    const bunker = allDugBunker(10, 10);
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
    const bunker = allDugBunker(10, 10);
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

  it("resets the bunker to a bare claim, refunding only undamaged parts", () => {
    const bunker = planeDugBunker(10, 10);
    const { col, row } = bunker.core;
    let current = bunker;
    let stock = STARTER_BASE_PART_INVENTORY;
    for (const [partId, c, r] of [
      ["wall-panel", col - 1, row],
      ["wall-panel", col + 1, row],
      ["door-panel", col, row - 1],
    ] as const) {
      const placed = placeBasePart(current, stock, partId, c, r);
      if (!placed.ok) throw new Error(placed.reason);
      current = placed.bunker;
      stock = placed.inventory;
    }
    const dugOut = excavateBunkerCell(current, col, row, 1);
    if (!dugOut.ok) throw new Error(dugOut.reason);
    // One wall chipped, the door untouched, the core dented, one cell
    // dug, a purchased skin selected.
    const damaged = {
      ...dugOut.bunker,
      core: { ...dugOut.bunker.core, durability: 40 },
      skin: "gilded" as const,
      skinsOwned: ["gilded" as const],
      parts: dugOut.bunker.parts.map((part, index) =>
        index === 0 ? { ...part, durability: part.durability - 1 } : part,
      ),
    };
    expect(stock["wall-panel"]).toBe(4);
    expect(stock["door-panel"]).toBe(0);

    const reset = applyBunkerReset(damaged, stock);

    // Refund rule: undamaged parts return, the damaged wall is lost
    // (removeBasePart's "damaged parts do not refund" contract).
    expect(reset.inventory["wall-panel"]).toBe(5);
    expect(reset.inventory["door-panel"]).toBe(1);
    expect(reset.bunker.parts).toEqual([]);
    // Reset clears the built layout but keeps the excavation and its
    // depletion (F-120): the dug-out rock survives.
    expect(reset.bunker.dug).toEqual(damaged.dug);
    expect(reset.bunker.core.durability).toBe(BUNKER_CORE_MAX_DURABILITY);
    // The claim itself survives: footprint, core cell, and skins.
    expect(reset.bunker.footprint).toEqual(damaged.footprint);
    expect(reset.bunker.core.col).toBe(damaged.core.col);
    expect(reset.bunker.core.row).toBe(damaged.core.row);
    expect(reset.bunker.core.depth).toBe(damaged.core.depth);
    expect(reset.bunker.skin).toBe("gilded");
    expect(reset.bunker.skinsOwned).toEqual(["gilded"]);
    // Pure: the inputs are untouched.
    expect(damaged.parts).toHaveLength(3);
    expect(stock["wall-panel"]).toBe(4);
  });

  it("resets a fresh claim to itself, keeping its spawn pocket", () => {
    const bunker = createBunker(proposedBunkerFootprint(10, 10));
    const reset = applyBunkerReset(bunker, STARTER_BASE_PART_INVENTORY);
    expect(reset.bunker.parts).toEqual([]);
    // The pre-mined spawn pocket survives a reset (F-115/F-120).
    expect(reset.bunker.dug).toEqual(bunker.dug);
    expect(reset.bunker.dug.length).toBeGreaterThan(0);
    expect(reset.bunker.core.durability).toBe(BUNKER_CORE_MAX_DURABILITY);
    expect(reset.inventory).toEqual(STARTER_BASE_PART_INVENTORY);
  });

  it("seals a stacked two-room layout with existing parts", () => {
    // Two rooms one above the other inside the claim: the outer shell
    // plus an interior floor row splitting them. The seal must hold
    // (no clanker can target the core) exactly as in a single room.
    const bunker = allDugBunker(10, 10);
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

describe("bunker depth axis (7x5x5 groundwork)", () => {
  const inventory = () => ({
    ...STARTER_BASE_PART_INVENTORY,
    "basic-turret": 1,
    "floor-spikes": 2,
  });

  it("keeps placements inside the 7x5x5 volume", () => {
    const bunker = allDugBunker(4, 5);
    const col = bunker.footprint.col;
    const row = bunker.footprint.row;
    expect(containsBunkerCell3D(bunker.footprint, col, row, 0)).toBe(true);
    expect(
      containsBunkerCell3D(bunker.footprint, col, row, BUNKER_CLAIM_DEPTH - 1),
    ).toBe(true);
    expect(
      placeBasePart(bunker, inventory(), "wall-panel", col, row, -1),
    ).toEqual({ ok: false, reason: "outside" });
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "wall-panel",
        col,
        row,
        BUNKER_CLAIM_DEPTH,
      ),
    ).toEqual({ ok: false, reason: "outside" });
    // Depth layers are whole cells: fractional depths would silently
    // normalize to 0 on every persistence read and collide there.
    expect(
      placeBasePart(bunker, inventory(), "wall-panel", col, row, 0.5),
    ).toEqual({ ok: false, reason: "outside" });
    expect(containsBunkerCell3D(bunker.footprint, col, row, 0.5)).toBe(false);
  });

  it("treats each depth as its own occupancy layer", () => {
    const bunker = planeDugBunker(4, 5);
    const col = bunker.footprint.col;
    const row = bunker.footprint.row;
    const front = placeBasePart(bunker, inventory(), "wall-panel", col, row, 0);
    expect(front.ok).toBe(true);
    if (!front.ok) return;
    // Deep cells start as rock: placement fails until the cell is dug.
    expect(
      placeBasePart(front.bunker, front.inventory, "wall-panel", col, row, 1),
    ).toEqual({ ok: false, reason: "rock" });
    const dug = excavateBunkerCell(front.bunker, col, row, 1);
    expect(dug.ok).toBe(true);
    if (!dug.ok) return;
    const behind = placeBasePart(
      dug.bunker,
      front.inventory,
      "wall-panel",
      col,
      row,
      1,
    );
    expect(behind.ok).toBe(true);
    if (!behind.ok) return;
    expect(behind.bunker.parts.map((part) => part.depth)).toEqual([0, 1]);
    expect(
      placeBasePart(behind.bunker, behind.inventory, "wall-panel", col, row, 1),
    ).toEqual({ ok: false, reason: "occupied" });
    expect(
      removeBasePart(behind.bunker, behind.inventory, col, row, 3),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("blocks only the core's exact 3D cell", () => {
    const bunker = planeDugBunker(4, 5);
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "wall-panel",
        bunker.core.col,
        bunker.core.row,
        0,
      ),
    ).toEqual({ ok: false, reason: "core" });
    const dugBehindCore = excavateBunkerCell(
      bunker,
      bunker.core.col,
      bunker.core.row,
      1,
    );
    expect(dugBehindCore.ok).toBe(true);
    if (!dugBehindCore.ok) return;
    const behindCore = placeBasePart(
      dugBehindCore.bunker,
      inventory(),
      "wall-panel",
      bunker.core.col,
      bunker.core.row,
      1,
    );
    expect(behindCore.ok).toBe(true);
  });

  it("moves parts across depths without changing durability", () => {
    const bunker = planeDugBunker(4, 5);
    const col = bunker.footprint.col;
    const row = bunker.footprint.row;
    const placed = placeBasePart(
      bunker,
      inventory(),
      "wall-panel",
      col,
      row,
      0,
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const worn = {
      ...placed.bunker,
      parts: placed.bunker.parts.map((part) => ({ ...part, durability: 33 })),
    };
    // Moving into rock fails; dig the chain, then the move lands.
    expect(moveBasePart(worn, col, row, col, row, 0, 2)).toEqual({
      ok: false,
      reason: "rock",
    });
    const dugOne = excavateBunkerCell(worn, col, row, 1);
    expect(dugOne.ok).toBe(true);
    if (!dugOne.ok) return;
    const dugTwo = excavateBunkerCell(dugOne.bunker, col, row, 2);
    expect(dugTwo.ok).toBe(true);
    if (!dugTwo.ok) return;
    const moved = moveBasePart(dugTwo.bunker, col, row, col, row, 0, 2);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.bunker.parts).toEqual([
      { partId: "wall-panel", col, row, depth: 2, durability: 33 },
    ]);
  });

  it("resolves raids over the tunnel plane only until live 3D raids land", () => {
    const flat = fullyEnclosedBunker(4, 5);
    const deepParts = [
      {
        partId: "wall-panel" as const,
        col: flat.footprint.col + 1,
        row: flat.footprint.row + 1,
        depth: 2,
        durability: BASE_PART_CATALOG["wall-panel"].durability,
      },
      {
        partId: "basic-turret" as const,
        col: flat.footprint.col + 2,
        row: flat.footprint.row + 1,
        depth: 3,
        durability: BASE_PART_CATALOG["basic-turret"].durability,
      },
      {
        partId: "floor-spikes" as const,
        col: flat.footprint.col + 3,
        row: flat.footprint.row + 1,
        depth: 1,
        durability: FLOOR_SPIKES_DURABILITY,
      },
    ];
    const withDeep = { ...flat, parts: [...flat.parts, ...deepParts] };

    const flatRaid = resolveBunkerRaid(flat, 1, "depth-raid", {
      terrainAt: openTerrain,
    });
    const deepRaid = resolveBunkerRaid(withDeep, 1, "depth-raid", {
      terrainAt: openTerrain,
    });
    // Deep turrets add no shots, deep spikes never trigger, deep walls
    // never block or soak: the snapshots are indistinguishable.
    expect(deepRaid).toEqual(flatRaid);

    const worn = applyBunkerRaidWear(withDeep, deepRaid);
    for (const part of deepParts) {
      expect(worn.parts).toContainEqual(part);
    }
  });
});

describe("bunker excavation (dig-out depth)", () => {
  it("digs only reachable interior rock", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const col = base.footprint.col;
    const row = base.footprint.row;
    // Start from a single open floor cell so the dug chain is exact and
    // every deeper cell must be reached through it.
    const bunker: BunkerState = { ...base, dug: [{ col, row, depth: 0 }] };
    // Outside the volume.
    expect(excavateBunkerCell(bunker, col - 1, row, 1)).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(excavateBunkerCell(bunker, col, row, 5)).toEqual({
      ok: false,
      reason: "outside",
    });
    // The open floor cell cannot be re-dug.
    expect(excavateBunkerCell(bunker, col, row, 0)).toEqual({
      ok: false,
      reason: "open",
    });
    const first = excavateBunkerCell(bunker, col, row, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(excavateBunkerCell(first.bunker, col, row, 1)).toEqual({
      ok: false,
      reason: "open",
    });
    // Depth 2 is reachable only through the freshly dug depth-1 cell.
    expect(excavateBunkerCell(bunker, col, row, 2)).toEqual({
      ok: false,
      reason: "unreachable",
    });
    const second = excavateBunkerCell(first.bunker, col, row, 2);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.bunker.dug).toEqual([
      { col, row, depth: 0 },
      { col, row, depth: 1 },
      { col, row, depth: 2 },
    ]);
  });

  it("keeps raids indifferent to dug rock until live 3D raids land", () => {
    const flat = fullyEnclosedBunker(4, 5);
    const dugOut = {
      ...flat,
      dug: [
        { col: flat.footprint.col + 1, row: flat.footprint.row + 1, depth: 1 },
        { col: flat.footprint.col + 1, row: flat.footprint.row + 1, depth: 2 },
      ],
    };
    const flatRaid = resolveBunkerRaid(flat, 1, "dug-raid", {
      terrainAt: openTerrain,
    });
    const dugRaid = resolveBunkerRaid(dugOut, 1, "dug-raid", {
      terrainAt: openTerrain,
    });
    expect(dugRaid).toEqual(flatRaid);
  });
});

describe("bunker ore crediting (F-116)", () => {
  it("credits a dug ore cell's full reserve into the bag, no overflow", () => {
    const footprint = proposedBunkerFootprint(60, 30);
    const bunker = createBunker(
      footprint,
      deriveBunkerBlockSeed(4242, footprint),
    );
    const ore = firstBunkerOreCell(bunker);
    if (!ore) throw new Error("expected an ore cell in the volume");
    const state = createMine(1);
    const result = creditBunkerDig(state, bunker, ore.col, ore.row, ore.depth);
    const block = bunkerCellBlock(
      bunker.blockSeed ?? 0,
      footprint,
      ore.col - footprint.col,
      footprint.row + footprint.height - 1 - ore.row,
      ore.depth,
    );
    const reserve = oreReserveAt(block.ore ?? "coal", ore.row);
    // The starter bag (4 slots x 5) may not hold a deep reserve; whatever
    // fits enters cargo and the rest spills to loot.
    expect(result.taken + result.spilled).toBe(reserve);
    expect(state.miner.carried[block.ore ?? "coal"]).toBe(result.taken);
    if (result.spilled > 0) {
      expect(result.bunker.loot).toContainEqual(
        expect.objectContaining({
          col: ore.col,
          row: ore.row,
          depth: ore.depth,
        }),
      );
    }
  });

  it("credits nothing for a rock/dirt cell and leaves the bag untouched", () => {
    const footprint = proposedBunkerFootprint(60, 30);
    const bunker = createBunker(
      footprint,
      deriveBunkerBlockSeed(4242, footprint),
    );
    // Find a non-ore cell.
    const bottomRow = footprint.row + footprint.height - 1;
    let target: { col: number; row: number; depth: number } | null = null;
    for (let y = 0; y < footprint.height && !target; y++) {
      for (let x = 0; x < footprint.width; x++) {
        if (
          bunkerCellBlock(bunker.blockSeed ?? 0, footprint, x, y, 1).kind !==
          "ore"
        ) {
          target = { col: footprint.col + x, row: bottomRow - y, depth: 1 };
          break;
        }
      }
    }
    if (!target) throw new Error("expected a non-ore cell");
    const state = createMine(1);
    const result = creditBunkerDig(
      state,
      bunker,
      target.col,
      target.row,
      target.depth,
    );
    expect(result.taken).toBe(0);
    expect(result.spilled).toBe(0);
    expect(result.bunker.loot ?? []).toHaveLength(0);
  });

  it("settleBunkerDig skips the spawn pocket and is idempotent", () => {
    const footprint = proposedBunkerFootprint(60, 30);
    const base = createBunker(
      footprint,
      deriveBunkerBlockSeed(4242, footprint),
    );
    const ore = firstBunkerOreCell(base);
    if (!ore) throw new Error("expected an ore cell in the volume");
    const bunker = { ...base, dug: [...base.dug, ore] };

    const stateA = createMine(1);
    const settledA = settleBunkerDig(stateA, bunker);
    const stateB = createMine(1);
    const settledB = settleBunkerDig(stateB, bunker);
    // Same inputs -> same authoritative bag and same loot.
    expect(stateA.miner.carried).toEqual(stateB.miner.carried);
    expect(settledA.loot ?? []).toEqual(settledB.loot ?? []);

    // Settling an already-settled bunker (with loot) recomputes the same
    // result, never doubling the payout (idempotent).
    const stateC = createMine(1);
    const settledC = settleBunkerDig(stateC, settledA);
    expect(stateC.miner.carried).toEqual(stateA.miner.carried);
    expect(settledC.loot ?? []).toEqual(settledA.loot ?? []);
  });

  it("never pays a pocket cell (pre-mined starter room is free)", () => {
    const footprint = proposedBunkerFootprint(60, 30);
    const bunker = createBunker(
      footprint,
      deriveBunkerBlockSeed(4242, footprint),
    );
    // dug is exactly the pocket; settling credits nothing.
    const state = createMine(1);
    const settled = settleBunkerDig(state, bunker);
    expect(state.miner.carried).toEqual({});
    expect(settled.loot ?? []).toHaveLength(0);
    // Sanity: the pocket really is the whole dug set here.
    expect(bunker.dug).toEqual(bunkerSpawnPocketCells(footprint));
  });

  it("takeBunkerLootAt removes the whole pile at a cell and returns its ore", () => {
    const footprint = proposedBunkerFootprint(60, 30);
    const withLoot: BunkerState = {
      ...createBunker(footprint, deriveBunkerBlockSeed(4242, footprint)),
      loot: [
        { col: footprint.col, row: footprint.row, depth: 2, ores: { coal: 3 } },
        {
          col: footprint.col + 1,
          row: footprint.row,
          depth: 2,
          ores: { copper: 4 },
        },
      ],
    };
    const result = takeBunkerLootAt(withLoot, footprint.col, footprint.row, 2);
    expect(result.ores).toEqual({ coal: 3 });
    // Only the target cell is cleared; the other loot pile survives.
    expect(result.bunker.loot).toEqual([
      {
        col: footprint.col + 1,
        row: footprint.row,
        depth: 2,
        ores: { copper: 4 },
      },
    ]);
  });

  it("takeBunkerLootAt is a no-op on a cell with no loot", () => {
    const footprint = proposedBunkerFootprint(60, 30);
    const withLoot: BunkerState = {
      ...createBunker(footprint, deriveBunkerBlockSeed(4242, footprint)),
      loot: [
        { col: footprint.col, row: footprint.row, depth: 2, ores: { coal: 3 } },
      ],
    };
    const result = takeBunkerLootAt(
      withLoot,
      footprint.col + 5,
      footprint.row,
      4,
    );
    expect(result.ores).toEqual({});
    expect(result.bunker.loot).toHaveLength(1);
  });
});
