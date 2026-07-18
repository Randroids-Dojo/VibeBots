import { describe, expect, it } from "vitest";
import {
  AVAILABLE_BASE_PART_IDS,
  allowedBunkerSlots,
  applyBunkerRepairs,
  applyBunkerReset,
  applyBunkerStartFresh,
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BasePartInventory,
  BUNKER_CLAIM_DEPTH,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  BUNKER_LAYOUT_VERSION,
  BUNKER_RAID_TIER_CAP,
  BUNKER_SKIN_CATALOG,
  BUNKER_SLOTS,
  type BunkerSlot,
  type BunkerState,
  basePartOwnedLimit,
  bunkerCells,
  bunkerRepairPlan,
  CLANKER_BREACHER_XP,
  CLANKER_SELF_DESTRUCT_XP,
  CLANKER_TANK_XP,
  canBuyBasePart,
  canonicalWallSlot,
  cascadeUnsupportedFloors,
  clankerKindFor,
  clankerXpFor,
  containsBunkerCell3D,
  createBunker,
  creditBunkerDig,
  DEFAULT_BUNKER_SKIN,
  excavateBunkerCell,
  isBunkerLayoutIncompatible,
  isBunkerSkinId,
  isBunkerWallSlot,
  isOpenBunkerCell,
  maxBunkerRaidTier,
  moveBasePart,
  overallPlayerLevel,
  placeBasePart,
  playerLevelProgress,
  proposedBunkerFootprint,
  removeBasePart,
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

/** The footprint's center cell on the tunnel plane: the cell the retired
 * core used to occupy (F-118). Kept as a stable central reference for
 * placement and reset tests. */
function centerCell(bunker: BunkerState): { col: number; row: number } {
  const { footprint } = bunker;
  return {
    col: footprint.col + Math.floor(footprint.width / 2),
    row: footprint.row + Math.floor(footprint.height / 2),
  };
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

  it("hides a comingSoon part from every obtainable-part path (F-117 stair)", () => {
    // The staircase is fully modeled but flagged comingSoon until the climb
    // ships, so it must not appear anywhere a player picks a part.
    expect(BASE_PART_CATALOG["stair-panel"].comingSoon).toBe(true);
    expect(AVAILABLE_BASE_PART_IDS).not.toContain("stair-panel");
    expect(AVAILABLE_BASE_PART_IDS).toEqual(
      BASE_PART_IDS.filter((id) => !BASE_PART_CATALOG[id].comingSoon),
    );
    for (const id of AVAILABLE_BASE_PART_IDS) {
      expect(BASE_PART_CATALOG[id].comingSoon).toBeFalsy();
    }
    // The buy gate rejects it regardless of level or stock.
    expect(
      canBuyBasePart("stair-panel", 99, null, STARTER_BASE_PART_INVENTORY, 1),
    ).toEqual({ ok: false, reason: "unreleased" });
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
});

describe("bunker repairs and stacked rooms (F-086)", () => {
  it("prices repairs proportionally and restores every part", () => {
    const bunker = allDugBunker(10, 10);
    const center = centerCell(bunker);
    const wall = BASE_PART_CATALOG["wall-panel"];
    const placed = placeBasePart(
      bunker,
      STARTER_BASE_PART_INVENTORY,
      "wall-panel",
      center.col - 1,
      center.row,
    );
    if (!placed.ok) throw new Error(placed.reason);
    // Chip the wall to half durability.
    const damaged = {
      ...placed.bunker,
      parts: placed.bunker.parts.map((part) => ({
        ...part,
        durability: Math.floor(wall.durability / 2),
      })),
    };
    const plan = bunkerRepairPlan(damaged);
    expect(plan.partCount).toBe(1);
    // Concrete expectation: the wall (price 6) at half durability costs
    // ceil(0.5 * 6 * 0.5) = 2, so the plan totals 2 vibes.
    expect(plan.totalCost).toBe(2);
    const repaired = applyBunkerRepairs(damaged);
    expect(repaired.parts[0].durability).toBe(wall.durability);
    expect(bunkerRepairPlan(repaired).totalCost).toBe(0);
  });

  it("resets the bunker to a bare claim, refunding only undamaged parts", () => {
    const bunker = planeDugBunker(10, 10);
    const { col, row } = centerCell(bunker);
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
    // One wall chipped, the door untouched, one cell dug, a purchased
    // skin selected.
    const damaged = {
      ...dugOut.bunker,
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
    // The claim itself survives: footprint and skins.
    expect(reset.bunker.footprint).toEqual(damaged.footprint);
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
    expect(reset.inventory).toEqual(STARTER_BASE_PART_INVENTORY);
  });
});

describe("bunker layout version and Start fresh (F-117)", () => {
  it("stamps fresh claims with the current layout version", () => {
    const bunker = createBunker(proposedBunkerFootprint(10, 10));
    expect(bunker.layoutVersion).toBe(BUNKER_LAYOUT_VERSION);
    expect(isBunkerLayoutIncompatible(bunker)).toBe(false);
  });

  it("reads a versionless (legacy) bunker as incompatible", () => {
    const legacy: BunkerState = {
      footprint: proposedBunkerFootprint(10, 10),
      parts: [],
      dug: [],
      // No layoutVersion: a row written before the marker existed.
    };
    expect(legacy.layoutVersion).toBeUndefined();
    expect(isBunkerLayoutIncompatible(legacy)).toBe(true);
  });

  it("treats any version below the current one as incompatible", () => {
    const older: BunkerState = {
      footprint: proposedBunkerFootprint(10, 10),
      parts: [],
      dug: [],
      layoutVersion: BUNKER_LAYOUT_VERSION - 1,
    };
    expect(isBunkerLayoutIncompatible(older)).toBe(true);
  });

  it("Start fresh clears parts with no refund, stamps the version, and keeps the excavation", () => {
    const footprint = proposedBunkerFootprint(10, 10);
    const legacy: BunkerState = {
      footprint,
      // A built legacy layout with a mix of full-durability and damaged parts.
      parts: [
        {
          partId: "wall-panel",
          col: footprint.col,
          row: footprint.row,
          depth: 0,
          durability: 90,
        },
        {
          partId: "floor-panel",
          col: footprint.col + 1,
          row: footprint.row,
          depth: 0,
          durability: 40,
        },
      ],
      dug: [{ col: footprint.col, row: footprint.row + 1, depth: 1 }],
      blockSeed: 4242,
      skin: "gilded",
      skinsOwned: ["gilded"],
      loot: [
        {
          col: footprint.col,
          row: footprint.row + 1,
          depth: 1,
          ores: { coal: 3 },
        },
      ],
    };

    const fresh = applyBunkerStartFresh(legacy);

    // Parts clear and no inventory is returned: unlike reset, Start fresh
    // has no BasePartInventory in its signature at all (no refund, Q-022).
    expect(fresh.parts).toEqual([]);
    expect(applyBunkerStartFresh.length).toBe(1);
    // The version stamps forward so the bunker reads compatible after.
    expect(fresh.layoutVersion).toBe(BUNKER_LAYOUT_VERSION);
    expect(isBunkerLayoutIncompatible(fresh)).toBe(false);
    // Everything that carries no layout-model assumption survives.
    expect(fresh.dug).toEqual(legacy.dug);
    expect(fresh.footprint).toEqual(legacy.footprint);
    expect(fresh.blockSeed).toBe(4242);
    expect(fresh.skin).toBe("gilded");
    expect(fresh.skinsOwned).toEqual(["gilded"]);
    expect(fresh.loot).toEqual(legacy.loot);
    // Pure: the input is untouched.
    expect(legacy.parts).toHaveLength(2);
    expect(legacy.layoutVersion).toBeUndefined();
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

  it("builds on the freed center cell the core used to occupy (F-118)", () => {
    const bunker = planeDugBunker(4, 5);
    const center = centerCell(bunker);
    const placed = placeBasePart(
      bunker,
      inventory(),
      "wall-panel",
      center.col,
      center.row,
      0,
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    // And the cell directly behind it opens and builds like any other.
    const dugBehind = excavateBunkerCell(bunker, center.col, center.row, 1);
    expect(dugBehind.ok).toBe(true);
    if (!dugBehind.ok) return;
    const behind = placeBasePart(
      dugBehind.bunker,
      inventory(),
      "wall-panel",
      center.col,
      center.row,
      1,
    );
    expect(behind.ok).toBe(true);
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

// This foundation slice ships only the pure slot vocabulary (types, the
// per-part slot map, and canonical wall dedup). Slot-aware place, remove,
// occupancy, and the reset boundary land with the slice that lets the UI
// place thin parts, where their invariants can be exercised end to end.
describe("bunker thin sub-cell slots (F-117)", () => {
  it("maps each part to the slots it may occupy", () => {
    expect(allowedBunkerSlots("wall-panel")).toEqual([
      "wall-px",
      "wall-nx",
      "wall-pz",
      "wall-nz",
    ]);
    expect(allowedBunkerSlots("door-panel")).toEqual([
      "wall-px",
      "wall-nx",
      "wall-pz",
      "wall-nz",
    ]);
    expect(allowedBunkerSlots("floor-panel")).toEqual(["floor"]);
    expect(allowedBunkerSlots("roof-panel")).toEqual(["roof"]);
    expect(allowedBunkerSlots("basic-turret")).toEqual(["mount"]);
    expect(allowedBunkerSlots("floor-spikes")).toEqual(["mount"]);
    expect(allowedBunkerSlots("stair-panel")).toEqual(["mount"]);
    expect(BUNKER_SLOTS).toContain("floor");
    expect(
      ["wall-px", "wall-nx", "wall-pz", "wall-nz"].every((slot) =>
        isBunkerWallSlot(slot as BunkerSlot),
      ),
    ).toBe(true);
    expect(isBunkerWallSlot("floor")).toBe(false);
    expect(isBunkerWallSlot("mount")).toBe(false);
  });

  it("pins wall dividers to a single canonical face", () => {
    const bunker = allDugBunker(4, 5);
    const fp = bunker.footprint;
    const c = centerCell(bunker);
    // An interior -x face is the +x face of the cell to its left.
    expect(canonicalWallSlot(fp, c.col, c.row, 0, "wall-nx")).toEqual({
      col: c.col - 1,
      row: c.row,
      depth: 0,
      slot: "wall-px",
    });
    // An interior -z face is the +z face of the cell in front of it.
    expect(canonicalWallSlot(fp, c.col, c.row, 1, "wall-nz")).toEqual({
      col: c.col,
      row: c.row,
      depth: 0,
      slot: "wall-pz",
    });
    // +x / +z faces are already canonical.
    expect(canonicalWallSlot(fp, c.col, c.row, 0, "wall-px")).toEqual({
      col: c.col,
      row: c.row,
      depth: 0,
      slot: "wall-px",
    });
    // An edge wall whose lower neighbor is outside the footprint keeps
    // its own face rather than resolving onto a nonexistent cell.
    expect(canonicalWallSlot(fp, fp.col, c.row, 0, "wall-nx")).toEqual({
      col: fp.col,
      row: c.row,
      depth: 0,
      slot: "wall-nx",
    });
    expect(canonicalWallSlot(fp, c.col, c.row, 0, "wall-nz")).toEqual({
      col: c.col,
      row: c.row,
      depth: 0,
      slot: "wall-nz",
    });
    // Non-wall slots pass through untouched.
    expect(canonicalWallSlot(fp, c.col, c.row, 0, "floor")).toEqual({
      col: c.col,
      row: c.row,
      depth: 0,
      slot: "floor",
    });
  });

  const inventory = (): BasePartInventory => ({
    ...STARTER_BASE_PART_INVENTORY,
    "wall-panel": 12,
    "basic-turret": 1,
    "floor-spikes": 2,
  });

  // A bunker with exactly one open cell. The cell is grounded (nothing open
  // below) and closed above; a floor, four walls, and a mount always fit. A
  // roof fits only when that cell is the volume's top row (footprint.row),
  // since a roof is the bunker's ceiling and never sits mid-column.
  const oneCellBunker = (
    col: number,
    row: number,
    depth: number,
  ): BunkerState => ({
    ...createBunker(proposedBunkerFootprint(4, 5)),
    dug: [{ col, row, depth }],
  });

  // Fold one placement onto a running (bunker, inventory), asserting it lands.
  function place(
    state: { bunker: BunkerState; inventory: BasePartInventory },
    partId: BasePartId,
    col: number,
    row: number,
    depth: number,
    slot?: BunkerSlot,
  ): { bunker: BunkerState; inventory: BasePartInventory } {
    const result = placeBasePart(
      state.bunker,
      state.inventory,
      partId,
      col,
      row,
      depth,
      slot,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`place failed: ${result.reason}`);
    return { bunker: result.bunker, inventory: result.inventory };
  }

  it("holds up to one part per slot in a single cell", () => {
    // The single cell is the volume's top row so its roof slot is legal.
    const c = { col: 4, row: proposedBunkerFootprint(4, 5).row, depth: 0 };
    let state = {
      bunker: oneCellBunker(c.col, c.row, c.depth),
      inventory: inventory(),
    };
    state = place(state, "wall-panel", c.col, c.row, c.depth, "wall-px");
    state = place(state, "wall-panel", c.col, c.row, c.depth, "wall-nx");
    state = place(state, "wall-panel", c.col, c.row, c.depth, "wall-pz");
    state = place(state, "wall-panel", c.col, c.row, c.depth, "wall-nz");
    state = place(state, "floor-panel", c.col, c.row, c.depth, "floor");
    state = place(state, "roof-panel", c.col, c.row, c.depth, "roof");
    state = place(state, "basic-turret", c.col, c.row, c.depth, "mount");
    expect(state.bunker.parts).toHaveLength(7);
    // A second part in a taken slot is rejected.
    expect(
      placeBasePart(
        state.bunker,
        state.inventory,
        "wall-panel",
        c.col,
        c.row,
        c.depth,
        "wall-px",
      ),
    ).toEqual({ ok: false, reason: "occupied" });
  });

  it("rejects the same divider built from the neighboring cell", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    const placed = placeBasePart(
      bunker,
      inventory(),
      "wall-panel",
      c.col,
      c.row,
      0,
      "wall-px",
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    // The -x face of the cell to the right is the same physical slab.
    expect(
      placeBasePart(
        placed.bunker,
        placed.inventory,
        "wall-panel",
        c.col + 1,
        c.row,
        0,
        "wall-nx",
      ),
    ).toEqual({ ok: false, reason: "occupied" });
  });

  it("rejects a part in a slot it cannot use", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "floor-panel",
        c.col,
        c.row,
        0,
        "wall-px",
      ),
    ).toEqual({ ok: false, reason: "slot" });
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "wall-panel",
        c.col,
        c.row,
        0,
        "floor",
      ),
    ).toEqual({ ok: false, reason: "slot" });
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "basic-turret",
        c.col,
        c.row,
        0,
        "wall-px",
      ),
    ).toEqual({ ok: false, reason: "slot" });
  });

  it("mounts a staircase and remembers the way it faces (F-117)", () => {
    // The catalog and slot rule ship before the climb does.
    expect(BASE_PART_CATALOG["stair-panel"]).toBeDefined();
    expect(allowedBunkerSlots("stair-panel")).toEqual(["mount"]);

    const c = { col: 4, row: proposedBunkerFootprint(4, 5).row, depth: 0 };
    let state = {
      bunker: oneCellBunker(c.col, c.row, c.depth),
      inventory: { ...inventory(), "stair-panel": 1 },
    };
    // A floor slab gives the mount its footing.
    state = place(state, "floor-panel", c.col, c.row, c.depth, "floor");

    const placed = placeBasePart(
      state.bunker,
      state.inventory,
      "stair-panel",
      c.col,
      c.row,
      c.depth,
      "mount",
      2,
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.bunker.parts.at(-1)).toMatchObject({
      partId: "stair-panel",
      slot: "mount",
      orientation: 2,
    });
    // A staircase is a mount part; a wall slot rejects it.
    expect(
      placeBasePart(
        state.bunker,
        state.inventory,
        "stair-panel",
        c.col,
        c.row,
        c.depth,
        "wall-px",
      ),
    ).toEqual({ ok: false, reason: "slot" });
  });

  it("treats a legacy full-cell part as filling every slot in its cell", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    const legacy = placeBasePart(
      bunker,
      inventory(),
      "wall-panel",
      c.col,
      c.row,
      0,
    );
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(legacy.bunker.parts[0].slot).toBeUndefined();
    // A slot part cannot share a cell a legacy whole-cell part fills.
    expect(
      placeBasePart(
        legacy.bunker,
        legacy.inventory,
        "floor-panel",
        c.col,
        c.row,
        0,
        "floor",
      ),
    ).toEqual({ ok: false, reason: "occupied" });
    // And a legacy placement cannot share a cell that already has a slot.
    const slotted = placeBasePart(
      bunker,
      inventory(),
      "wall-panel",
      c.col,
      c.row,
      0,
      "wall-px",
    );
    expect(slotted.ok).toBe(true);
    if (!slotted.ok) return;
    expect(
      placeBasePart(
        slotted.bunker,
        slotted.inventory,
        "wall-panel",
        c.col,
        c.row,
        0,
      ),
    ).toEqual({ ok: false, reason: "occupied" });
  });

  it("keeps a roof only at the volume's top row", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    const topRow = bunker.footprint.row;
    const bottomRow = topRow + bunker.footprint.height - 1;
    // A roof below the top row is rejected even with open space above it.
    expect(
      placeBasePart(bunker, inventory(), "roof-panel", c.col, c.row, 0, "roof"),
    ).toEqual({ ok: false, reason: "roof-top" });
    // Only the top row of the volume may carry an actual roof.
    expect(
      placeBasePart(bunker, inventory(), "roof-panel", c.col, topRow, 0, "roof")
        .ok,
    ).toBe(true);
    // The bottom row is rejected too: a roof is the ceiling, never a mid-
    // column cap (that is a second-story floor's job).
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "roof-panel",
        c.col,
        bottomRow,
        0,
        "roof",
      ),
    ).toEqual({ ok: false, reason: "roof-top" });
  });

  it("requires two supporting walls under an overhead floor", () => {
    const bunker = allDugBunker(4, 5);
    const bottomRow = bunker.footprint.row + bunker.footprint.height - 1;
    const overheadRow = bottomRow - 1;
    // A floor on the bottom row rests on the ground: no walls needed.
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "floor-panel",
        4,
        bottomRow,
        0,
        "floor",
      ).ok,
    ).toBe(true);
    // One row up is overhead (open cell below) and unsupported.
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "floor-panel",
        4,
        overheadRow,
        0,
        "floor",
      ),
    ).toEqual({ ok: false, reason: "unsupported" });
    // Two walls in the cell below let the overhead floor stand.
    let state = { bunker, inventory: inventory() };
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-px");
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-pz");
    expect(
      placeBasePart(
        state.bunker,
        state.inventory,
        "floor-panel",
        4,
        overheadRow,
        0,
        "floor",
      ).ok,
    ).toBe(true);
  });

  it("drops an overhead floor when its support is pried away", () => {
    const bunker = allDugBunker(4, 5);
    const bottomRow = bunker.footprint.row + bunker.footprint.height - 1;
    const overheadRow = bottomRow - 1;
    let state = { bunker, inventory: inventory() };
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-px");
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-pz");
    state = place(state, "floor-panel", 4, overheadRow, 0, "floor");
    expect(state.bunker.parts).toHaveLength(3);
    const wallsBefore = state.inventory["wall-panel"];
    // Pry one supporting wall: the overhead floor loses support and falls.
    const pried = removeBasePart(
      state.bunker,
      state.inventory,
      4,
      bottomRow,
      0,
      "wall-px",
    );
    expect(pried.ok).toBe(true);
    if (!pried.ok) return;
    // The pried wall refunds; the dropped floor is destroyed, not refunded.
    expect(pried.inventory["wall-panel"]).toBe(wallsBefore + 1);
    expect(pried.fallen?.map((part) => part.slot)).toEqual(["floor"]);
    expect(pried.bunker.parts).toHaveLength(1);
    expect(pried.bunker.parts[0].slot).toBe("wall-pz");
  });

  it("removes only the addressed slot", () => {
    const c = { col: 4, row: 3, depth: 0 };
    let state = {
      bunker: oneCellBunker(c.col, c.row, c.depth),
      inventory: inventory(),
    };
    state = place(state, "wall-panel", c.col, c.row, c.depth, "wall-px");
    state = place(state, "floor-panel", c.col, c.row, c.depth, "floor");
    // A different slot in the same cell does not match.
    expect(
      removeBasePart(
        state.bunker,
        state.inventory,
        c.col,
        c.row,
        c.depth,
        "wall-pz",
      ),
    ).toEqual({ ok: false, reason: "missing" });
    const removed = removeBasePart(
      state.bunker,
      state.inventory,
      c.col,
      c.row,
      c.depth,
      "wall-px",
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    // The grounded floor stands (it needs no walls), so nothing cascades.
    expect(removed.bunker.parts).toHaveLength(1);
    expect(removed.bunker.parts[0].slot).toBe("floor");
  });

  it("leaves slotted parts to the slot mover, not the cell mover", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    const placed = placeBasePart(
      bunker,
      inventory(),
      "wall-panel",
      c.col,
      c.row,
      0,
      "wall-px",
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    // The whole-cell mover never sees a slotted part.
    expect(
      moveBasePart(placed.bunker, c.col, c.row, c.col + 1, c.row, 0, 0),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("does not pry a divider through an out-of-footprint origin", () => {
    const bunker = allDugBunker(4, 5);
    const fp = bunker.footprint;
    const rightCol = fp.col + fp.width - 1;
    const row = centerCell(bunker).row;
    const placed = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      rightCol,
      row,
      0,
      "wall-px",
    );
    // wall-nx one column past the edge would canonicalize onto the placed
    // +x slab, but its origin cell is outside the bunker, so it must miss.
    expect(
      removeBasePart(
        placed.bunker,
        placed.inventory,
        rightCol + 1,
        row,
        0,
        "wall-nx",
      ),
    ).toEqual({ ok: false, reason: "missing" });
    // The in-bounds canonical alias (its own -x face) still pries it.
    const pried = removeBasePart(
      placed.bunker,
      placed.inventory,
      rightCol,
      row,
      0,
      "wall-px",
    );
    expect(pried.ok).toBe(true);
    if (!pried.ok) return;
    expect(pried.bunker.parts).toHaveLength(0);
  });

  it("does not pry a divider from a solid-rock origin (depth alias)", () => {
    // Dig one cell but not the cell in front of it, then place a wall on the
    // +z face of the open cell.
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const col = 4;
    const row = centerCell(base).row;
    const bunker: BunkerState = { ...base, dug: [{ col, row, depth: 0 }] };
    const placed = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      col,
      row,
      0,
      "wall-pz",
    );
    // wall-nz from the solid cell in front (depth 1) folds onto that same +z
    // slab, but depth 1 is unexcavated rock, so the pry must miss.
    expect(isOpenBunkerCell(placed.bunker, col, row, 1)).toBe(false);
    expect(
      removeBasePart(placed.bunker, placed.inventory, col, row, 1, "wall-nz"),
    ).toEqual({ ok: false, reason: "missing" });
    // From the open origin (depth 0, +z face) the same slab still pries.
    const pried = removeBasePart(
      placed.bunker,
      placed.inventory,
      col,
      row,
      0,
      "wall-pz",
    );
    expect(pried.ok).toBe(true);
    if (!pried.ok) return;
    expect(pried.bunker.parts).toHaveLength(0);
  });

  it("does not pry a divider from an out-of-footprint depth origin", () => {
    const bunker = allDugBunker(4, 5);
    const col = 4;
    const row = centerCell(bunker).row;
    const lastDepth = BUNKER_CLAIM_DEPTH - 1;
    // A wall on the +z face of the deepest row.
    const placed = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      col,
      row,
      lastDepth,
      "wall-pz",
    );
    // wall-nz one step past the back wall folds onto that +z slab (depth
    // BUNKER_CLAIM_DEPTH is outside the volume), so the pry must miss.
    expect(isOpenBunkerCell(placed.bunker, col, row, BUNKER_CLAIM_DEPTH)).toBe(
      false,
    );
    expect(
      removeBasePart(
        placed.bunker,
        placed.inventory,
        col,
        row,
        BUNKER_CLAIM_DEPTH,
        "wall-nz",
      ),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("does not remove a slotted part through a bare-cell request", () => {
    const c = { col: 4, row: 3, depth: 0 };
    let state = {
      bunker: oneCellBunker(c.col, c.row, c.depth),
      inventory: inventory(),
    };
    state = place(state, "wall-panel", c.col, c.row, c.depth, "wall-px");
    state = place(state, "floor-panel", c.col, c.row, c.depth, "floor");
    // A slotless removal in a cell that holds only slotted parts matches
    // nothing, so both dividers stay put.
    expect(
      removeBasePart(state.bunker, state.inventory, c.col, c.row, c.depth),
    ).toEqual({ ok: false, reason: "missing" });
    expect(state.bunker.parts).toHaveLength(2);
  });

  it("blocks a divider that a legacy cell fills from either side", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    // A whole-cell part on the far side of the boundary blocks the shared
    // divider addressed from the near cell (canonical +x face).
    const farLegacy = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      c.col + 1,
      c.row,
      0,
    );
    expect(
      placeBasePart(
        farLegacy.bunker,
        farLegacy.inventory,
        "wall-panel",
        c.col,
        c.row,
        0,
        "wall-px",
      ),
    ).toEqual({ ok: false, reason: "occupied" });
    // And a whole-cell part on the near side blocks the same divider named
    // from the far cell (wall-nx folds onto the near +x face).
    const nearLegacy = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      c.col,
      c.row,
      0,
    );
    expect(
      placeBasePart(
        nearLegacy.bunker,
        nearLegacy.inventory,
        "wall-panel",
        c.col + 1,
        c.row,
        0,
        "wall-nx",
      ),
    ).toEqual({ ok: false, reason: "occupied" });
  });

  it("blocks a legacy cell landing on a pre-existing thin wall (both axes)", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    // Wall first, then a whole-cell legacy part in the far +x cell: the wall
    // already divides that cell's -x face, so the legacy placement is blocked.
    const wallX = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      c.col,
      c.row,
      0,
      "wall-px",
    );
    expect(
      placeBasePart(
        wallX.bunker,
        wallX.inventory,
        "wall-panel",
        c.col + 1,
        c.row,
        0,
      ),
    ).toEqual({ ok: false, reason: "occupied" });
    // Same in depth: a +z wall blocks a legacy cell in the far +z cell.
    const wallZ = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      c.col,
      c.row,
      0,
      "wall-pz",
    );
    expect(
      placeBasePart(
        wallZ.bunker,
        wallZ.inventory,
        "wall-panel",
        c.col,
        c.row,
        1,
      ),
    ).toEqual({ ok: false, reason: "occupied" });
  });

  it("blocks moving a legacy part onto a thin wall boundary", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    // A wall on the boundary between c and c+1, plus a legacy part parked two
    // cells over so the mover has something to move.
    const walled = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      c.col,
      c.row,
      0,
      "wall-px",
    );
    const parked = placeBasePart(
      walled.bunker,
      walled.inventory,
      "floor-panel",
      c.col + 2,
      c.row,
      0,
    );
    expect(parked.ok).toBe(true);
    if (!parked.ok) return;
    // Moving it onto the far +x cell (whose -x face the wall divides) fails.
    expect(
      moveBasePart(parked.bunker, c.col + 2, c.row, c.col + 1, c.row, 0, 0),
    ).toEqual({ ok: false, reason: "occupied" });
  });

  it("blocks a legacy cell and a legacy move on a thin wall in depth", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    // Legacy-first in depth: a whole-cell part at the far +z cell, then a
    // wall on the shared +z boundary from the near cell, is blocked.
    const farLegacy = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      c.col,
      c.row,
      1,
    );
    expect(
      placeBasePart(
        farLegacy.bunker,
        farLegacy.inventory,
        "wall-panel",
        c.col,
        c.row,
        0,
        "wall-pz",
      ),
    ).toEqual({ ok: false, reason: "occupied" });
    // Move-target in depth: a wall on the depth 0/1 boundary blocks moving a
    // legacy part into the far +z cell.
    const walled = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      c.col,
      c.row,
      0,
      "wall-pz",
    );
    const parked = placeBasePart(
      walled.bunker,
      walled.inventory,
      "floor-panel",
      c.col,
      c.row,
      2,
    );
    expect(parked.ok).toBe(true);
    if (!parked.ok) return;
    expect(
      moveBasePart(parked.bunker, c.col, c.row, c.col, c.row, 2, 1),
    ).toEqual({ ok: false, reason: "occupied" });
  });

  it("does not count a chewed-out wall as floor support", () => {
    const bunker = allDugBunker(4, 5);
    const bottomRow = bunker.footprint.row + bunker.footprint.height - 1;
    const overheadRow = bottomRow - 1;
    // Two walls under the cell, but both worn to rubble by raid damage.
    let state = { bunker, inventory: inventory() };
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-px");
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-pz");
    const worn: BunkerState = {
      ...state.bunker,
      parts: state.bunker.parts.map((part) => ({ ...part, durability: 0 })),
    };
    // Rubble holds nothing up, so the overhead floor cannot be placed.
    expect(
      placeBasePart(
        worn,
        state.inventory,
        "floor-panel",
        4,
        overheadRow,
        0,
        "floor",
      ),
    ).toEqual({ ok: false, reason: "unsupported" });
  });

  it("ignores a rubble wall when a pry cascade recounts support", () => {
    // A pry-triggered cascade must not count a zero-durability wall toward the
    // two-wall threshold. (This is the settlement pass; wiring the cascade
    // into live-raid wear resolution itself is deferred to the raid slice.)
    const bunker = allDugBunker(4, 5);
    const bottomRow = bunker.footprint.row + bunker.footprint.height - 1;
    const overheadRow = bottomRow - 1;
    // Three supporting walls, one already chewed to zero: two live supports
    // still hold the overhead floor.
    let state = { bunker, inventory: inventory() };
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-px");
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-pz");
    state = place(state, "wall-panel", 4, bottomRow, 0, "wall-nz");
    state = place(state, "floor-panel", 4, overheadRow, 0, "floor");
    const worn: BunkerState = {
      ...state.bunker,
      parts: state.bunker.parts.map((part) =>
        part.slot === "wall-nz" ? { ...part, durability: 0 } : part,
      ),
    };
    // Prying one live wall leaves a single live support plus the rubble
    // wall, which no longer counts, so the floor falls.
    const pried = removeBasePart(
      worn,
      state.inventory,
      4,
      bottomRow,
      0,
      "wall-px",
    );
    expect(pried.ok).toBe(true);
    if (!pried.ok) return;
    expect(pried.fallen?.map((part) => part.slot)).toEqual(["floor"]);
    expect(pried.bunker.parts.map((part) => part.slot).sort()).toEqual([
      "wall-nz",
      "wall-pz",
    ]);
  });

  it("rejects a roof on an interior cell that tops out against rock", () => {
    const c = { col: 4, row: 3, depth: 0 };
    const bunker = oneCellBunker(c.col, c.row, c.depth);
    // The cell above is undug rock inside the footprint, not the boundary,
    // yet a roof is still rejected: a roof is the volume's ceiling, not a
    // mid-column cap (Q-025, dev direction: only the very top gets a roof).
    expect(
      containsBunkerCell3D(bunker.footprint, c.col, c.row - 1, c.depth),
    ).toBe(true);
    expect(isOpenBunkerCell(bunker, c.col, c.row - 1, c.depth)).toBe(false);
    expect(c.row).not.toBe(bunker.footprint.row);
    expect(
      placeBasePart(
        bunker,
        inventory(),
        "roof-panel",
        c.col,
        c.row,
        c.depth,
        "roof",
      ),
    ).toEqual({ ok: false, reason: "roof-top" });
  });

  it("caps a lower room with an overhead floor as its ceiling", () => {
    // A second-story floor is what caps a mid-column room: its bottom plane
    // is the ceiling of the room below. Dig two stacked cells, wall the lower
    // one so the upper floor is supported, and place the floor in the UPPER
    // cell (row - 1), whose underside ceilings the lower room.
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const col = 4;
    const lowerRow = 3;
    const upperRow = lowerRow - 1;
    const bunker: BunkerState = {
      ...base,
      dug: [
        { col, row: lowerRow, depth: 0 },
        { col, row: upperRow, depth: 0 },
      ],
    };
    let state = { bunker, inventory: inventory() };
    // Two walls in the lower cell hold the overhead floor above it up.
    state = place(state, "wall-panel", col, lowerRow, 0, "wall-px");
    state = place(state, "wall-panel", col, lowerRow, 0, "wall-pz");
    // The floor sits in the upper cell; its own cell is open and its below-
    // cell (the lower room) is open too, so it is an overhead floor that the
    // two walls support. That underside is the lower room's ceiling.
    const capped = placeBasePart(
      state.bunker,
      state.inventory,
      "floor-panel",
      col,
      upperRow,
      0,
      "floor",
    );
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(
      capped.bunker.parts.some(
        (part) =>
          part.slot === "floor" && part.row === upperRow && part.col === col,
      ),
    ).toBe(true);
  });

  it("drops a grounded floor when its ground is dug out from the side", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const fp = base.footprint;
    const col = fp.col + Math.floor(fp.width / 2);
    const bottomRow = fp.row + fp.height - 1;
    const row = bottomRow - 1;
    // The floor's cell and a lateral neighbor of the cell below it are dug.
    // The cell below is still rock, so the floor is grounded when placed.
    const bunker: BunkerState = {
      ...base,
      dug: [
        { col, row, depth: 0 },
        { col: col - 1, row: bottomRow, depth: 0 },
      ],
    };
    const placed = place(
      { bunker, inventory: inventory() },
      "floor-panel",
      col,
      row,
      0,
      "floor",
    );
    // The floor above seals a straight-down dig into the ground, but the open
    // lateral neighbor's face is clear, so the dig lands through it. Digging
    // that ground out pulls the floor's support away and the now overhead,
    // wall-less floor cascades (F-117).
    const dug = excavateBunkerCell(placed.bunker, col, bottomRow, 0);
    expect(dug.ok).toBe(true);
    if (!dug.ok) return;
    expect(dug.fallen?.map((part) => part.slot)).toEqual(["floor"]);
    expect(dug.bunker.parts).toHaveLength(0);
  });

  it("drops a mount when the overhead floor it stood on falls (F-117)", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const col = 4;
    const lowerRow = 3;
    const upperRow = lowerRow - 1;
    const bunker: BunkerState = {
      ...base,
      dug: [
        { col, row: lowerRow, depth: 0 },
        { col, row: upperRow, depth: 0 },
      ],
    };
    let state = { bunker, inventory: inventory() };
    // Two walls in the lower cell hold up the overhead floor above, and a
    // turret stands on that floor.
    state = place(state, "wall-panel", col, lowerRow, 0, "wall-px");
    state = place(state, "wall-panel", col, lowerRow, 0, "wall-pz");
    state = place(state, "floor-panel", col, upperRow, 0, "floor");
    state = place(state, "basic-turret", col, upperRow, 0, "mount");
    // Prying a supporting wall drops the floor below the minimum, and the
    // mount standing on it falls with it in the same settlement pass.
    const pried = removeBasePart(
      state.bunker,
      state.inventory,
      col,
      lowerRow,
      0,
      "wall-px",
    );
    expect(pried.ok).toBe(true);
    if (!pried.ok) return;
    expect(pried.fallen?.map((part) => part.slot).sort()).toEqual([
      "floor",
      "mount",
    ]);
    // Only the second live wall remains; the floor and turret are destroyed.
    expect(pried.bunker.parts.map((part) => part.slot)).toEqual(["wall-pz"]);
  });

  it("keeps a grounded mount standing when floors settle (F-117)", () => {
    // A turret in a grounded cell rests on solid rock, so a settlement pass
    // that finds no unsupported floor leaves it standing.
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const fp = base.footprint;
    const col = fp.col + Math.floor(fp.width / 2);
    const bottomRow = fp.row + fp.height - 1;
    const bunker: BunkerState = {
      ...base,
      dug: [{ col, row: bottomRow, depth: 0 }],
    };
    const withMount = place(
      { bunker, inventory: inventory() },
      "basic-turret",
      col,
      bottomRow,
      0,
      "mount",
    );
    const settled = cascadeUnsupportedFloors(withMount.bunker);
    expect(settled.fallen).toHaveLength(0);
    expect(settled.bunker.parts.map((part) => part.slot)).toEqual(["mount"]);
  });

  it("cannot dig through a thin wall on the shared face (F-117)", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const col = 4;
    const row = 3;
    // The target (right) cell's only open neighbor is the left cell.
    const bunker: BunkerState = {
      ...base,
      dug: [{ col: col - 1, row, depth: 0 }],
    };
    // A wall on the shared boundary (the left cell's wall-px, which is the
    // target's canonical wall-nx).
    const walled = place(
      { bunker, inventory: inventory() },
      "wall-panel",
      col - 1,
      row,
      0,
      "wall-px",
    );
    expect(excavateBunkerCell(walled.bunker, col, row, 0)).toEqual({
      ok: false,
      reason: "obstructed",
    });
    // Without the divider the same dig succeeds.
    expect(excavateBunkerCell(bunker, col, row, 0).ok).toBe(true);
  });

  it("cannot dig down through a floor slab on the shared face (F-117)", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const col = 4;
    const upperRow = 2;
    const targetRow = upperRow + 1;
    // Only the upper cell is open; the target below it is rock.
    const bunker: BunkerState = {
      ...base,
      dug: [{ col, row: upperRow, depth: 0 }],
    };
    // A grounded floor in the upper cell sits on the plane it shares with the
    // target below it, sealing a downward dig.
    const floored = place(
      { bunker, inventory: inventory() },
      "floor-panel",
      col,
      upperRow,
      0,
      "floor",
    );
    expect(excavateBunkerCell(floored.bunker, col, targetRow, 0)).toEqual({
      ok: false,
      reason: "obstructed",
    });
    expect(excavateBunkerCell(bunker, col, targetRow, 0).ok).toBe(true);
  });

  it("distinguishes an obstructed face from an isolated cell (F-117)", () => {
    const base = createBunker(proposedBunkerFootprint(4, 5));
    const col = 4;
    const row = 3;
    // No open neighbor at all: physically isolated.
    expect(excavateBunkerCell({ ...base, dug: [] }, col, row, 0)).toEqual({
      ok: false,
      reason: "unreachable",
    });
    // An open neighbor with a clear shared face: reachable.
    expect(
      excavateBunkerCell(
        { ...base, dug: [{ col: col - 1, row, depth: 0 }] },
        col,
        row,
        0,
      ).ok,
    ).toBe(true);
  });
});
