import { bunkerCellOreYield, bunkerSpawnPocketCells } from "./bunker-blocks";
import type { MineState } from "./mine/cells";
import { fillHold } from "./mine/inventory";
import type { OreId } from "./mine/ores";

export const BUNKER_CLAIM_WIDTH = 7;
export const BUNKER_CLAIM_HEIGHT = 5;
/** Cells of buildable depth behind the tunnel plane. Depth 0 is the plane
 * the 2D mine view shows; deeper cells extend into the claim rock. */
export const BUNKER_CLAIM_DEPTH = 5;
export const BUNKER_RAID_DURATION_SECONDS = 180;
export const BUNKER_RAID_COOLDOWN_HOURS = 4;
export const DEFENSE_XP_PER_LEVEL = 100;
export const PLAYER_LEVEL_CAP = 100;
export const LEVEL_ONE_BEACON_LIMIT = 2;
export const LEVEL_TWO_BEACON_LIMIT = 3;
export const BASIC_TURRET_AMMO = 3;
export const FLOOR_SPIKES_DURABILITY = 3;
export const FLOOR_SPIKES_DAMAGE = 16;
export const BASIC_TURRET_MIN_LEVEL = 2;
export const BASIC_TURRET_OWNED_LIMIT = 1;
export const FLOOR_SPIKES_LEVEL_ONE_LIMIT = 4;
export const FLOOR_SPIKES_LEVEL_TWO_LIMIT = 6;
export const CLANKER_BASE_BITE_DAMAGE = 24;
export const CLANKER_BITE_DAMAGE_PER_TIER = 8;
export const CLANKER_SELF_DESTRUCT_XP = 25;
export const CLANKER_BREACHER_XP = 40;
export const CLANKER_TANK_XP = 50;
/** Bite multiplier a breacher applies to blocker parts. */
export const CLANKER_BREACHER_BITE_FACTOR = 2;
/** Turret shots needed to stop a tank. */
export const CLANKER_TANK_TURRET_SHOTS = 2;

export const BASE_PART_IDS = [
  "wall-panel",
  "floor-panel",
  "roof-panel",
  "door-panel",
  "basic-turret",
  "floor-spikes",
] as const;
export type BasePartId = (typeof BASE_PART_IDS)[number];

export interface BasePartDef {
  id: BasePartId;
  name: string;
  blurb: string;
  price: number;
  durability: number;
  blocksClankers: boolean;
  ammo?: number;
  stepDamage?: number;
}

export const BASE_PART_CATALOG: Record<BasePartId, BasePartDef> = {
  "wall-panel": {
    id: "wall-panel",
    name: "Wall",
    blurb: "starter side wall for small bunker rooms",
    price: 6,
    durability: 90,
    blocksClankers: true,
  },
  "floor-panel": {
    id: "floor-panel",
    name: "Floor",
    blurb: "walkable room floor plate",
    price: 5,
    durability: 70,
    blocksClankers: true,
  },
  "roof-panel": {
    id: "roof-panel",
    name: "Roof",
    blurb: "overhead room cap",
    price: 5,
    durability: 70,
    blocksClankers: true,
  },
  "door-panel": {
    id: "door-panel",
    name: "Door",
    blurb: "basic entry blocker",
    price: 10,
    durability: 60,
    blocksClankers: true,
  },
  "basic-turret": {
    id: "basic-turret",
    name: "Basic Turret",
    blurb: "autofires at Clankers",
    price: 160,
    durability: 5,
    blocksClankers: false,
    ammo: BASIC_TURRET_AMMO,
  },
  "floor-spikes": {
    id: "floor-spikes",
    name: "Floor Spikes",
    blurb: "damages Clankers that step over it",
    price: 16,
    durability: FLOOR_SPIKES_DURABILITY,
    blocksClankers: false,
    stepDamage: FLOOR_SPIKES_DAMAGE,
  },
};

export type BasePartInventory = Record<BasePartId, number>;

export const EMPTY_BASE_PART_INVENTORY: BasePartInventory = {
  "wall-panel": 0,
  "floor-panel": 0,
  "roof-panel": 0,
  "door-panel": 0,
  "basic-turret": 0,
  "floor-spikes": 0,
};

/**
 * Enough to fully enclose the player cell on day one: a sealed 3x3
 * room around the spawn takes 3 floors, 3 roofs, 1 wall, and the door,
 * which leaves spare walls for layering or a roomier shape. Every
 * granted part blocks Clankers, so a sealed starter room genuinely
 * survives a raid (see "the starter kit seals the player cell").
 */
export const STARTER_BASE_PART_INVENTORY: BasePartInventory = {
  "wall-panel": 6,
  "floor-panel": 4,
  "roof-panel": 4,
  "door-panel": 1,
  "basic-turret": 0,
  "floor-spikes": 0,
};

