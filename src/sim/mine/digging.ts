import type { CellKind, MineCell } from "./cells";
import { FALLING_ROCK_MIN_HITS } from "./consumables";
import { DEFAULT_GEAR, type MineGear } from "./gear";
import { type OreId, oreValueTier } from "./ores";

/** Digging rock costs more than dirt even with the right pickaxe. */
export const ROCK_DIG_COST = 2;

/**
 * Multi-hit digging (REQ-013, user-directed 2026-06-12): swings to
 * break each diggable kind at pickaxe level 1. Each pickaxe level
 * above 1 removes one swing (min 1), so the upgrade buys speed and
 * permission. Stronger pickaxes also draw more battery charge per swing.
 */
export const BASE_HITS = {
  dirt: 4,
  ore: 5,
  "part-cache": 6,
  rock: 5,
} as const;

/**
 * Battery charge per swing. At pickaxe 1 a block's swing total matches
 * the old one-swing dig cost (dirt 4 x 0.25 = 1, rock 5 x 0.4 = 2),
 * so the trip economy is unchanged; caches cost a little more.
 */
export const SWING_COST = {
  dirt: 0.25,
  ore: 0.2,
  "part-cache": 0.25,
  rock: 0.4,
} as const;

/** Extra battery charge burned by every swing for each Pickaxe level above 1. */
export const PICKAXE_SWING_COST_STEP = 0.1;

/** Extra battery charge burned by each ore value tier above the starter ore. */
export const ORE_SWING_COST_STEP = 0.08;

/** Swings to break a cell of this kind under this gear. */
export function hitsFor(kind: CellKind, gear: MineGear): number {
  const base = BASE_HITS[kind as keyof typeof BASE_HITS];
  if (!base) return 1;
  return Math.max(1, base - (gear.pickaxe - 1));
}

/** Robot battery charge one swing at this kind costs. */
export function swingCostFor(
  kind: CellKind,
  gear: Pick<MineGear, "pickaxe"> = DEFAULT_GEAR,
): number {
  const base = SWING_COST[kind as keyof typeof SWING_COST] ?? MOVE_COST;
  return base + Math.max(0, gear.pickaxe - 1) * PICKAXE_SWING_COST_STEP;
}

/** Robot battery charge one ore swing costs, including richer-ore strain. */
export function oreSwingCostFor(
  ore: OreId,
  gear: Pick<MineGear, "pickaxe"> = DEFAULT_GEAR,
): number {
  return swingCostFor("ore", gear) + oreValueTier(ore) * ORE_SWING_COST_STEP;
}

/**
 * Rock tier by depth (Terraria-style hard gates): pickaxe level N digs
 * rock tiers up to N - 1, so level 1 digs none and the wall a player
 * hits is always one shop visit away from opening.
 */
export function rockTierAt(row: number): number {
  if (row < 24) return 1;
  if (row < 48) return 2;
  if (row < 90) return 3;
  if (row < 140) return 4;
  if (row < 220) return 5;
  if (row < 340) return 6;
  if (row < 500) return 7;
  if (row < 720) return 8;
  return 9;
}

export function canDigRock(gear: MineGear, tier: number): boolean {
  return gear.pickaxe - 1 >= tier;
}

/**
 * Every stone body is one material to the pickaxe (user-directed
 * 2026-07-29: no rock in the mine may be a permanent dead end). A boulder
 * is stone the player has not undermined yet, not a wall, so it cuts at
 * its row's tier like any rock instead of refusing every swing.
 */
export function isRockLike(cell: MineCell): boolean {
  return cell.kind === "rock" || cell.kind === "boulder";
}

/** Stone mid-fall or come to rest: the hazard the two-hit floor protects. */
export function isFallingRock(cell: MineCell): boolean {
  return (
    isRockLike(cell) && (cell.fallIn !== undefined || cell.fallen === true)
  );
}

/** The material this cell digs as, which is rock for every stone body. */
export function digKindFor(cell: MineCell): CellKind {
  return isRockLike(cell) ? "rock" : cell.kind;
}

/** Pickaxe tier this cell demands. Stone that fell is gated by where it rests. */
export function rockTierForDig(cell: MineCell, row: number): number {
  return isFallingRock(cell)
    ? rockTierAt(row)
    : (cell.rockTier ?? rockTierAt(row));
}

/**
 * Swings to break this cell, the count both the dig path and the crack
 * overlay must agree on. Falling or fallen stone keeps a two-hit floor
 * even under a maxed pickaxe, so the warning window stays playable.
 */
export function hitsForCell(cell: MineCell, gear: MineGear): number {
  const base = hitsFor(digKindFor(cell), gear);
  return isFallingRock(cell) ? Math.max(FALLING_ROCK_MIN_HITS, base) : base;
}

/**
 * The mine is endless on both axes (REQ-027): columns span all
 * integers with the village anchored at the origin.
 */
export const START_COL = 0;
export const START_ENERGY = 60;

export const DIG_COST_DIRT = 1;
export const MOVE_COST = 0.5;
/** Rows visible below the miner without better lanterns. */
export const LIGHT_RADIUS = 3;
