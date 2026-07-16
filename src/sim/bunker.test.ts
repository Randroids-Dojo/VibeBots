import { describe, expect, it } from "vitest";
import {
  allowedBunkerSlots,
  applyBunkerRepairs,
  applyBunkerReset,
  BASE_PART_CATALOG,
  type BasePartId,
  type BasePartInventory,
  BUNKER_CLAIM_DEPTH,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
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
  clankerKindFor,
  clankerXpFor,
  containsBunkerCell3D,
  createBunker,
  creditBunkerDig,
  DEFAULT_BUNKER_SKIN,
  excavateBunkerCell,
  isBunkerSkinId,
  isBunkerWallSlot,
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

  // A bunker with exactly one open cell: that cell is both grounded
  // (nothing open below) and a room top (nothing open above), so a floor,
  // a roof, four walls, and a mount can all coexist in it.
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
    const c = { col: 4, row: 3, depth: 0 };
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

  it("keeps a roof only at the top of its room", () => {
    const bunker = allDugBunker(4, 5);
    const c = centerCell(bunker);
    // The cell above the center is open, so a roof there is not a top.
    expect(
      placeBasePart(bunker, inventory(), "roof-panel", c.col, c.row, 0, "roof"),
    ).toEqual({ ok: false, reason: "roof-top" });
    // The top footprint row has nothing open above it.
    const topRow = bunker.footprint.row;
    expect(
      placeBasePart(bunker, inventory(), "roof-panel", c.col, topRow, 0, "roof")
        .ok,
    ).toBe(true);
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
});