export interface BunkerFootprint {
  col: number;
  row: number;
  width: number;
  height: number;
}

/**
 * Sub-cell slots a thin part occupies (F-117). One cell holds at most one
 * part per slot: four wall faces on the horizontal boundaries, a floor
 * slab, a roof slab, and one interior mount (turret, spikes, or stair).
 * Wall faces sit on the boundary *between* two cells; `canonicalWallSlot`
 * pins each divider to a single (cell, face) so it cannot be placed from
 * both sides. Axes match the fp grid: `px`/`nx` face col+1/col-1, `pz`/`nz`
 * face depth+1/depth-1; floor is the cell's bottom (toward the cell below,
 * row+1), roof its top (toward the cell above, row-1).
 */
export const BUNKER_SLOTS = [
  "floor",
  "roof",
  "wall-px",
  "wall-nx",
  "wall-pz",
  "wall-nz",
  "mount",
] as const;
export type BunkerSlot = (typeof BUNKER_SLOTS)[number];

export function isBunkerWallSlot(slot: BunkerSlot): boolean {
  return (
    slot === "wall-px" ||
    slot === "wall-nx" ||
    slot === "wall-pz" ||
    slot === "wall-nz"
  );
}

const WALL_SLOTS: readonly BunkerSlot[] = [
  "wall-px",
  "wall-nx",
  "wall-pz",
  "wall-nz",
];

/**
 * Which slots a part may occupy under the thin model (F-117). Walls and
 * doors are boundary dividers (any of the four wall faces); floor and roof
 * are the horizontal slabs; turrets, spikes, and future stairs stand in
 * the cell interior (the single mount slot).
 */
export function allowedBunkerSlots(partId: BasePartId): readonly BunkerSlot[] {
  switch (partId) {
    case "wall-panel":
    case "door-panel":
      return WALL_SLOTS;
    case "floor-panel":
      return ["floor"];
    case "roof-panel":
      return ["roof"];
    case "basic-turret":
    case "floor-spikes":
      return ["mount"];
  }
}

export interface PlacedBasePart {
  partId: BasePartId;
  col: number;
  row: number;
  /** 0..BUNKER_CLAIM_DEPTH-1; legacy rows normalize to 0 (the tunnel plane). */
  depth: number;
  durability: number;
  /**
   * Sub-cell slot this thin part occupies (F-117). Absent on legacy
   * full-cell parts placed before the thin model. Wall slots are stored in
   * canonical form (see `canonicalWallSlot`). The slice that lets the UI
   * place thin parts writes this field and enforces the slot invariants
   * (occupancy, support, roof-top-only); this foundation slice only defines
   * the vocabulary. Stair orientation lands with the stair part.
   */
  slot?: BunkerSlot;
}

/** Cosmetic bunker skins (F-087, REQ-034/REQ-038): palette variants for
 * the placed-part materials. Purely visual; no stats, no raid effects. */
export type BunkerSkinId = "steelworks" | "gilded" | "verdant";

export interface BunkerSkinDef {
  id: BunkerSkinId;
  name: string;
  blurb: string;
  /** Vibes to own; the default skin is free and always owned. */
  price: number;
}

export const BUNKER_SKIN_CATALOG: Record<BunkerSkinId, BunkerSkinDef> = {
  steelworks: {
    id: "steelworks",
    name: "Steelworks",
    blurb: "the standard riveted gunmetal",
    price: 0,
  },
  gilded: {
    id: "gilded",
    name: "Gilded",
    blurb: "brass plate and warm lamplight",
    price: 120,
  },
  verdant: {
    id: "verdant",
    name: "Verdant",
    blurb: "patinated copper and moss glass",
    price: 80,
  },
};

export const DEFAULT_BUNKER_SKIN: BunkerSkinId = "steelworks";

export function isBunkerSkinId(value: unknown): value is BunkerSkinId {
  return typeof value === "string" && Object.hasOwn(BUNKER_SKIN_CATALOG, value);
}

/** One excavated cell (any depth 0..4, F-116). Order is dig order; the
 * bank replays it to prove every dig chained from an already-open face.
 * The pre-mined spawn pocket is seeded here at claim. */
export interface DugBunkerCell {
  col: number;
  row: number;
  depth: number;
}

/** Overflow ore that did not fit the bag when a bunker block was mined,
 * spilled at its 3D cell as persistent collectible loot (F-116). Walking
 * over the cell in first person collects it. Deterministic and preserved
 * across reset so it never regrows (F-120). */
export interface BunkerLoot {
  col: number;
  row: number;
  depth: number;
  ores: Partial<Record<OreId, number>>;
}

export interface BunkerState {
  footprint: BunkerFootprint;
  parts: PlacedBasePart[];
  /** Excavated cells in dig order (now including the depth-0 plane and
   * the pre-mined spawn pocket); legacy rows normalize to []. */
  dug: DugBunkerCell[];
  /** Stable seed for this bunker's mineable blocks (F-116), mixed from
   * the mine seed and footprint at claim so client preview and server
   * credit agree. Legacy bunkers without one hard-reset (Q-022). */
  blockSeed?: number;
  /** Uncollected overflow ore from digging, by 3D cell (F-116); legacy
   * rows normalize to []. Preserved across reset so it never regrows. */
  loot?: BunkerLoot[];
  /** Selected cosmetic skin; legacy rows normalize to the default. */
  skin?: BunkerSkinId;
  /** Skins this player owns beyond the free default. */
  skinsOwned?: BunkerSkinId[];
}

export interface PendingBunkerBuild {
  claimCol: number;
  claimRow: number;
  claimedAtMoveCount: number;
  bunker: BunkerState;
  inventory: BasePartInventory;
}

export interface PendingBunkerClaimPayload {
  claimCol: number;
  claimRow: number;
  claimedAtMoveCount: number;
  parts: PlacedBasePart[];
  dug: DugBunkerCell[];
}

export type ClankerKind = "standard" | "breacher" | "tank";

/** Deterministic specialist assignment: tier 2 unlocks breachers (every
 * third slot), tier 3 unlocks tanks (every fourth slot, checked first so
 * the mix stays stable as waves grow). */
export function clankerKindFor(index: number, tier: number): ClankerKind {
  if (tier >= 3 && index % 4 === 3) return "tank";
  if (tier >= 2 && index % 3 === 2) return "breacher";
  return "standard";
}

/** Specialists drop more XP: they are harder to stop. */
export function clankerXpFor(kind: ClankerKind): number {
  if (kind === "tank") return CLANKER_TANK_XP;
  if (kind === "breacher") return CLANKER_BREACHER_XP;
  return CLANKER_SELF_DESTRUCT_XP;
}

export interface BunkerRaidRewardReport {
  survived: boolean;
  vibesGained: number;
  xpGained: number;
  defenseXpBefore: number;
  defenseXpAfter: number;
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
  beaconLimitBefore: number;
  beaconLimitAfter: number;
  /** Every stamp first unlocked by this raid's reward pass. */
  newStamps: string[];
}

export interface PlayerLevelProgress {
  level: number;
  currentXp: number;
  cap: number;
  nextLevelXp: number | null;
  progressXp: number;
  neededXp: number;
  beaconLimit: number;
}

/** Hard ceiling on raid difficulty tiers regardless of level. */
export const BUNKER_RAID_TIER_CAP = 5;

/** Highest raid tier a player may start: one tier per player level,
 * capped. Tier scales the wave (4 + 2/tier Clankers), their battery
 * reach, and their bite damage; more Clankers also mean more XP
 * pickups, so reward scales with the count by construction (F-084). */
export function maxBunkerRaidTier(playerLevel: number): number {
  return Math.max(1, Math.min(BUNKER_RAID_TIER_CAP, Math.floor(playerLevel)));
}

/** Repair pricing (F-086): proportional to the damage, half the part's
 * shop price for a full restore, always at least 1 vibe per damaged
 * part. */
export interface BunkerRepairPlan {
  totalCost: number;
  partCount: number;
}

export function bunkerRepairPlan(bunker: BunkerState): BunkerRepairPlan {
  let totalCost = 0;
  let partCount = 0;
  for (const part of bunker.parts) {
    const def = BASE_PART_CATALOG[part.partId];
    const missing = Math.max(0, def.durability - part.durability);
    if (missing <= 0) continue;
    partCount++;
    totalCost += Math.max(
      1,
      Math.ceil((missing / def.durability) * def.price * 0.5),
    );
  }
  return { totalCost, partCount };
}

/** Restore every damaged part to full durability. Pure: affordability is
 * the caller's (server's) concern. */
export function applyBunkerRepairs(bunker: BunkerState): BunkerState {
  return {
    ...bunker,
    parts: bunker.parts.map((part) => ({
      ...part,
      durability: BASE_PART_CATALOG[part.partId].durability,
    })),
  };
}

/**
 * A placed part is damaged when its durability has dropped below the
 * catalog maximum. Damaged parts do not refund on remove or reset, so
 * this predicate is the single source of that rule: removeBasePart,
 * applyBunkerReset, and the first-person pry pre-check all call it,
 * which keeps the client-side deny check from drifting from the sim.
 */
export function isBasePartDamaged(part: PlacedBasePart): boolean {
  return part.durability < BASE_PART_CATALOG[part.partId].durability;
}

/**
 * Reset the bunker to a bare claim (F-093). Refund rule: every placed
 * part still at full catalog durability returns to inventory; damaged
 * parts are lost, matching removeBasePart's "damaged parts do not
 * refund" contract. Placed parts clear, excavated cells stay dug, and
 * the claim itself (footprint, skin, owned skins) is untouched. Pure:
 * raid gating and persistence are the caller's (server's) concern.
 */
export function applyBunkerReset(
  bunker: BunkerState,
  inventory: BasePartInventory,
): { bunker: BunkerState; inventory: BasePartInventory } {
  const refunded = { ...inventory };
  for (const part of bunker.parts) {
    if (isBasePartDamaged(part)) continue;
    refunded[part.partId] = Math.max(0, refunded[part.partId] + 1);
  }
  return {
    bunker: {
      ...bunker,
      parts: [],
      // Keep the excavation and its depletion (F-120): reset clears the
      // built layout, not the dug-out rock, so mined ore never regrows
      // and the spawn pocket stays open and grounded.
    },
    inventory: refunded,
  };
}

export function overallPlayerLevel(trackXp: number, defenseXp: number): number {
  void trackXp;
  return playerLevelProgress(defenseXp).level;
}

export function playerLevelProgress(defenseXp: number): PlayerLevelProgress {
  const currentXp = Math.max(0, Math.floor(defenseXp));
  const uncappedLevel = 1 + Math.floor(currentXp / DEFENSE_XP_PER_LEVEL);
  const level = Math.min(PLAYER_LEVEL_CAP, uncappedLevel);
  const capped = level >= PLAYER_LEVEL_CAP;
  const nextLevelXp = capped ? null : level * DEFENSE_XP_PER_LEVEL;
  return {
    level,
    currentXp,
    cap: PLAYER_LEVEL_CAP,
    nextLevelXp,
    progressXp: capped
      ? DEFENSE_XP_PER_LEVEL
      : currentXp - (level - 1) * DEFENSE_XP_PER_LEVEL,
    neededXp: capped ? 0 : Math.max(0, (nextLevelXp ?? 0) - currentXp),
    beaconLimit: level >= 2 ? LEVEL_TWO_BEACON_LIMIT : LEVEL_ONE_BEACON_LIMIT,
  };
}

export function addBasePartInventory(
  inventory: BasePartInventory,
  partId: BasePartId,
  count: number,
): BasePartInventory {
  return {
    ...inventory,
    [partId]: Math.max(0, inventory[partId] + count),
  };
}

export function basePartMinimumLevel(partId: BasePartId): number {
  return partId === "basic-turret" ? BASIC_TURRET_MIN_LEVEL : 1;
}

export function basePartOwnedLimit(
  partId: BasePartId,
  playerLevel: number,
): number {
  if (partId === "basic-turret") {
    return playerLevel >= BASIC_TURRET_MIN_LEVEL ? BASIC_TURRET_OWNED_LIMIT : 0;
  }
  if (partId === "floor-spikes") {
    return playerLevel >= 2
      ? FLOOR_SPIKES_LEVEL_TWO_LIMIT
      : FLOOR_SPIKES_LEVEL_ONE_LIMIT;
  }
  return Number.POSITIVE_INFINITY;
}

export function basePartOwnedCount(
  partId: BasePartId,
  bunker: BunkerState | null,
  inventory: BasePartInventory,
): number {
  const deployed =
    bunker?.parts.filter((part) => part.partId === partId).length ?? 0;
  return (inventory[partId] ?? 0) + deployed;
}

export function canBuyBasePart(
  partId: BasePartId,
  playerLevel: number,
  bunker: BunkerState | null,
  inventory: BasePartInventory,
  quantity: number,
):
  | { ok: true }
  | {
      ok: false;
      reason: "level" | "limit";
      minLevel?: number;
      limit?: number;
    } {
  const minLevel = basePartMinimumLevel(partId);
  if (playerLevel < minLevel) {
    return { ok: false, reason: "level", minLevel };
  }
  const limit = basePartOwnedLimit(partId, playerLevel);
  if (basePartOwnedCount(partId, bunker, inventory) + quantity > limit) {
    return { ok: false, reason: "limit", limit };
  }
  return { ok: true };
}

export function proposedBunkerFootprint(
  minerCol: number,
  minerRow: number,
): BunkerFootprint {
  return {
    col: minerCol - Math.floor(BUNKER_CLAIM_WIDTH / 2),
    row: minerRow - BUNKER_CLAIM_HEIGHT + 1,
    width: BUNKER_CLAIM_WIDTH,
    height: BUNKER_CLAIM_HEIGHT,
  };
}

export function bunkerCells(footprint: BunkerFootprint): Array<{
  col: number;
  row: number;
}> {
  const cells = [];
  for (let row = footprint.row; row < footprint.row + footprint.height; row++) {
    for (
      let col = footprint.col;
      col < footprint.col + footprint.width;
      col++
    ) {
      cells.push({ col, row });
    }
  }
  return cells;
}

export function containsBunkerCell(
  footprint: BunkerFootprint,
  col: number,
  row: number,
): boolean {
  return (
    col >= footprint.col &&
    col < footprint.col + footprint.width &&
    row >= footprint.row &&
    row < footprint.row + footprint.height
  );
}

export function containsBunkerCell3D(
  footprint: BunkerFootprint,
  col: number,
  row: number,
  depth: number,
): boolean {
  return (
    containsBunkerCell(footprint, col, row) &&
    Number.isInteger(depth) &&
    depth >= 0 &&
    depth < BUNKER_CLAIM_DEPTH
  );
}

/** One sub-cell slot anchored to an absolute cell (F-117). */
export interface BunkerSlotRef {
  col: number;
  row: number;
  depth: number;
  slot: BunkerSlot;
}

/**
 * Canonical (cell, face) for a wall divider (F-117). A wall between two
 * cells is one physical slab; addressing it from either side must resolve
 * to the same slot so it cannot be placed twice. We pin it to the lower
 * coordinate on its axis when that neighbor is in-footprint: a `wall-nx`
 * becomes the `wall-px` of the cell to its left, a `wall-nz` the `wall-pz`
 * of the cell in front of it. An edge wall whose lower neighbor is outside
 * the footprint keeps its own face. Non-wall slots are returned unchanged.
 */
export function canonicalWallSlot(
  footprint: BunkerFootprint,
  col: number,
  row: number,
  depth: number,
  slot: BunkerSlot,
): BunkerSlotRef {
  if (
    slot === "wall-nx" &&
    containsBunkerCell3D(footprint, col - 1, row, depth)
  ) {
    return { col: col - 1, row, depth, slot: "wall-px" };
  }
  if (
    slot === "wall-nz" &&
    containsBunkerCell3D(footprint, col, row, depth - 1)
  ) {
    return { col, row, depth: depth - 1, slot: "wall-pz" };
  }
  return { col, row, depth, slot };
}

/** The slotted part occupying an exact canonical slot, or undefined. A
 * legacy whole-cell part (no slot) never matches a defined slot ref. */
function bunkerPartAtSlot(
  bunker: BunkerState,
  ref: BunkerSlotRef,
): PlacedBasePart | undefined {
  return bunker.parts.find(
    (part) =>
      part.col === ref.col &&
      part.row === ref.row &&
      part.depth === ref.depth &&
      part.slot === ref.slot,
  );
}

/** True when a part already occupies `ref`'s slot (F-117). A legacy
 * full-cell part (no slot) fills its whole cell, so it conflicts with any
 * slot in that cell; a slotted part conflicts only on the same canonical
 * slot. Legacy and slotted parts never coexist in a live bunker (Q-022
 * hard-resets an old layout first), so this only matters defensively. */
function bunkerSlotOccupied(bunker: BunkerState, ref: BunkerSlotRef): boolean {
  return bunker.parts.some((part) => {
    if (
      part.col !== ref.col ||
      part.row !== ref.row ||
      part.depth !== ref.depth
    ) {
      return false;
    }
    return part.slot === undefined || part.slot === ref.slot;
  });
}

/** Minimum walls an overhead floor needs beneath it to stand (F-117). */
export const BUNKER_OVERHEAD_FLOOR_MIN_WALLS = 2;

/** A floor slab rests on solid ground when the cell directly below it is
 * not open. Room-local y counts up as `row` decreases (see the fp grid),
 * so the cell below is `row + 1`. A grounded floor needs no walls; an
 * overhead floor (open space below) must be held up. */
function isGroundedBunkerFloor(
  bunker: BunkerState,
  col: number,
  row: number,
  depth: number,
): boolean {
  return !isOpenBunkerCell(bunker, col, row + 1, depth);
}

/** Walls holding up a floor slab: the wall faces of the cell directly
 * below it, which rise to meet the floor's underside. Counts the canonical
 * wall slots that carry a part (only walls and doors can sit in a wall
 * slot, and both are structural dividers). */
function bunkerFloorSupportWalls(
  bunker: BunkerState,
  col: number,
  row: number,
  depth: number,
): number {
  let count = 0;
  for (const face of WALL_SLOTS) {
    const ref = canonicalWallSlot(bunker.footprint, col, row + 1, depth, face);
    if (bunkerPartAtSlot(bunker, ref)) count++;
  }
  return count;
}

/** True when a floor slab at the cell may stand: grounded, or overhead
 * with at least the minimum supporting walls beneath it (F-117). */
function isBunkerFloorSupported(
  bunker: BunkerState,
  col: number,
  row: number,
  depth: number,
): boolean {
  if (isGroundedBunkerFloor(bunker, col, row, depth)) return true;
  return (
    bunkerFloorSupportWalls(bunker, col, row, depth) >=
    BUNKER_OVERHEAD_FLOOR_MIN_WALLS
  );
}

/**
 * Drop every overhead floor that has lost its support (F-117): a floor with
 * open space below it and fewer than the minimum supporting walls falls.
 * A caller runs this after a wall is pried or destroyed. Floors do not
 * support other floors, so a single pass settles it. Pure; returns the
 * culled bunker and the fallen floors (destroyed, so callers do not refund
 * them).
 */
export function cascadeUnsupportedFloors(bunker: BunkerState): {
  bunker: BunkerState;
  fallen: PlacedBasePart[];
} {
  const fallen = bunker.parts.filter(
    (part) =>
      part.slot === "floor" &&
      !isBunkerFloorSupported(bunker, part.col, part.row, part.depth),
  );
  if (fallen.length === 0) return { bunker, fallen };
  const dropped = new Set(fallen);
  return {
    bunker: {
      ...bunker,
      parts: bunker.parts.filter((part) => !dropped.has(part)),
    },
    fallen,
  };
}

/** Open = walkable/buildable air. Every cell (including the depth-0
 * plane) starts as solid claim rock (F-115/F-116); a cell is open only
 * if it has been excavated, and the pre-mined spawn pocket is seeded
 * into `dug` at claim so the player spawns inside an open room. */
export function isOpenBunkerCell(
  bunker: BunkerState,
  col: number,
  row: number,
  depth: number,
): boolean {
  if (!containsBunkerCell3D(bunker.footprint, col, row, depth)) return false;
  return bunker.dug.some(
    (cell) => cell.col === col && cell.row === row && cell.depth === depth,
  );
}

/** Excavation is free, yields nothing, and cannot be undone in v1. It
 * must chain from an already-open face so server-side replays of the
 * ordered dug list prove every dig was physically reachable. */
export function excavateBunkerCell(
  bunker: BunkerState,
  col: number,
  row: number,
  depth: number,
):
  | { ok: true; bunker: BunkerState }
  | { ok: false; reason: "outside" | "open" | "unreachable" } {
  if (!containsBunkerCell3D(bunker.footprint, col, row, depth)) {
    return { ok: false, reason: "outside" };
  }
  if (isOpenBunkerCell(bunker, col, row, depth)) {
    return { ok: false, reason: "open" };
  }
  const reachable =
    isOpenBunkerCell(bunker, col - 1, row, depth) ||
    isOpenBunkerCell(bunker, col + 1, row, depth) ||
    isOpenBunkerCell(bunker, col, row - 1, depth) ||
    isOpenBunkerCell(bunker, col, row + 1, depth) ||
    isOpenBunkerCell(bunker, col, row, depth - 1) ||
    isOpenBunkerCell(bunker, col, row, depth + 1);
  if (!reachable) return { ok: false, reason: "unreachable" };
  return {
    ok: true,
    bunker: { ...bunker, dug: [...bunker.dug, { col, row, depth }] },
  };
}

function bunkerLootKey(col: number, row: number, depth: number): string {
  return `${col},${row},${depth}`;
}

/** Merge an ore pile into a bunker's loot at one cell, deduped by cell.
 * Returns a new loot array (input untouched). */
function addBunkerLoot(
  loot: BunkerLoot[],
  col: number,
  row: number,
  depth: number,
  ores: Partial<Record<OreId, number>>,
): BunkerLoot[] {
  const key = bunkerLootKey(col, row, depth);
  let merged = false;
  const next = loot.map((entry) => {
    if (bunkerLootKey(entry.col, entry.row, entry.depth) !== key) return entry;
    merged = true;
    const combined: Partial<Record<OreId, number>> = { ...entry.ores };
    for (const [id, n] of Object.entries(ores) as Array<[OreId, number]>) {
      combined[id] = (combined[id] ?? 0) + n;
    }
    return { ...entry, ores: combined };
  });
  if (!merged) next.push({ col, row, depth, ores: { ...ores } });
  return next;
}

/**
 * Credit one dug bunker cell's ore into the trip bag, spilling whatever
 * does not fit into the bunker's persistent loot at that cell (F-116).
 * Mutates `state.miner.carried` through `fillHold`; battery is never
 * touched (Q-021: bunker digging is free). Non-ore cells and legacy
 * bunkers without a block seed credit nothing. Returns the loot-updated
 * bunker plus how much entered the bag and how much spilled.
 */
export function creditBunkerDig(
  state: MineState,
  bunker: BunkerState,
  col: number,
  row: number,
  depth: number,
): { bunker: BunkerState; taken: number; spilled: number } {
  const dropYield = bunkerCellOreYield(
    bunker.footprint,
    bunker.blockSeed,
    col,
    row,
    depth,
  );
  if (!dropYield) return { bunker, taken: 0, spilled: 0 };
  const { taken, dropped, leftover } = fillHold(state, {
    [dropYield.ore]: dropYield.units,
  });
  if (dropped <= 0) return { bunker, taken, spilled: 0 };
  return {
    bunker: {
      ...bunker,
      loot: addBunkerLoot(bunker.loot ?? [], col, row, depth, leftover),
    },
    taken,
    spilled: dropped,
  };
}

/**
 * Replay every player-dug ore cell of a bunker into the trip bag in dig
 * order, skipping the pre-mined spawn pocket (which is free and never
 * pays). The server runs this at bank time after the mine replay, and the
 * client runs the identical pass to preview the banked bag, so the
 * authoritative payout matches the preview regardless of how bunker and
 * mine digging interleaved (bunker ore always settles after mine ore).
 * Mutates `state.miner.carried`; returns the bunker with any overflow loot.
 */
export function settleBunkerDig(
  state: MineState,
  bunker: BunkerState,
): BunkerState {
  const pocket = new Set(
    bunkerSpawnPocketCells(bunker.footprint).map((cell) =>
      bunkerLootKey(cell.col, cell.row, cell.depth),
    ),
  );
  // Recompute loot from the dug set so settling is idempotent: the same
  // (dug, blockSeed, gear) always yields the same bag and the same loot.
  let result: BunkerState = { ...bunker, loot: [] };
  for (const cell of bunker.dug) {
    if (pocket.has(bunkerLootKey(cell.col, cell.row, cell.depth))) continue;
    result = creditBunkerDig(
      state,
      result,
      cell.col,
      cell.row,
      cell.depth,
    ).bunker;
  }
  return result;
}

/**
 * Take all the loot sitting at one bunker cell (F-116). Walking over the
 * cell in first person collects it: a banked bunker credits the loot's
 * vibes straight to the balance (no bag cap), so the whole pile is taken
 * at once. Returns the loot-cleared bunker and the ore that was taken.
 */
export function takeBunkerLootAt(
  bunker: BunkerState,
  col: number,
  row: number,
  depth: number,
): { bunker: BunkerState; ores: Partial<Record<OreId, number>> } {
  const loot = bunker.loot ?? [];
  const key = bunkerLootKey(col, row, depth);
  const entry = loot.find(
    (item) => bunkerLootKey(item.col, item.row, item.depth) === key,
  );
  if (!entry) return { bunker, ores: {} };
  const nextLoot = loot.filter(
    (item) => bunkerLootKey(item.col, item.row, item.depth) !== key,
  );
  return { bunker: { ...bunker, loot: nextLoot }, ores: { ...entry.ores } };
}

export function createBunker(
  footprint: BunkerFootprint,
  blockSeed?: number,
): BunkerState {
  return {
    footprint,
    parts: [],
    // The whole volume starts solid; the spawn pocket is the only open
    // room a fresh claim ships with (F-115).
    dug: bunkerSpawnPocketCells(footprint),
    blockSeed,
  };
}

export function placeBasePart(
  bunker: BunkerState,
  inventory: BasePartInventory,
  partId: BasePartId,
  col: number,
  row: number,
  depth = 0,
  slot?: BunkerSlot,
):
  | { ok: true; bunker: BunkerState; inventory: BasePartInventory }
  | {
      ok: false;
      reason:
        | "outside"
        | "rock"
        | "occupied"
        | "stock"
        | "slot"
        | "roof-top"
        | "unsupported";
    } {
  if (!containsBunkerCell3D(bunker.footprint, col, row, depth)) {
    return { ok: false, reason: "outside" };
  }
  if (!isOpenBunkerCell(bunker, col, row, depth)) {
    return { ok: false, reason: "rock" };
  }
  const def = BASE_PART_CATALOG[partId];
  // Legacy whole-cell placement (no slot): one part per cell, as before.
  if (slot === undefined) {
    if (
      bunker.parts.some(
        (part) => part.col === col && part.row === row && part.depth === depth,
      )
    ) {
      return { ok: false, reason: "occupied" };
    }
    if (inventory[partId] <= 0) return { ok: false, reason: "stock" };
    return {
      ok: true,
      bunker: {
        ...bunker,
        parts: [
          ...bunker.parts,
          { partId, col, row, depth, durability: def.durability },
        ],
      },
      inventory: addBasePartInventory(inventory, partId, -1),
    };
  }
  // Thin sub-cell placement: validate the slot, resolve the canonical
  // divider, and enforce the structural rules so the layout can never hold
  // an unsupported floor or a roof off the top of its room.
  if (!allowedBunkerSlots(partId).includes(slot)) {
    return { ok: false, reason: "slot" };
  }
  const ref = canonicalWallSlot(bunker.footprint, col, row, depth, slot);
  if (bunkerSlotOccupied(bunker, ref)) {
    return { ok: false, reason: "occupied" };
  }
  // A roof caps the top of a room, so the cell above it must not be open
  // (row - 1 is up, since y counts up as row decreases).
  if (slot === "roof" && isOpenBunkerCell(bunker, col, row - 1, depth)) {
    return { ok: false, reason: "roof-top" };
  }
  // An overhead floor must already have the walls that hold it up beneath
  // it; a grounded floor stands on its own.
  if (
    slot === "floor" &&
    !isBunkerFloorSupported(bunker, ref.col, ref.row, ref.depth)
  ) {
    return { ok: false, reason: "unsupported" };
  }
  if (inventory[partId] <= 0) return { ok: false, reason: "stock" };
  return {
    ok: true,
    bunker: {
      ...bunker,
      parts: [
        ...bunker.parts,
        {
          partId,
          col: ref.col,
          row: ref.row,
          depth: ref.depth,
          durability: def.durability,
          slot: ref.slot,
        },
      ],
    },
    inventory: addBasePartInventory(inventory, partId, -1),
  };
}

export function removeBasePart(
  bunker: BunkerState,
  inventory: BasePartInventory,
  col: number,
  row: number,
  depth = 0,
  slot?: BunkerSlot,
):
  | {
      ok: true;
      bunker: BunkerState;
      inventory: BasePartInventory;
      /** Overhead floors dropped because this part held them up (F-117).
       * Destroyed, not refunded; absent when nothing fell. */
      fallen?: PlacedBasePart[];
    }
  | {
      ok: false;
      reason: "missing" | "damaged";
    } {
  // With a slot, target that exact divider; without one, the legacy
  // whole-cell match (first part in the cell) is preserved for one-part
  // layouts.
  const ref =
    slot === undefined
      ? null
      : canonicalWallSlot(bunker.footprint, col, row, depth, slot);
  const part = bunker.parts.find((candidate) => {
    if (ref) {
      return (
        candidate.col === ref.col &&
        candidate.row === ref.row &&
        candidate.depth === ref.depth &&
        candidate.slot === ref.slot
      );
    }
    return (
      candidate.col === col &&
      candidate.row === row &&
      candidate.depth === depth
    );
  });
  if (!part) return { ok: false, reason: "missing" };
  if (isBasePartDamaged(part)) return { ok: false, reason: "damaged" };
  let next: BunkerState = {
    ...bunker,
    parts: bunker.parts.filter((candidate) => candidate !== part),
  };
  // Prying a wall can drop the overhead floors it was holding up.
  let fallen: PlacedBasePart[] = [];
  if (part.slot !== undefined && isBunkerWallSlot(part.slot)) {
    const cascade = cascadeUnsupportedFloors(next);
    next = cascade.bunker;
    fallen = cascade.fallen;
  }
  return {
    ok: true,
    bunker: next,
    inventory: addBasePartInventory(inventory, part.partId, 1),
    ...(fallen.length > 0 ? { fallen } : {}),
  };
}

export function moveBasePart(
  bunker: BunkerState,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  fromDepth = 0,
  toDepth = 0,
):
  | { ok: true; bunker: BunkerState }
  | {
      ok: false;
      reason: "missing" | "outside" | "rock" | "occupied";
    } {
  // Whole-cell move only: a thin (slotted) part is never relocated by the
  // cell mover, so a multi-part cell cannot be moved ambiguously. Slot-aware
  // move lands with the slice that lets the UI relocate a thin part.
  const part = bunker.parts.find((candidate) => {
    return (
      candidate.slot === undefined &&
      candidate.col === fromCol &&
      candidate.row === fromRow &&
      candidate.depth === fromDepth
    );
  });
  if (!part) return { ok: false, reason: "missing" };
  if (!containsBunkerCell3D(bunker.footprint, toCol, toRow, toDepth)) {
    return { ok: false, reason: "outside" };
  }
  if (!isOpenBunkerCell(bunker, toCol, toRow, toDepth)) {
    return { ok: false, reason: "rock" };
  }
  if (
    bunker.parts.some((candidate) => {
      return (
        candidate !== part &&
        candidate.col === toCol &&
        candidate.row === toRow &&
        candidate.depth === toDepth
      );
    })
  ) {
    return { ok: false, reason: "occupied" };
  }
  if (fromCol === toCol && fromRow === toRow && fromDepth === toDepth) {
    return { ok: true, bunker };
  }
  return {
    ok: true,
    bunker: {
      ...bunker,
      parts: bunker.parts.map((candidate) =>
        candidate === part
          ? { ...candidate, col: toCol, row: toRow, depth: toDepth }
          : candidate,
      ),
    },
  };
}
