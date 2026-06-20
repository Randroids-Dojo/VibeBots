/**
 * Per-cell deterministic randomness: a 32-bit integer mix of
 * (seed, row, col, salt) fed through one mulberry32 step. Pure function
 * of its inputs, so the mine is identical for a seed regardless of the
 * path walked or the order cells are queried (no shared rng stream).
 */
function cellRandom(
  seed: number,
  row: number,
  col: number,
  salt: number,
): number {
  let h =
    seed ^
    Math.imul(row + 1, 0x9e3779b1) ^
    Math.imul(col + 1, 0x85ebca6b) ^
    salt;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The mining loop (REQ-006/REQ-007/REQ-011/REQ-012): a deterministic 2D
 * vertical grid. Pure logic; rendering draws these cells as low-poly 3D
 * blocks from a side camera (Q-004 resolution). Same seed, same mine,
 * same finds: mining rewards stay verifiable like everything else.
 *
 * Core tension: every action costs energy. Banking happens only on the
 * surface; running dry underground drops the carried bag where you fell.
 */

/**
 * Bumped whenever generation or rules change payouts for the same
 * (seed, moves). The client submits it with a cash-out so a session
 * played on old rules is rejected instead of silently re-priced.
 */
export const MINE_VERSION = 38;
export const MINE_BOTTOM_ROW = 1000;

/**
 * Consumables (REQ-016): bought on the surface, spent as logged actions
 * so the server replay can verify and decrement them. Each resolves one
 * dread: dynamite ("I can't get through"), recall rope ("I won't make
 * it back": ends the trip from anywhere, banking the carry).
 */
export interface MineConsumables {
  dynamite: number;
  rope: number;
  ladder: number;
  plank: number;
  /** Warp beacon kits (REQ-029): placed beacon anchors. */
  beacon: number;
}

export const NO_CONSUMABLES: MineConsumables = {
  dynamite: 0,
  rope: 0,
  ladder: 0,
  plank: 0,
  beacon: 0,
};

export const CONSUMABLE_PRICES: Record<keyof MineConsumables, number> = {
  dynamite: 10,
  rope: 8,
  ladder: 2,
  plank: 2,
  beacon: 60,
};

const SUPPORT_SALVAGE_NUMERATOR = 1;
const SUPPORT_SALVAGE_DENOMINATOR = 2;
const PLANK_HITS = 3;
export const MAX_BEACONS = 2;
export const BEACON_LABEL_MAX_LENGTH = 12;

type SalvageablePlacement = "ladder" | "plank" | "beacon";

export function supportSalvageValue(item: SalvageablePlacement): number {
  return Math.max(
    1,
    Math.floor(
      (CONSUMABLE_PRICES[item] * SUPPORT_SALVAGE_NUMERATOR) /
        SUPPORT_SALVAGE_DENOMINATOR,
    ),
  );
}

function salvageSupport(state: MineState, item: SalvageablePlacement): number {
  const value = supportSalvageValue(item);
  state.miner.carriedSalvageCredits += value;
  return value;
}

export function normalizeBeaconLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, BEACON_LABEL_MAX_LENGTH);
}

/** Per-key sum, shared by the store's carryover and purchase merges. */
export function addConsumables(
  a: MineConsumables,
  b: MineConsumables,
): MineConsumables {
  return {
    dynamite: a.dynamite + b.dynamite,
    rope: a.rope + b.rope,
    ladder: a.ladder + b.ladder,
    plank: a.plank + b.plank,
    beacon: a.beacon + b.beacon,
  };
}

/**
 * Death-recovery floor for ladders. Trips no longer ship free ladders:
 * climbing is ladder-gated (REQ-020) and the rungs are bought at the
 * depot. The one free source is dying in the mine (battery out or crushed,
 * not giving up): a death tops the stock back up TO this floor so the
 * miner can climb out again. Free rungs granted this way do not bank
 * between trips (see carryoverConsumables) and are not charged at
 * cash-out (see MineState.granted and the bank route).
 */
export const LADDER_RECOVERY_FLOOR = 8;

/**
 * Death-recovery floor for planks (REQ-022): lateral steps over a void
 * are plank-gated. Same rule as ladders, smaller floor: bought at the
 * depot, refilled up to this count only when the miner dies.
 */
export const PLANK_RECOVERY_FLOOR = 4;

/**
 * The one-time starting kit a brand-new player is gifted at account
 * creation: the basic ladder and plank bundle so the very first descent
 * works without a shop visit. It is a gift once, not a per-trip grant:
 * once spent it is bought back at the depot or refilled by dying. The
 * server seeds it into a new player row; the client mirrors it for a
 * fresh storage-less session (guest/local dev) where there is no row.
 */
export const STARTING_CONSUMABLES: MineConsumables = {
  ...NO_CONSUMABLES,
  ladder: LADDER_RECOVERY_FLOOR,
  plank: PLANK_RECOVERY_FLOOR,
};

/** Robot battery charge burned per gas pocket vented (heat, not shrapnel). */
export const GAS_VENT_DRAIN = 8;

/**
 * Persistent gear tracks (REQ-013/REQ-014): part of the sim input, so a
 * trip replays identically from (seed, gear, moves). Level arrays are
 * indexed by level - 1; prices[i] upgrades from level i+1 to i+2.
 */
export interface MineGear {
  pickaxe: number;
  battery: number;
  /** Legacy saved snapshots used lamp for the robot battery track. */
  lamp?: number;
  cargo: number;
  lantern: number;
  /** Elevator rail depth in rows (REQ-028); 0 = no rail bought yet. */
  elevator: number;
  /** Warpcoil level (REQ-029): indexes WARP_RANGE. */
  warpcoil: number;
  /**
   * Highest unlocked dynamite tier. Absent or 1 is the base plus charge.
   * Higher tiers are one-time unlocks, not a radius upgrade ladder.
   */
  blast?: number;
  /**
   * Elevator car speed: rows travelled per ride (see elevatorSpeedRows).
   * Optional/back-compat like blast (absent reads as level 1, two rows).
   */
  elevatorSpeed?: number;
  /**
   * Fall harness level: how many unsupported cells the miner can free
   * fall before the landing kills the trip. Optional for old snapshots.
   */
  fall?: number;
}

export type MineGearSnapshot = Omit<MineGear, "battery"> & {
  battery?: number;
};

export const DEFAULT_GEAR: MineGear = {
  pickaxe: 1,
  battery: 1,
  cargo: 1,
  lantern: 1,
  elevator: 0,
  warpcoil: 1,
  blast: 1,
  elevatorSpeed: 1,
  fall: 1,
};

/** The elevator's column: the elevator runs down this shaft. */
export const ELEVATOR_COL = -5;
/** Rows of rail per purchased segment (one stratum band). */
export const ELEVATOR_SEGMENT_ROWS = 12;

/** Target row for the current authored long-form mine economy. */
export const MINE_BALANCE_MAX_ROW = 1000;

const EARLY_ELEVATOR_SEGMENT_PRICES = [45, 80, 130, 200, 300] as const;

/**
 * Price of the nth rail segment (1-based). Rail remains a major
 * investment, but it must be finite through the row-1000 transport goal.
 */
export function elevatorSegmentPrice(segment: number): number {
  if (segment <= 0) return 0;
  if (segment <= EARLY_ELEVATOR_SEGMENT_PRICES.length)
    return EARLY_ELEVATOR_SEGMENT_PRICES[segment - 1];
  if (segment <= 12) return 380 + (segment - 6) * 70;
  if (segment <= 34) return 900 + (segment - 13) * 115;
  return 2800 + (segment - 35) * 105;
}

/** Max robot battery charge by battery-cell level. */
export const BATTERY_CHARGE = [60, 90, 130, 180] as const;
/** Visible rows below the miner by lantern level. */
export const LANTERN_RADIUS = [3, 5, 7] as const;
/** Ore chunks the hold carries by cargo level (parts ride free). */
export const CARGO_CAPACITY = [8, 14, 22, 32] as const;
/** Cells the miner can fall and survive by fall-harness level. */
export const SAFE_FALL_ROWS = [4, 6, 9, 13, 18] as const;

export type MineGearTrack =
  | "pickaxe"
  | "battery"
  | "cargo"
  | "lantern"
  | "warpcoil"
  | "blast"
  | "elevatorSpeed"
  | "fall";

export interface GearTrackDef {
  track: MineGearTrack;
  name: string;
  /** prices[i] is the cost to go from level i+1 to level i+2. */
  prices: readonly number[];
  /** One-line shop copy for what the next level does. */
  blurb: string;
}

export const GEAR_TRACKS: readonly GearTrackDef[] = [
  {
    track: "pickaxe",
    name: "Pickaxe",
    prices: [45, 140, 420, 1200],
    blurb: "cuts harder rock tiers",
  },
  {
    track: "battery",
    name: "Battery Cell",
    prices: [35, 110, 340],
    blurb: "more robot charge per trip",
  },
  {
    track: "cargo",
    name: "Cargo Hold",
    prices: [30, 90, 280],
    blurb: "carry more ore per trip",
  },
  {
    track: "lantern",
    name: "Lantern",
    prices: [55, 180],
    blurb: "see deeper ahead",
  },
  {
    track: "warpcoil",
    name: "Warpcoil",
    prices: [180, 700, 2600],
    blurb: "longer beacon warp range",
  },
  {
    track: "blast",
    name: "Blast Charge",
    prices: [250, 800, 2500],
    blurb: "unlock stronger dynamite shapes",
  },
  {
    track: "elevatorSpeed",
    name: "Elevator Speed",
    prices: [100, 260, 680, 1750, 4500, 11000, 26000, 62000],
    blurb: "faster elevator rides (needs a rail)",
  },
  {
    track: "fall",
    name: "Fall Harness",
    prices: [80, 220, 620, 1700],
    blurb: "survive longer free falls",
  },
];

/** Beacon warp reach in rows by warpcoil level (REQ-029). */
export const WARP_RANGE = [60, 150, 400, 1000] as const;

export function warpRange(gear: MineGear): number {
  return WARP_RANGE[Math.min(gear.warpcoil, WARP_RANGE.length) - 1];
}

/** The village warp pad's column. */
export const WARP_PAD_COL = 6;

export type MineBiomeId = "default" | "winter" | "highTech";

export interface BiomeBand {
  id: Exclude<MineBiomeId, "default">;
  name: string;
  minCol: number;
  maxCol: number;
}

export const BIOME_BANDS: readonly BiomeBand[] = [
  { id: "winter", name: "Winter Expanse", minCol: -100, maxCol: -50 },
  { id: "highTech", name: "Circuit Sprawl", minCol: 100, maxCol: 150 },
];

export function biomeAt(col: number): MineBiomeId {
  for (const band of BIOME_BANDS) {
    if (col >= band.minCol && col <= band.maxCol) return band.id;
  }
  return "default";
}

export type PortalBeaconId = "winter" | "highTech";
export type PortalTargetId = PortalBeaconId | "base";

export interface BiomePortalDef {
  id: PortalBeaconId;
  biome: Exclude<MineBiomeId, "default">;
  name: string;
  col: number;
  row: 0;
  color: string;
  blurb: string;
}

export const BIOME_PORTALS: readonly BiomePortalDef[] = [
  {
    id: "winter",
    biome: "winter",
    name: "Winter Beacon",
    col: -75,
    row: 0,
    color: "#9ee7ff",
    blurb: "snowfield gate",
  },
  {
    id: "highTech",
    biome: "highTech",
    name: "High-Tech Beacon",
    col: 125,
    row: 0,
    color: "#65ffb8",
    blurb: "high-tech gate",
  },
] as const;

export function portalDef(id: PortalBeaconId): BiomePortalDef {
  const def = BIOME_PORTALS.find((portal) => portal.id === id);
  if (!def) throw new Error(`unknown portal: ${id}`);
  return def;
}

export function authoredPortalAt(
  col: number,
  row: number,
): BiomePortalDef | null {
  return (
    BIOME_PORTALS.find((portal) => portal.col === col && portal.row === row) ??
    null
  );
}

export function gearTrackDef(track: MineGearTrack): GearTrackDef {
  const def = GEAR_TRACKS.find((t) => t.track === track);
  if (!def) throw new Error(`unknown gear track: ${track}`);
  return def;
}

export function maxGearLevel(track: MineGearTrack): number {
  return gearTrackDef(track).prices.length + 1;
}

/** Digging rock costs more than dirt even with the right pickaxe. */
export const ROCK_DIG_COST = 2;

/**
 * Multi-hit digging (REQ-013, user-directed 2026-06-12): swings to
 * break each diggable kind at pickaxe level 1. Each pickaxe level
 * above 1 removes one swing (min 1), so the upgrade buys speed and
 * energy, not just permission.
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

/** Swings to break a cell of this kind under this gear. */
export function hitsFor(kind: CellKind, gear: MineGear): number {
  const base = BASE_HITS[kind as keyof typeof BASE_HITS];
  if (!base) return 1;
  return Math.max(1, base - (gear.pickaxe - 1));
}

/** Robot battery charge one swing at this kind costs. */
export function swingCostFor(kind: CellKind): number {
  return SWING_COST[kind as keyof typeof SWING_COST] ?? MOVE_COST;
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
  return 4;
}

export function canDigRock(gear: MineGear, tier: number): boolean {
  return gear.pickaxe - 1 >= tier;
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

/**
 * Ore tiers (REQ-011): roughly exponential credit value, rarity inverse
 * to value, each living in a depth band with overlap (trapezoid ramp:
 * fade in from minRow, full strength peakStart..peakEnd, fade out to
 * maxRow). After the main band, old tiers keep a low trace chance so
 * deeper rows still contain earlier resources, but as larger stacks.
 */
export type OreId =
  | "coal"
  | "copper"
  | "silver"
  | "emerald"
  | "ruby"
  | "diamond"
  | "core-crystal"
  | "frozen-coal"
  | "frost-copper"
  | "rime-silver"
  | "aurora-emerald"
  | "glacier-ruby"
  | "blue-diamond"
  | "permafrost-core"
  | "brass-knob"
  | "wire-spool"
  | "logic-chip"
  | "micro-monitor"
  | "keyboard-matrix"
  | "servo-motor"
  | "quantum-core";

export interface OreDef {
  id: OreId;
  name: string;
  /** Vibes paid for one mined unit when banked. */
  value: number;
  biome: MineBiomeId;
  minRow: number;
  peakStart: number;
  peakEnd: number;
  /** Infinity = present all the way down. */
  maxRow: number;
  peakChance: number;
}

export const ORES: readonly OreDef[] = [
  {
    id: "coal",
    name: "Coal",
    value: 1,
    biome: "default",
    minRow: 1,
    peakStart: 2,
    peakEnd: 12,
    maxRow: 24,
    peakChance: 0.09,
  },
  {
    id: "copper",
    name: "Copper",
    value: 2,
    biome: "default",
    minRow: 4,
    peakStart: 8,
    peakEnd: 20,
    maxRow: 30,
    peakChance: 0.07,
  },
  {
    id: "silver",
    name: "Silver",
    value: 3,
    biome: "default",
    minRow: 14,
    peakStart: 20,
    peakEnd: 34,
    maxRow: 44,
    peakChance: 0.06,
  },
  {
    id: "emerald",
    name: "Emerald",
    value: 5,
    biome: "default",
    minRow: 24,
    peakStart: 32,
    peakEnd: 46,
    maxRow: 58,
    peakChance: 0.05,
  },
  {
    id: "ruby",
    name: "Ruby",
    value: 8,
    biome: "default",
    minRow: 36,
    peakStart: 44,
    peakEnd: 58,
    maxRow: 72,
    peakChance: 0.04,
  },
  {
    id: "diamond",
    name: "Diamond",
    value: 12,
    biome: "default",
    minRow: 48,
    peakStart: 58,
    peakEnd: 76,
    maxRow: 92,
    peakChance: 0.03,
  },
  {
    id: "core-crystal",
    name: "Core Crystal",
    value: 20,
    biome: "default",
    minRow: 64,
    peakStart: 80,
    peakEnd: Number.POSITIVE_INFINITY,
    maxRow: Number.POSITIVE_INFINITY,
    peakChance: 0.025,
  },
  {
    id: "frozen-coal",
    name: "Frozen Coal",
    value: 1,
    biome: "winter",
    minRow: 1,
    peakStart: 2,
    peakEnd: 12,
    maxRow: 24,
    peakChance: 0.09,
  },
  {
    id: "frost-copper",
    name: "Frost Copper",
    value: 2,
    biome: "winter",
    minRow: 4,
    peakStart: 8,
    peakEnd: 20,
    maxRow: 30,
    peakChance: 0.07,
  },
  {
    id: "rime-silver",
    name: "Rime Silver",
    value: 3,
    biome: "winter",
    minRow: 14,
    peakStart: 20,
    peakEnd: 34,
    maxRow: 44,
    peakChance: 0.055,
  },
  {
    id: "aurora-emerald",
    name: "Aurora Emerald",
    value: 5,
    biome: "winter",
    minRow: 24,
    peakStart: 32,
    peakEnd: 46,
    maxRow: 58,
    peakChance: 0.05,
  },
  {
    id: "glacier-ruby",
    name: "Glacier Ruby",
    value: 9,
    biome: "winter",
    minRow: 36,
    peakStart: 44,
    peakEnd: 58,
    maxRow: 72,
    peakChance: 0.035,
  },
  {
    id: "blue-diamond",
    name: "Blue Diamond",
    value: 13,
    biome: "winter",
    minRow: 48,
    peakStart: 58,
    peakEnd: 76,
    maxRow: 92,
    peakChance: 0.026,
  },
  {
    id: "permafrost-core",
    name: "Permafrost Core",
    value: 22,
    biome: "winter",
    minRow: 64,
    peakStart: 80,
    peakEnd: Number.POSITIVE_INFINITY,
    maxRow: Number.POSITIVE_INFINITY,
    peakChance: 0.022,
  },
  {
    id: "brass-knob",
    name: "Brass Knob",
    value: 1,
    biome: "highTech",
    minRow: 1,
    peakStart: 2,
    peakEnd: 12,
    maxRow: 24,
    peakChance: 0.09,
  },
  {
    id: "wire-spool",
    name: "Wire Spool",
    value: 2,
    biome: "highTech",
    minRow: 4,
    peakStart: 8,
    peakEnd: 20,
    maxRow: 30,
    peakChance: 0.07,
  },
  {
    id: "logic-chip",
    name: "Logic Chip",
    value: 3,
    biome: "highTech",
    minRow: 14,
    peakStart: 20,
    peakEnd: 34,
    maxRow: 44,
    peakChance: 0.055,
  },
  {
    id: "micro-monitor",
    name: "Micro Monitor",
    value: 5,
    biome: "highTech",
    minRow: 24,
    peakStart: 32,
    peakEnd: 46,
    maxRow: 58,
    peakChance: 0.045,
  },
  {
    id: "keyboard-matrix",
    name: "Keyboard Matrix",
    value: 9,
    biome: "highTech",
    minRow: 36,
    peakStart: 44,
    peakEnd: 58,
    maxRow: 72,
    peakChance: 0.036,
  },
  {
    id: "servo-motor",
    name: "Servo Motor",
    value: 13,
    biome: "highTech",
    minRow: 48,
    peakStart: 58,
    peakEnd: 76,
    maxRow: 92,
    peakChance: 0.026,
  },
  {
    id: "quantum-core",
    name: "Quantum Core",
    value: 24,
    biome: "highTech",
    minRow: 64,
    peakStart: 80,
    peakEnd: Number.POSITIVE_INFINITY,
    maxRow: Number.POSITIVE_INFINITY,
    peakChance: 0.021,
  },
];

const ORE_BY_ID = new Map(ORES.map((ore) => [ore.id, ore]));

const ORE_IDS_BY_BIOME: Record<MineBiomeId, readonly OreId[]> = {
  default: [
    "coal",
    "copper",
    "silver",
    "emerald",
    "ruby",
    "diamond",
    "core-crystal",
  ],
  winter: [
    "frozen-coal",
    "frost-copper",
    "rime-silver",
    "aurora-emerald",
    "glacier-ruby",
    "blue-diamond",
    "permafrost-core",
  ],
  highTech: [
    "brass-knob",
    "wire-spool",
    "logic-chip",
    "micro-monitor",
    "keyboard-matrix",
    "servo-motor",
    "quantum-core",
  ],
};

export function oreIdsForBiome(biome: MineBiomeId): readonly OreId[] {
  return ORE_IDS_BY_BIOME[biome];
}

function oreValueTier(id: OreId): number {
  const ids = oreIdsForBiome(oreDef(id).biome);
  const tier = ids.indexOf(id);
  return tier >= 0 ? tier : 0;
}

const ORE_BASE_RESERVES: Record<OreId, number> = {
  coal: 4,
  copper: 5,
  silver: 7,
  emerald: 9,
  ruby: 12,
  diamond: 18,
  "core-crystal": 28,
  "frozen-coal": 4,
  "frost-copper": 5,
  "rime-silver": 6,
  "aurora-emerald": 9,
  "glacier-ruby": 11,
  "blue-diamond": 17,
  "permafrost-core": 27,
  "brass-knob": 4,
  "wire-spool": 5,
  "logic-chip": 6,
  "micro-monitor": 8,
  "keyboard-matrix": 11,
  "servo-motor": 16,
  "quantum-core": 26,
};

export function oreDef(id: OreId): OreDef {
  const def = ORE_BY_ID.get(id);
  if (!def) throw new Error(`unknown ore: ${id}`);
  return def;
}

export function oreBaseReserve(id: OreId): number {
  return ORE_BASE_RESERVES[id];
}

export function oreReserveAt(id: OreId, row: number): number {
  return oreBaseReserve(id) * oreUnitsAt(row);
}

export function oreCellValueAt(id: OreId, row: number): number {
  return oreReserveAt(id, row) * oreDef(id).value;
}

export function oreSwingYield(
  seed: number,
  gear: Pick<MineGear, "pickaxe">,
  id: OreId,
  row: number,
  col: number,
  remainingBeforeSwing: number,
): number {
  const reserve = oreReserveAt(id, row);
  const swingIndex = Math.max(0, reserve - remainingBeforeSwing);
  const tier = oreValueTier(id);
  const depthBonus = oreUnitsAt(row) - 1;
  const pickaxeBonus = Math.max(0, gear.pickaxe - 1);
  const richness = tier + depthBonus + pickaxeBonus;
  const missChance = Math.max(0.06, 0.22 - richness * 0.012);
  const rollSalt = 0x4f524500 ^ Math.imul(swingIndex + 1, 0x9e3779b1);
  if (
    remainingBeforeSwing > 1 &&
    cellRandom(seed, row, col, rollSalt) < missChance
  ) {
    return 0;
  }

  const maxBurst = Math.min(
    remainingBeforeSwing,
    1 + Math.floor((tier + 1) / 2) + Math.floor(depthBonus / 2) + pickaxeBonus,
  );
  let units = 1;
  for (let bonus = 0; units < maxBurst; bonus++) {
    const chance = Math.max(
      0.07,
      0.32 +
        tier * 0.025 +
        depthBonus * 0.018 +
        pickaxeBonus * 0.02 -
        bonus * 0.13,
    );
    const salt =
      0x5949454c ^
      Math.imul(swingIndex + 1, 0x85ebca6b) ^
      Math.imul(bonus + 1, 0xc2b2ae35);
    if (cellRandom(seed, row, col, salt) >= chance) break;
    units++;
  }
  return units;
}

/** Trapezoid band ramp: 0 outside, linear fades, 1 across the peak. */
export function oreChanceAt(ore: OreDef, row: number): number {
  if (row < ore.minRow) return 0;
  if (row > ore.maxRow) return ore.peakChance * 0.06;
  if (row < ore.peakStart)
    return (ore.peakChance * (row - ore.minRow)) / (ore.peakStart - ore.minRow);
  if (row <= ore.peakEnd) return ore.peakChance;
  return (ore.peakChance * (ore.maxRow - row)) / (ore.maxRow - ore.peakEnd);
}

const ORE_UNIT_STEPS: ReadonlyArray<{ minRow: number; units: number }> = [
  { minRow: 1000, units: 12 },
  { minRow: 760, units: 10 },
  { minRow: 580, units: 8 },
  { minRow: 420, units: 6 },
  { minRow: 280, units: 4 },
  { minRow: 160, units: 3 },
  { minRow: 80, units: 2 },
];

/** Ore chunks yielded by one ore cell at this row. */
export function oreUnitsAt(row: number): number {
  for (const step of ORE_UNIT_STEPS) {
    if (row >= step.minRow) return step.units;
  }
  return 1;
}

/** Named strata (REQ-012): every band has its own look and stamp goal. */
export interface Stratum {
  name: string;
  startRow: number;
}

export const STRATA: readonly Stratum[] = [
  { name: "Topsoil", startRow: 0 },
  { name: "Clay Beds", startRow: 12 },
  { name: "Old Granite", startRow: 24 },
  { name: "Glow Caverns", startRow: 36 },
  { name: "Magma Verge", startRow: 48 },
  { name: "Ashfall Galleries", startRow: 64 },
  { name: "The Black Seam", startRow: 84 },
  { name: "Echo Vaults", startRow: 110 },
  { name: "Core Approach", startRow: 140 },
  { name: "Crystal Foundry", startRow: 220 },
  { name: "Pressure Cathedral", startRow: 340 },
  { name: "Ion Mantle", startRow: 500 },
  { name: "Sunken Circuit", startRow: 680 },
  { name: "Depth 1000 Gate", startRow: 880 },
];

export function stratumAt(row: number): Stratum {
  let current = STRATA[0];
  for (const stratum of STRATA) {
    if (row >= stratum.startRow) current = stratum;
  }
  return current;
}

export type CellKind =
  | "dirt"
  | "rock"
  | "ore"
  | "part-cache"
  | "boulder"
  | "gas"
  | "magma"
  | "metal"
  | "empty";

export interface MineCell {
  kind: CellKind;
  /** Set when kind is "ore". */
  ore?: OreId;
  /** Set when kind is "rock" (hard gate vs the pickaxe level). */
  rockTier?: number;
  /**
   * An undermined rock or boulder counting down to its fall (REQ-015):
   * actions remaining before it drops. Set when its support is dug out,
   * decremented each action, and the block falls when it reaches zero.
   * The teeter (escalating tremble) is the tell. Unset means stable.
   */
  fallIn?: number;
  /**
   * A deployed ladder (REQ-020), only meaningful on empty cells.
   * Climbing out of this cell is free once placed. Anything that
   * overwrites the cell (a falling boulder) smashes the ladder.
   */
  ladder?: boolean;
  /**
   * A deployed plank bridge (REQ-022), only meaningful on empty cells.
   * Stepping laterally into this cell over a void is free once placed.
   * Planks can also be pre-set on a diggable cell; when that cell is
   * mined, the bridge remains underfoot. A falling boulder smashes it
   * like a ladder.
   */
  plank?: boolean;
  /** Remaining pickaxe hits before a placed plank breaks for salvage. */
  plankHp?: number;
  /**
   * Swings remaining before this block breaks (REQ-013). Unset means
   * full health for its kind and the digger's pickaxe.
   */
  hp?: number;
  /**
   * Ore units still locked in this cell. Unset ore cells infer their full
   * deterministic reserve from the ore id and row.
   */
  oreRemaining?: number;
  /** A placed warp beacon stands here (REQ-029). */
  beacon?: boolean;
  /** Placement order for newest-first Warp Pad lists. */
  beaconOrder?: number;
  /** Optional short name shown in the Warp Pad list. */
  beaconLabel?: string;
  /** Active authored surface portal, separate from bought warp beacons. */
  portal?: PortalBeaconId;
  portalActive?: boolean;
  /**
   * Ore lying on the floor of an empty cell: chunks that overflowed a
   * dig or dynamite blast because the cargo hold was full. Scooped up by
   * walking over the cell once the hold has room (a partial take leaves
   * the rest as a smaller pile). A falling block buries it like a ladder.
   * Usually lives on empty cells; a partially mined ore cell can also hold
   * overflow until the deposit opens and the pile settles normally.
   */
  drop?: Partial<Record<OreId, number>>;
  /**
   * Subset of `drop` that the player manually dropped from the bag.
   * Walk-over pickup takes the rest of the pile first so a player can
   * make room without immediately reclaiming the same chunks.
   */
  dropDeferred?: Partial<Record<OreId, number>>;
  /**
   * The miner's carried bag after a collapse or abandoned dig. Walking
   * over the cell scoops it back into the miner's current haul.
   */
  bag?: DroppedBag;
  /** A rock that entered the falling-rock hazard system. Render-layer cue. */
  fallen?: boolean;
}

export interface DroppedBag {
  ores: Partial<Record<OreId, number>>;
  salvageCredits: number;
  parts: string[];
}

export interface PendingDynamite {
  col: number;
  row: number;
  tier: DynamiteTier;
}

/**
 * Rare robot parts discoverable underground (REQ-007). Deeper bands
 * roll richer tables (REQ-030): the bot-building reward keeps paying
 * the deeper the push.
 */
const CACHE_PART_TIERS: ReadonlyArray<{
  minRow: number;
  ids: readonly string[];
}> = [
  { minRow: 40, ids: ["core-cube", "core-cube", "drive-wheel", "ram-spike"] },
  { minRow: 0, ids: ["drive-wheel", "ram-spike", "frame-plate"] },
];

function cachePartIdsAt(row: number): readonly string[] {
  for (const tier of CACHE_PART_TIERS) {
    if (row >= tier.minRow) return tier.ids;
  }
  return CACHE_PART_TIERS[CACHE_PART_TIERS.length - 1].ids;
}

export interface MinerState {
  col: number;
  row: number; // 0 = surface walk row; digging starts at row 1
  energy: number;
  /** Carried ore counts by id; dropped on collapse, banked on the surface. */
  carried: Partial<Record<OreId, number>>;
  /** Salvage value from picked-up supports, lost like ore until surfaced. */
  carriedSalvageCredits: number;
  carriedParts: string[];
  bankedCredits: number;
  bankedParts: string[];
  /** Most recent surfaced haul before it was converted into wallet value. */
  lastSoldHaul?: SoldHaul;
  /** Deepest row reached this session, used for profile records and stamps. */
  maxDepth: number;
  /** Trips that ended underground with a dead battery or hazard death. */
  collapses: number;
  /** Last dropped cargo location for the render-layer locator. */
  lostCargo?: { value: number; parts: string[]; col: number; row: number };
}

export interface SoldHaul {
  ores: Partial<Record<OreId, number>>;
  salvageCredits: number;
  totalVibes: number;
}

export interface MineState {
  seed: number;
  /** Gear snapshot for the session; part of the replay input (Q-007). */
  gear: MineGear;
  /** Consumables remaining this session; part of the replay input. */
  consumables: MineConsumables;
  /** Consumables spent this session (server decrements at cash-out). */
  used: MineConsumables;
  /**
   * Free recovery stock granted this session by deaths (the top-up to
   * the recovery floor). Only ladders and planks are ever granted. The
   * cash-out decrement forgives this much of `used`, and carryover
   * strips the unspent part, so death rungs cost nothing and never bank.
   */
  granted: MineConsumables;
  /**
   * Player mutations over pure generation, keyed "col,row" (Q-010):
   * dug cells, crack damage, ladders, planks, fallen boulders. This
   * map IS the persistent world (REQ-026): everything not in it
   * regenerates identically from the seed on read.
   */
  cells: Map<string, MineCell>;
  /** A lit dynamite charge waiting for the miner to step clear. */
  pendingDynamite?: PendingDynamite;
  miner: MinerState;
}

/** Serialized world mutations: the save format for client and server. */
export type WorldDiff = Array<[number, number, MineCell]>;

const cellKey = (col: number, row: number) => `${col},${row}`;

/** The world diff, sorted for deterministic serialization. */
function exportCells(cells: Map<string, MineCell>): WorldDiff {
  const entries: WorldDiff = [];
  for (const [key, cell] of cells) {
    const [col, row] = key.split(",").map(Number);
    if (row >= MINE_BOTTOM_ROW) continue;
    entries.push([col, row, { ...cell }]);
  }
  entries.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return entries;
}

export function exportDiff(state: MineState): WorldDiff {
  return exportCells(state.cells);
}

function importDiff(diff: WorldDiff | undefined): Map<string, MineCell> {
  const cells = new Map<string, MineCell>();
  if (diff) {
    for (const [col, row, cell] of diff) {
      if (row >= MINE_BOTTOM_ROW) continue;
      cells.set(cellKey(col, row), { ...cell });
    }
  }
  return cells;
}

/**
 * Buying rail through a carved support shaft returns those bought aids
 * to stock and removes them from the persistent world diff. The empty
 * shaft stays carved.
 */
export function refundRailSupportsInDiff(
  diff: WorldDiff,
  fromDepth: number,
  toDepth: number,
): {
  diff: WorldDiff;
  refunded: Partial<Record<"ladder" | "plank", number>>;
} {
  const cells = importDiff(diff);
  const refunded: Partial<Record<"ladder" | "plank", number>> = {};
  for (let row = Math.max(1, fromDepth + 1); row <= toDepth; row++) {
    const key = cellKey(ELEVATOR_COL, row);
    const cell = cells.get(key);
    if (!cell?.ladder && !cell?.plank) continue;
    const next = { ...cell };
    if (next.ladder) {
      delete next.ladder;
      refunded.ladder = (refunded.ladder ?? 0) + 1;
    }
    if (next.plank) {
      delete next.plank;
      refunded.plank = (refunded.plank ?? 0) + 1;
    }
    cells.set(key, next);
  }
  return { diff: exportCells(cells), refunded };
}

function batteryLevel(gear: MineGearSnapshot): number {
  return gear.battery ?? gear.lamp ?? 1;
}

export type DynamiteTier = 1 | 2 | 3 | 4;

export const DYNAMITE_TIERS = [1, 2, 3, 4] as const;

export function dynamiteTier(gear: Pick<MineGear, "blast">): DynamiteTier {
  const level = Math.floor(gear.blast ?? 1);
  if (level <= 1) return 1;
  if (level >= 4) return 4;
  return level as DynamiteTier;
}

/** Fill the current battery field for legacy gear snapshots. */
export function normalizeGear(gear: MineGearSnapshot): MineGear {
  return { ...gear, battery: batteryLevel(gear), blast: dynamiteTier(gear) };
}

/** Max robot battery charge for the session's gear. */
export function maxEnergy(gear: MineGear): number {
  return BATTERY_CHARGE[
    Math.min(batteryLevel(gear), BATTERY_CHARGE.length) - 1
  ];
}

/** Lantern reach for the session's gear. */
export function lightRadius(gear: MineGear): number {
  return LANTERN_RADIUS[Math.min(gear.lantern, LANTERN_RADIUS.length) - 1];
}

/** Ore chunks the hold takes for the session's gear. */
export function cargoCapacity(gear: MineGear): number {
  return CARGO_CAPACITY[Math.min(gear.cargo, CARGO_CAPACITY.length) - 1];
}

/** Unsupported fall distance the miner can survive before the landing kills. */
export function safeFallRows(gear: MineGear): number {
  return SAFE_FALL_ROWS[Math.min(gear.fall ?? 1, SAFE_FALL_ROWS.length) - 1];
}

/** Back-compat helper for older callers that only need the unlocked tier. */
export function blastRadius(gear: MineGear): number {
  return dynamiteTier(gear);
}

function dynamiteOreHarvestUnits(tier: DynamiteTier): number {
  return 8 * tier;
}

/** Credit value of everything currently carried (the bet on the table). */
export function carriedValue(miner: MinerState): number {
  let total = miner.carriedSalvageCredits;
  for (const [id, count] of Object.entries(miner.carried)) {
    total += oreDef(id as OreId).value * (count ?? 0);
  }
  return total;
}

/** Count of carried ore chunks (cargo, not value). */
export function carriedCount(miner: MinerState): number {
  let total = 0;
  for (const count of Object.values(miner.carried)) total += count ?? 0;
  return total;
}

/**
 * Pour an ore pile into the hold up to the cargo cap. Returns how many
 * chunks were taken and whatever overflowed (the caller decides where the
 * leftover lands). Shared by walk-over pickups and dynamite collection so
 * the fill-to-cap loop lives in one place; the running count avoids
 * re-summing the hold on every chunk.
 */
function fillHold(
  state: MineState,
  pile: Partial<Record<OreId, number>>,
): {
  taken: number;
  dropped: number;
  leftover: Partial<Record<OreId, number>>;
} {
  const miner = state.miner;
  const cap = cargoCapacity(state.gear);
  let carried = carriedCount(miner);
  let taken = 0;
  let dropped = 0;
  const leftover: Partial<Record<OreId, number>> = {};
  for (const [id, n] of Object.entries(pile) as Array<[OreId, number]>) {
    for (let i = 0; i < n; i++) {
      if (carried < cap) {
        miner.carried[id] = (miner.carried[id] ?? 0) + 1;
        carried++;
        taken++;
      } else {
        leftover[id] = (leftover[id] ?? 0) + 1;
        dropped++;
      }
    }
  }
  return { taken, dropped, leftover };
}

function subtractOrePiles(
  pile: Partial<Record<OreId, number>> | undefined,
  subtract: Partial<Record<OreId, number>> | undefined,
): Partial<Record<OreId, number>> {
  const next: Partial<Record<OreId, number>> = {};
  if (!pile) return next;
  for (const [id, count] of Object.entries(pile) as Array<[OreId, number]>) {
    const kept = Math.max(0, count - (subtract?.[id] ?? 0));
    if (kept > 0) next[id] = kept;
  }
  return next;
}

function intersectOrePiles(
  pile: Partial<Record<OreId, number>> | undefined,
  limit: Partial<Record<OreId, number>> | undefined,
): Partial<Record<OreId, number>> {
  const next: Partial<Record<OreId, number>> = {};
  if (!pile || !limit) return next;
  for (const [id, count] of Object.entries(pile) as Array<[OreId, number]>) {
    const kept = Math.min(count, limit[id] ?? 0);
    if (kept > 0) next[id] = kept;
  }
  return next;
}

function cleanOrePile(
  pile: Partial<Record<OreId, number>> | undefined,
): Partial<Record<OreId, number>> | undefined {
  if (!pile) return undefined;
  const next: Partial<Record<OreId, number>> = {};
  for (const [id, count] of Object.entries(pile) as Array<[OreId, number]>) {
    if (count > 0) next[id] = count;
  }
  return orePileCount(next) > 0 ? next : undefined;
}

function orePileCount(
  pile: Partial<Record<OreId, number>> | undefined,
): number {
  let total = 0;
  if (!pile) return total;
  for (const count of Object.values(pile)) total += count ?? 0;
  return total;
}

function mergeOrePiles(
  a: Partial<Record<OreId, number>> | undefined,
  b: Partial<Record<OreId, number>>,
): Partial<Record<OreId, number>> {
  const next: Partial<Record<OreId, number>> = { ...a };
  for (const [id, count] of Object.entries(b) as Array<[OreId, number]>) {
    if (count <= 0) continue;
    next[id] = (next[id] ?? 0) + count;
  }
  return next;
}

function fillHoldFromCellDrop(
  state: MineState,
  cell: MineCell,
): {
  taken: number;
  dropped: number;
  leftover: Partial<Record<OreId, number>>;
  deferredLeftover?: Partial<Record<OreId, number>>;
} {
  const deferred = cleanOrePile(
    intersectOrePiles(cell.drop, cell.dropDeferred),
  );
  if (!deferred) return fillHold(state, cell.drop ?? {});
  const immediate = subtractOrePiles(cell.drop, deferred);
  const immediateResult = fillHold(state, immediate);
  const deferredResult = fillHold(state, deferred);
  const leftover = mergeOrePiles(
    immediateResult.leftover,
    deferredResult.leftover,
  );
  return {
    taken: immediateResult.taken + deferredResult.taken,
    dropped: immediateResult.dropped + deferredResult.dropped,
    leftover,
    deferredLeftover: cleanOrePile(
      intersectOrePiles(deferredResult.leftover, deferred),
    ),
  };
}

function bagValue(bag: DroppedBag): number {
  let total = bag.salvageCredits;
  for (const [id, count] of Object.entries(bag.ores) as Array<
    [OreId, number]
  >) {
    total += oreDef(id).value * count;
  }
  return total;
}

function bagHasContents(bag: DroppedBag): boolean {
  return (
    orePileCount(bag.ores) > 0 || bag.salvageCredits > 0 || bag.parts.length > 0
  );
}

function droppedBagFromMiner(miner: MinerState): DroppedBag | undefined {
  const bag: DroppedBag = {
    ores: { ...miner.carried },
    salvageCredits: miner.carriedSalvageCredits,
    parts: [...miner.carriedParts],
  };
  return bagHasContents(bag) ? bag : undefined;
}

function dropBagAt(
  state: MineState,
  location: MineCoord,
  bag: DroppedBag | undefined,
): void {
  if (!bag || location.row < 1) return;
  const cell = cellMut(state, location.col, location.row);
  const existing = cell.bag;
  cell.bag = existing
    ? {
        ores: mergeOrePiles(existing.ores, bag.ores),
        salvageCredits: existing.salvageCredits + bag.salvageCredits,
        parts: [...existing.parts, ...bag.parts],
      }
    : {
        ores: { ...bag.ores },
        salvageCredits: bag.salvageCredits,
        parts: [...bag.parts],
      };
}

function dropBagToSurface(
  state: MineState,
  col: number,
  row: number,
  bag: DroppedBag,
): MineCoord {
  let rest = row;
  while (true) {
    const here = cellAt(state, col, rest);
    if (!here) break;
    if (here.kind !== "empty" || here.plank) break;
    const below = cellAt(state, col, rest + 1);
    if (below?.kind !== "empty" || below?.ladder) break;
    rest++;
  }
  const landing = { col, row: rest };
  dropBagAt(state, landing, bag);
  return landing;
}

function dropOreToSurface(
  state: MineState,
  col: number,
  row: number,
  pile: Partial<Record<OreId, number>>,
  deferred?: Partial<Record<OreId, number>>,
): number {
  const amount = orePileCount(pile);
  if (amount <= 0) return 0;
  let rest = row;
  while (true) {
    const here = cellAt(state, col, rest);
    if (!here) break;
    if (here.kind !== "empty" || here.plank) break;
    const below = cellAt(state, col, rest + 1);
    if (below?.kind !== "empty") break;
    rest++;
  }
  const landing = cellMut(state, col, rest);
  landing.drop = mergeOrePiles(landing.drop, pile);
  const cleanDeferred = cleanOrePile(deferred);
  if (cleanDeferred) {
    landing.dropDeferred = mergeOrePiles(landing.dropDeferred, cleanDeferred);
  }
  return amount;
}

function pickupAtMiner(state: MineState): {
  pickedUp?: number;
  pickedUpBag?: { value: number; parts: number };
} {
  const miner = state.miner;
  if (miner.row < 1) return {};
  const here = state.cells.get(cellKey(miner.col, miner.row));
  let pickedUp: number | undefined;
  let pickedUpBag: { value: number; parts: number } | undefined;
  if (here?.drop) {
    const { taken, dropped, leftover, deferredLeftover } = fillHoldFromCellDrop(
      state,
      here,
    );
    if (dropped > 0) here.drop = leftover;
    else delete here.drop;
    if (deferredLeftover) here.dropDeferred = deferredLeftover;
    else delete here.dropDeferred;
    if (taken > 0) pickedUp = taken;
  }
  if (here?.bag) {
    const startingBag = here.bag;
    const startingValue = bagValue(startingBag);
    const startingParts = startingBag.parts.length;
    const {
      taken,
      dropped: leftoverCount,
      leftover,
    } = fillHold(state, startingBag.ores);
    if (startingBag.salvageCredits > 0) {
      miner.carriedSalvageCredits += startingBag.salvageCredits;
    }
    if (startingParts > 0) miner.carriedParts.push(...startingBag.parts);
    const leftoverBag: DroppedBag = {
      ores: leftover,
      salvageCredits: 0,
      parts: [],
    };
    if (leftoverCount > 0) here.bag = leftoverBag;
    else delete here.bag;
    if (taken > 0) pickedUp = (pickedUp ?? 0) + taken;
    const recoveredValue = startingValue - bagValue(leftoverBag);
    if (recoveredValue > 0 || startingParts > 0) {
      pickedUpBag = { value: recoveredValue, parts: startingParts };
    }
    if (
      !here.bag &&
      miner.lostCargo?.col === miner.col &&
      miner.lostCargo.row === miner.row
    ) {
      miner.lostCargo = undefined;
    }
  }
  return { pickedUp, pickedUpBag };
}

function isOrePileSupported(
  state: MineState,
  col: number,
  row: number,
  cell: MineCell,
): boolean {
  if (cell.plank) return true;
  return cellAt(state, col, row + 1)?.kind !== "empty";
}

function isDroppedBagSupported(
  state: MineState,
  col: number,
  row: number,
  cell: MineCell,
): boolean {
  if (cell.plank) return true;
  const below = cellAt(state, col, row + 1);
  return !!below && (below.kind !== "empty" || below.ladder === true);
}

function settleUnsupportedDrops(state: MineState): void {
  const unsupported: Array<{
    col: number;
    row: number;
  }> = [];
  for (const [key, cell] of state.cells) {
    if ((!cell.drop && !cell.bag) || cell.kind !== "empty") continue;
    const [col, row] = key.split(",").map(Number);
    const dropUnsupported =
      cell.drop !== undefined && !isOrePileSupported(state, col, row, cell);
    const bagUnsupported =
      cell.bag !== undefined && !isDroppedBagSupported(state, col, row, cell);
    if (dropUnsupported || bagUnsupported) unsupported.push({ col, row });
  }
  unsupported.sort((a, b) => b.row - a.row || a.col - b.col);
  for (const { col, row } of unsupported) {
    const cell = cellAt(state, col, row);
    if (!cell || (!cell.drop && !cell.bag) || cell.kind !== "empty") continue;
    const dropUnsupported =
      cell.drop !== undefined && !isOrePileSupported(state, col, row, cell);
    const bagUnsupported =
      cell.bag !== undefined && !isDroppedBagSupported(state, col, row, cell);
    if (!dropUnsupported && !bagUnsupported) continue;
    const source = cellMut(state, col, row);
    const pile = dropUnsupported ? source.drop : undefined;
    const deferred = dropUnsupported ? source.dropDeferred : undefined;
    const bag = bagUnsupported ? source.bag : undefined;
    if (dropUnsupported) delete source.drop;
    if (dropUnsupported) delete source.dropDeferred;
    if (bagUnsupported) delete source.bag;
    if (pile) dropOreToSurface(state, col, row, pile, deferred);
    if (bag) {
      const landing = dropBagToSurface(state, col, row, bag);
      if (
        state.miner.lostCargo?.col === col &&
        state.miner.lostCargo.row === row
      ) {
        state.miner.lostCargo = {
          ...state.miner.lostCargo,
          col: landing.col,
          row: landing.row,
        };
      }
    }
  }
}

function isLadderSupported(
  state: MineState,
  col: number,
  row: number,
): boolean {
  const below = cellAt(state, col, row + 1);
  return !!below && (below.kind !== "empty" || below.ladder === true);
}

function mergeCoords(coords: MineCoord[]): MineCoord[] {
  const seen = new Set<string>();
  const merged: MineCoord[] = [];
  for (const coord of coords) {
    const key = `${coord.col},${coord.row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(coord);
  }
  return merged;
}

function ladderFallsOrUndefined(falls: LadderFall[]): LadderFall[] | undefined {
  return falls.length > 0 ? falls : undefined;
}

function combinedLadderFalls(
  existing: LadderFall[] | undefined,
  incoming: LadderFall[],
): LadderFall[] | undefined {
  if (!existing?.length) return ladderFallsOrUndefined(incoming);
  if (incoming.length === 0) return existing;
  return [...existing, ...incoming];
}

function settleUnsupportedLadders(
  state: MineState,
  changedSupports: MineCoord[],
): LadderFall[] {
  const candidates: MineCoord[] = [];
  for (const support of mergeCoords(changedSupports)) {
    for (let row = support.row - 1; row >= 1; row--) {
      const above = cellAt(state, support.col, row);
      if (!above?.ladder || above.kind !== "empty") break;
      candidates.push({ col: support.col, row });
    }
  }
  candidates.sort((a, b) => b.row - a.row || a.col - b.col);
  const falls: LadderFall[] = [];
  for (const { col, row } of mergeCoords(candidates)) {
    const source = cellAt(state, col, row);
    if (!source?.ladder || source.kind !== "empty") continue;
    if (isLadderSupported(state, col, row)) continue;
    let rest = row;
    while (true) {
      const below = cellAt(state, col, rest + 1);
      if (below?.kind !== "empty" || below?.ladder) break;
      rest++;
    }
    if (rest === row) continue;
    cellMut(state, col, row).ladder = undefined;
    cellMut(state, col, rest).ladder = true;
    falls.push({ from: { col, row }, to: { col, row: rest } });
  }
  return falls;
}

/**
 * Energy needed to climb straight home through a cleared shaft
 * (REQ-017): the trip-back decision should be a real call, not a guess.
 */
export function returnEnergyCost(miner: MinerState): number {
  return miner.row * MOVE_COST;
}

/**
 * Ladders still needed to climb straight home up the current column
 * (REQ-020). Same cleared-shaft assumption as returnEnergyCost: cells
 * already holding a ladder climb free, everything else needs one.
 */
export function returnLadderNeed(state: MineState): number {
  let need = 0;
  for (let r = 1; r <= state.miner.row; r++) {
    const cell = cellAt(state, state.miner.col, r);
    if (!(cell?.kind === "empty" && cell.ladder)) need++;
  }
  return need;
}

/**
 * Consumables that survive into the next session: purchased stock only.
 * Death-granted recovery rungs are free and do not bank, so the unspent
 * part of what was granted this trip is stripped off. The pool spends
 * granted stock first (used offsets granted), so whatever granted rungs
 * were not yet spent get subtracted from the leftover.
 */
export function carryoverConsumables(state: MineState): MineConsumables {
  const ladderFree = Math.max(0, state.granted.ladder - state.used.ladder);
  const plankFree = Math.max(0, state.granted.plank - state.used.plank);
  return {
    dynamite: state.consumables.dynamite,
    rope: state.consumables.rope,
    ladder: Math.max(0, state.consumables.ladder - ladderFree),
    plank: Math.max(0, state.consumables.plank - plankFree),
    beacon: state.consumables.beacon,
  };
}

/** The top rows never roll rock: the first digs always land. */
export const ROCK_FREE_ROWS = 2;
/** The top rows never roll hazards: the first lesson is gentle. */
export const HAZARD_FREE_ROWS = 4;

/**
 * Actions an undermined rock or boulder teeters before it drops
 * (REQ-015, user-directed 2026-06-14: "rocks fall a few seconds after
 * the dirt beneath them is mined away"). The delay is counted in player
 * actions, not wall-clock time, so the trip stays a pure function of
 * (seed, gear, actions) and the server replay still agrees. Two moves
 * of escalating tremble give the miner time to clear out or commit.
 */
export const FALL_DELAY_ACTIONS = 2;

function rollCell(seed: number, row: number, col: number): MineCell {
  const biome = biomeAt(col);
  // Depth scaling: rock, treasure, and hazards all grow with depth.
  const rockChance =
    row <= ROCK_FREE_ROWS ? 0 : Math.min(0.05 + row * 0.012, 0.35);
  const gasChance =
    row <= HAZARD_FREE_ROWS ? 0 : Math.min(0.003 + row * 0.0008, 0.025);
  // Magma seams (REQ-030): the deep pressure, three times the burn.
  const magmaChance =
    row < 56 ? 0 : Math.min(0.002 + (row - 56) * 0.0006, 0.02);
  const boulderChance =
    row <= HAZARD_FREE_ROWS ? 0 : Math.min(0.004 + row * 0.001, 0.03);
  const roll = cellRandom(seed, row, col, 0);
  if (roll < cacheChance(row)) return { kind: "part-cache" };
  let threshold = cacheChance(row);
  for (const id of oreIdsForBiome(biome)) {
    const ore = oreDef(id);
    threshold += oreChanceAt(ore, row);
    if (roll < threshold) return { kind: "ore", ore: ore.id };
  }
  threshold += gasChance;
  if (roll < threshold) return { kind: "gas" };
  threshold += magmaChance;
  if (roll < threshold) return { kind: "magma" };
  threshold += boulderChance;
  if (roll < threshold) return { kind: "boulder" };
  if (roll < threshold + rockChance)
    return { kind: "rock", rockTier: rockTierAt(row) };
  return { kind: "dirt" };
}

function cacheChance(row: number): number {
  return Math.min(0.004 + row * 0.0012, 0.03);
}

/** Pristine cell for coordinates the player never touched. */
function generatedCell(seed: number, col: number, row: number): MineCell {
  if (row === 0) return { kind: "empty" };
  if (row === MINE_BOTTOM_ROW) return { kind: "metal" };
  return rollCell(seed, row, col);
}

export function createMine(
  seed: number,
  gear: MineGear = DEFAULT_GEAR,
  consumables: MineConsumables = NO_CONSUMABLES,
  diff?: WorldDiff,
): MineState {
  return {
    seed,
    gear,
    // Trips start with exactly the purchased/carried stock: no free
    // ladders or planks here anymore. The only free rungs come from
    // dying (see collapse), which tops the live stock up to the floor.
    consumables: { ...consumables },
    used: { dynamite: 0, rope: 0, ladder: 0, plank: 0, beacon: 0 },
    granted: { dynamite: 0, rope: 0, ladder: 0, plank: 0, beacon: 0 },
    cells: importDiff(diff),
    miner: {
      col: START_COL,
      row: 0,
      energy: maxEnergy(gear),
      carried: {},
      carriedSalvageCredits: 0,
      carriedParts: [],
      bankedCredits: 0,
      bankedParts: [],
      lastSoldHaul: undefined,
      maxDepth: 0,
      collapses: 0,
      lostCargo: undefined,
    },
  };
}

/**
 * Read a cell. Pristine cells are regenerated per call: do not mutate
 * the result; mutate through cellMut so the change joins the diff.
 */
export function cellAt(
  state: MineState,
  col: number,
  row: number,
): MineCell | null {
  if (row < 0) return null;
  if (row > MINE_BOTTOM_ROW) return null;
  if (row === MINE_BOTTOM_ROW) return { kind: "metal" };
  return (
    state.cells.get(cellKey(col, row)) ?? generatedCell(state.seed, col, row)
  );
}

/** Materialize a cell into the diff and return the stored object. */
function cellMut(state: MineState, col: number, row: number): MineCell {
  if (row >= MINE_BOTTOM_ROW) return { kind: "metal" };
  const key = cellKey(col, row);
  let cell = state.cells.get(key);
  if (!cell) {
    cell = generatedCell(state.seed, col, row);
    state.cells.set(key, cell);
  }
  return cell;
}

/** Overwrite a cell (also the test hook for fabricating scenarios). */
export function setCell(
  state: MineState,
  col: number,
  row: number,
  cell: MineCell,
): void {
  if (row >= MINE_BOTTOM_ROW) return;
  state.cells.set(cellKey(col, row), cell);
}

export type Direction = "down" | "left" | "right" | "up";

function target(
  state: MineState,
  dir: Direction,
): { col: number; row: number } {
  const { col, row } = state.miner;
  switch (dir) {
    case "down":
      return { col, row: row + 1 };
    case "up":
      return { col, row: row - 1 };
    case "left":
      return { col: col - 1, row };
    case "right":
      return { col: col + 1, row };
  }
}

function isPendingDynamiteAt(
  state: MineState,
  col: number,
  row: number,
): boolean {
  return (
    state.pendingDynamite?.col === col && state.pendingDynamite.row === row
  );
}

function hasDynamiteGap(state: MineState, charge: PendingDynamite): boolean {
  return (
    Math.abs(state.miner.col - charge.col) +
      Math.abs(state.miner.row - charge.row) >=
    1
  );
}

export type MoveResult =
  | {
      ok: true;
      dug: CellKind | null;
      /** Set when dug was an ore cell. */
      dugOre: OreId | null;
      /** Ore units mined on the final cell-clearing swing. */
      dugOreCount?: number;
      /** Ore units mined by this swing before cargo overflow. */
      oreHarvested?: {
        ore: OreId;
        units: number;
        dropped?: number;
        remaining: number;
      };
      found: string | null;
      collapsed: boolean;
      /** A falling boulder ended the trip (carry lost). */
      crushed?: boolean;
      /** This action started at least one falling-rock countdown. */
      fallingRockTriggered?: boolean;
      /** Placed ladders that settled after a support changed. */
      ladderFalls?: LadderFall[];
      /** Gas pockets vented by this action (robot battery charge burned). */
      vented?: number;
      /** Cells destroyed by a dynamite blast. */
      blasted?: number;
      /** Ore chunks a dynamite blast collected into the hold. */
      collected?: number;
      /** Ore chunks left on the floor because the hold was full. */
      dropped?: number;
      /** Parts a dynamite blast cracked out of caches in range. */
      foundParts?: string[];
      /** A dynamite charge was placed and is waiting for space. */
      dynamitePlanted?: PendingDynamite;
      /** Center cell of a delayed dynamite explosion. */
      exploded?: PendingDynamite;
      /** Ore chunks scooped by walking over a floor drop. */
      pickedUp?: number;
      /** Dropped bag contents scooped by walking over the collapse cell. */
      pickedUpBag?: { value: number; parts: number };
      /** Ore chunks manually dropped from the carried bag. */
      droppedFromBag?: number;
      /** A recall rope ended the trip from below (carry banked). */
      recalled?: boolean;
      /** The trip was voluntarily abandoned (carry forfeited). */
      abandoned?: boolean;
      /** This climb consumed and placed a new ladder (REQ-020). */
      laddered?: boolean;
      /** This step consumed and placed a new plank bridge (legacy). */
      planked?: boolean;
      /** Unsupported movement dropped the miner down empty cells. */
      fell?: number;
      /** The unsupported fall exceeded the gear's safe fall distance. */
      fallFatal?: boolean;
      /** A planted ladder was salvaged from the current cell. */
      collectedLadder?: boolean;
      /** This action placed a plank in the facing cell. */
      plankPlaced?: { col: number; row: number };
      /** Placed supports and beacons salvaged from the world. */
      supportCollected?: Partial<Record<SalvageablePlacement, number>>;
      /** Vibe value added to carried salvage by support pickup. */
      supportSalvageValue?: number;
      /** The swing damaged but did not break the block (REQ-013). */
      cracked?: { kind: CellKind; remaining: number };
      /** The swing damaged but did not break a placed plank. */
      plankCracked?: { remaining: number };
      /** What a collapse/crush cost, for the near-miss reveal (REQ-019). */
      lost?: { value: number; parts: string[]; col: number; row: number };
    }
  | {
      ok: false;
      reason:
        | "blocked"
        | "edge"
        | "rock"
        | "hold-full"
        | "no-dynamite"
        | "no-rope"
        | "no-ladder"
        | "no-plank"
        | "no-elevator"
        | "no-beacon"
        | "out-of-range"
        | "surface";
    };

type BaseMineAction =
  | Direction
  | "dynamite-1"
  | "dynamite-2"
  | "dynamite-3"
  | "dynamite-4"
  | "plank-left"
  | "plank-right"
  | "recall"
  | "abandon"
  | "ride-down"
  | "ride-up"
  | "place-beacon"
  | "collect-ladder"
  | "warp-home"
  | "warp-down";

export type CollectTarget = {
  type: SalvageablePlacement;
  col: number;
  row: number;
};

export function isSupportSalvageTarget(
  state: MineState,
  col: number,
  row: number,
): boolean {
  return (
    Math.abs(col - state.miner.col) <= 1 && Math.abs(row - state.miner.row) <= 1
  );
}

/**
 * The full trip action vocabulary (Q-006 default B): plain directions
 * dig and move; dynamite tokens select a tier; plank tokens act toward a
 * direction; collect tokens pick placed traversal supports back up by
 * coordinate.
 */
export type MineAction =
  | BaseMineAction
  | `collect:${string}`
  | `drop:${string}`
  | `activate-portal:${PortalBeaconId}`
  | `portal-warp:${PortalTargetId}`
  | `warp-down:${number},${number}`
  | `rename-beacon:${number},${number},${string}`;

export const MINE_ACTIONS = [
  "down",
  "up",
  "left",
  "right",
  "dynamite-1",
  "dynamite-2",
  "dynamite-3",
  "dynamite-4",
  "plank-left",
  "plank-right",
  "recall",
  "abandon",
  "ride-down",
  "ride-up",
  "place-beacon",
  "collect-ladder",
  "warp-home",
  "warp-down",
] as const satisfies readonly BaseMineAction[];

const BASE_MINE_ACTIONS: ReadonlySet<string> = new Set(MINE_ACTIONS);

export function collectAction(targets: readonly CollectTarget[]): MineAction {
  const parts = [...targets]
    .sort(
      (a, b) => a.row - b.row || a.col - b.col || a.type.localeCompare(b.type),
    )
    .map((target) => `${target.type}:${target.col},${target.row}`);
  return `collect:${parts.join(";")}`;
}

function parseCollectAction(action: string): CollectTarget[] | null {
  if (!action.startsWith("collect:")) return null;
  const raw = action.slice("collect:".length);
  if (!raw) return null;
  const targets: CollectTarget[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(";")) {
    const match = /^(ladder|plank|beacon):(-?\d+),(-?\d+)$/.exec(part);
    if (!match) return null;
    const type = match[1] as SalvageablePlacement;
    const col = Number(match[2]);
    const row = Number(match[3]);
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row) || row < 0)
      return null;
    const key = `${type}:${col},${row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ type, col, row });
  }
  return targets;
}

function parseDropOreAction(
  action: string,
): Partial<Record<OreId, number>> | null {
  if (!action.startsWith("drop:")) return null;
  const raw = action.slice("drop:".length);
  if (!raw) return null;
  const pile: Partial<Record<OreId, number>> = {};
  for (const part of raw.split(";")) {
    const [id, countText] = part.split(":");
    if (!id || !countText || !ORE_BY_ID.has(id as OreId)) return null;
    const count = Number(countText);
    if (!Number.isSafeInteger(count) || count <= 0) return null;
    pile[id as OreId] = (pile[id as OreId] ?? 0) + count;
  }
  return orePileCount(pile) > 0 ? pile : null;
}

function parseActivatePortalAction(action: string): PortalBeaconId | null {
  const match = /^activate-portal:(winter|highTech)$/.exec(action);
  return match ? (match[1] as PortalBeaconId) : null;
}

function parsePortalWarpAction(action: string): PortalTargetId | null {
  const match = /^portal-warp:(base|winter|highTech)$/.exec(action);
  return match ? (match[1] as PortalTargetId) : null;
}

export function activatePortalAction(id: PortalBeaconId): MineAction {
  return `activate-portal:${id}`;
}

export function portalWarpAction(target: PortalTargetId): MineAction {
  return `portal-warp:${target}`;
}

function parseWarpDownAction(
  action: string,
): { col: number; row: number } | null {
  const match = /^warp-down:(-?\d+),(-?\d+)$/.exec(action);
  if (!match) return null;
  const col = Number(match[1]);
  const row = Number(match[2]);
  if (
    !Number.isSafeInteger(col) ||
    !Number.isSafeInteger(row) ||
    row < 1 ||
    row >= MINE_BOTTOM_ROW
  )
    return null;
  return { col, row };
}

function parseRenameBeaconAction(
  action: string,
): { col: number; row: number; label: string } | null {
  const match = /^rename-beacon:(-?\d+),(-?\d+),(.*)$/.exec(action);
  if (!match) return null;
  const col = Number(match[1]);
  const row = Number(match[2]);
  if (
    !Number.isSafeInteger(col) ||
    !Number.isSafeInteger(row) ||
    row < 1 ||
    row >= MINE_BOTTOM_ROW
  )
    return null;
  try {
    return {
      col,
      row,
      label: normalizeBeaconLabel(decodeURIComponent(match[3] ?? "")),
    };
  } catch {
    return null;
  }
}

export function renameBeaconAction(
  target: { col: number; row: number },
  label: string,
): MineAction {
  return `rename-beacon:${target.col},${target.row},${encodeURIComponent(
    normalizeBeaconLabel(label),
  )}`;
}

export function dropOreAction(
  pile: Partial<Record<OreId, number>>,
): MineAction {
  const parts = ORES.map((ore) => {
    const count = pile[ore.id] ?? 0;
    return count > 0 ? `${ore.id}:${count}` : "";
  }).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("dropOreAction requires at least one ore");
  }
  return `drop:${parts.join(";")}`;
}

export function isMineAction(action: string): action is MineAction {
  return (
    BASE_MINE_ACTIONS.has(action) ||
    parseCollectAction(action) !== null ||
    parseDropOreAction(action) !== null ||
    parseActivatePortalAction(action) !== null ||
    parsePortalWarpAction(action) !== null ||
    parseWarpDownAction(action) !== null ||
    parseRenameBeaconAction(action) !== null
  );
}

/** Blast-destructible kinds (caches are reinforced; jackpots survive). */
const BLASTABLE: ReadonlySet<CellKind> = new Set([
  "dirt",
  "ore",
  "rock",
  "boulder",
]);

/**
 * Detonates every gas cell 4-adjacent to (col, row), chaining through
 * gas caught in each plus-shaped blast. Returns the number of pockets
 * vented. Destroyed cells (including their loot) become empty.
 */
function ventGasAround(
  state: MineState,
  col: number,
  row: number,
  emptied: Array<{ col: number; row: number }>,
): number {
  const queue: Array<{ col: number; row: number }> = [];
  for (const [dc, dr] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const) {
    const cell = cellAt(state, col + dc, row + dr);
    if (cell?.kind === "gas" || cell?.kind === "magma")
      queue.push({ col: col + dc, row: row + dr });
  }
  let vented = 0;
  while (queue.length > 0) {
    const g = queue.pop();
    if (!g) break;
    const gasCell = cellAt(state, g.col, g.row);
    if (gasCell?.kind !== "gas" && gasCell?.kind !== "magma") continue;
    setCell(state, g.col, g.row, { kind: "empty" });
    emptied.push({ col: g.col, row: g.row });
    // Magma burns triple: it counts as three gas-equivalent vents.
    vented += gasCell.kind === "magma" ? 3 : 1;
    for (const [dc, dr] of [
      [0, 0],
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      const nc = g.col + dc;
      const nr = g.row + dr;
      if (nr < 1 || nr >= MINE_BOTTOM_ROW) continue;
      const n = cellAt(state, nc, nr);
      if (!n) continue;
      if (n.kind === "gas" || n.kind === "magma")
        queue.push({ col: nc, row: nr });
      else if (BLASTABLE.has(n.kind)) {
        setCell(state, nc, nr, { kind: "empty" });
        emptied.push({ col: nc, row: nr });
      }
    }
  }
  return vented;
}

/**
 * Advances every teetering block's countdown by one action; any that
 * reach zero drop until they rest on something solid (REQ-015). The result
 * carries the resting cell when a dropping block passed through or landed on
 * the miner, so the dropped bag can sit on top of the fallen block.
 * Bottom-up per column keeps stacked blocks deterministic.
 */
function tickFalls(
  state: MineState,
  emptied: Array<{ col: number; row: number }>,
): { crushed: boolean; crushRest?: MineCoord } {
  const miner = state.miner;
  let crushed = false;
  let crushRest: MineCoord | undefined;
  // Only override cells teeter (pristine cells never do), so the scan is
  // bounded by the teeter count. Decrement every countdown; the ones
  // that reach zero fall this action. Sort bottom-up, then by column, so
  // stacked blocks settle deterministically regardless of insertion order.
  const dropping: Array<MineCoord & { cell: MineCell }> = [];
  for (const [key, cell] of state.cells) {
    if (cell.fallIn === undefined) continue;
    cell.fallIn -= 1;
    if (cell.fallIn > 0) continue;
    const [col, row] = key.split(",").map(Number);
    dropping.push({ col, row, cell });
  }
  dropping.sort((a, b) => b.row - a.row || a.col - b.col);
  for (const { col, row, cell } of dropping) {
    let rest = row;
    while (true) {
      const below = cellAt(state, col, rest + 1);
      if (below?.kind !== "empty") break;
      rest++;
    }
    const crushedByThisBlock =
      miner.col === col && miner.row >= row && miner.row <= rest;
    setCell(state, col, row, { kind: "empty" });
    emptied.push({ col, row });
    // The block relocates intact. The teeter resets and crack damage is
    // shaken off, while the current row defines the pickaxe gate.
    const placed: MineCell = { kind: cell.kind };
    if (cell.kind === "rock") placed.rockTier = rockTierAt(rest);
    if (cell.kind === "rock" || cell.kind === "boulder") placed.fallen = true;
    setCell(state, col, rest, placed);
    if (crushedByThisBlock) {
      crushed = true;
      crushRest ??= { col, row: rest };
    }
  }
  return { crushed, crushRest };
}

function isMinerSupported(state: MineState): boolean {
  const miner = state.miner;
  if (miner.row === 0) return true;
  const here = cellAt(state, miner.col, miner.row);
  const below = cellAt(state, miner.col, miner.row + 1);
  return !!(
    here?.ladder ||
    here?.plank ||
    below?.ladder ||
    (below && below.kind !== "empty")
  );
}

function settleMiner(state: MineState): number {
  const miner = state.miner;
  let fell = 0;
  while (!isMinerSupported(state)) {
    const below = cellAt(state, miner.col, miner.row + 1);
    if (below?.kind !== "empty") break;
    miner.row++;
    fell++;
  }
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
  return fell;
}

function isFatalMinerFall(state: MineState, fell: number): boolean {
  return fell > safeFallRows(state.gear);
}

function minerLostCargo(
  miner: MinerState,
  location: MineCoord = miner,
): {
  value: number;
  parts: string[];
  col: number;
  row: number;
} {
  const bag = droppedBagFromMiner(miner);
  return {
    value: bag ? bagValue(bag) : 0,
    parts: bag ? [...bag.parts] : [],
    col: location.col,
    row: location.row,
  };
}

/**
 * Rock and boulders whose support vanished start a fall countdown
 * (REQ-015): they teeter for FALL_DELAY_ACTIONS actions, then drop.
 * Localized: only cells directly above this action's emptied cells can
 * have lost support. Blocks in the hazard-free top rows never fall, so
 * the first lesson stays gentle.
 */
function markUnstable(
  state: MineState,
  emptied: Array<{ col: number; row: number }>,
): boolean {
  let triggered = false;
  for (const { col, row } of emptied) {
    const blockRow = row - 1;
    if (blockRow <= HAZARD_FREE_ROWS) continue;
    const above = cellAt(state, col, blockRow);
    if (!above || (above.kind !== "rock" && above.kind !== "boulder")) continue;
    if (above.fallIn !== undefined) continue;
    if (cellAt(state, col, row)?.kind === "empty") {
      cellMut(state, col, blockRow).fallIn = FALL_DELAY_ACTIONS;
      triggered = true;
    }
  }
  return triggered;
}

function isFallingRock(cell: MineCell): boolean {
  return (
    (cell.kind === "rock" || cell.kind === "boulder") &&
    (cell.fallIn !== undefined || cell.fallen === true)
  );
}

function rockTierForDig(cell: MineCell, row: number): number {
  return isFallingRock(cell)
    ? rockTierAt(row)
    : (cell.rockTier ?? rockTierAt(row));
}

function digKindFor(cell: MineCell): CellKind {
  return isFallingRock(cell) ? "rock" : cell.kind;
}

function settleAfterEmptied(
  state: MineState,
  emptied: Array<{ col: number; row: number }>,
  changedSupports: MineCoord[] = [],
): { fallingRockTriggered: boolean; ladderFalls: LadderFall[] } {
  const fallingRockTriggered = markUnstable(state, emptied);
  const ladderFalls = settleUnsupportedLadders(state, [
    ...emptied,
    ...changedSupports,
  ]);
  settleUnsupportedDrops(state);
  return { fallingRockTriggered, ladderFalls };
}

/**
 * Dig toward or move into the adjacent cell. Dirt/ore/cache cells are
 * dug (cost + loot); empty cells are walked into; rock needs the
 * pickaxe tier for its depth (REQ-013) and costs more energy to cut;
 * a full cargo hold spills dug ore onto the nearest surface (REQ-014);
 * moving up
 * works only through already-dug cells AND needs a ladder in the cell
 * being climbed from (REQ-020): one is consumed and placed on first
 * climb, then the shaft climbs free until something smashes it.
 */
export function step(state: MineState, dir: Direction): MoveResult {
  const miner = state.miner;
  if (dir === "down" && cellAt(state, miner.col, miner.row)?.plank)
    return breakCurrentPlank(state);
  const t = target(state, dir);
  if (isPendingDynamiteAt(state, t.col, t.row))
    return { ok: false, reason: "blocked" };
  const cell = cellAt(state, t.col, t.row);
  if (!cell) return { ok: false, reason: "edge" };
  const isRockLike = cell.kind === "rock" || isFallingRock(cell);
  if (isRockLike && !canDigRock(state.gear, rockTierForDig(cell, t.row)))
    return { ok: false, reason: "rock" };
  if (
    cell.kind === "metal" ||
    (cell.kind === "boulder" && !isFallingRock(cell)) ||
    cell.kind === "gas" ||
    cell.kind === "magma"
  )
    return { ok: false, reason: "blocked" };
  if (dir === "up" && cell.kind !== "empty")
    return { ok: false, reason: "blocked" };
  if (cell.kind === "ore" && cell.ore) {
    const ore = cell.ore;
    const struck = cellMut(state, t.col, t.row);
    const current = struck.oreRemaining ?? oreReserveAt(ore, t.row);
    const units = oreSwingYield(
      state.seed,
      state.gear,
      ore,
      t.row,
      t.col,
      current,
    );
    const spent = Math.max(1, units);
    const remaining = current - spent;
    const { dropped: spilled, leftover } =
      units > 0
        ? fillHold(state, { [ore]: units })
        : { dropped: 0, leftover: {} };
    const dropped = spilled;
    const emptied: Array<{ col: number; row: number }> = [];
    if (remaining > 0) {
      struck.oreRemaining = remaining;
      delete struck.hp;
      if (spilled > 0) struck.drop = mergeOrePiles(struck.drop, leftover);
    } else {
      const emptyCell: MineCell = cell.plank
        ? { kind: "empty", plank: true }
        : { kind: "empty" };
      const preservedDrop = mergeOrePiles(struck.drop, leftover);
      if (orePileCount(preservedDrop) > 0) emptyCell.drop = preservedDrop;
      setCell(state, t.col, t.row, emptyCell);
      emptied.push({ col: t.col, row: t.row });
    }
    const vented =
      remaining <= 0 ? ventGasAround(state, t.col, t.row, emptied) : 0;
    miner.energy = Math.max(
      0,
      miner.energy - swingCostFor("ore") - vented * GAS_VENT_DRAIN,
    );
    if (remaining <= 0) {
      miner.col = t.col;
      miner.row = t.row;
      if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
    }
    const fallTick = tickFalls(state, emptied);
    const settled = settleAfterEmptied(state, emptied);
    const fell = settleMiner(state);
    const fellTooFar = isFatalMinerFall(state, fell);
    const oreHarvested = {
      ore,
      units,
      dropped: dropped > 0 ? dropped : undefined,
      remaining: Math.max(0, remaining),
    };
    if (
      fallTick.crushed ||
      fellTooFar ||
      (miner.row > 0 && miner.energy <= 0)
    ) {
      const lost = minerLostCargo(miner, fallTick.crushRest);
      collapse(state, true, lost);
      return {
        ok: true,
        dug: remaining <= 0 ? "ore" : null,
        dugOre: remaining <= 0 ? ore : null,
        dugOreCount: remaining <= 0 ? units : undefined,
        oreHarvested: units > 0 ? oreHarvested : undefined,
        found: null,
        collapsed: true,
        crushed: fallTick.crushed || fellTooFar,
        fallingRockTriggered: settled.fallingRockTriggered || undefined,
        ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
        vented,
        dropped: dropped > 0 ? dropped : undefined,
        fell: fell || undefined,
        fallFatal: fellTooFar || undefined,
        lost,
      };
    }
    return maybeExplodePendingDynamite(state, {
      ok: true,
      dug: remaining <= 0 ? "ore" : null,
      dugOre: remaining <= 0 ? ore : null,
      dugOreCount: remaining <= 0 ? units : undefined,
      oreHarvested: units > 0 ? oreHarvested : undefined,
      found: null,
      collapsed: false,
      crushed: fallTick.crushed,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
      vented,
      dropped: dropped > 0 ? dropped : undefined,
      fell: fell || undefined,
      cracked:
        remaining > 0
          ? { kind: "ore", remaining: Math.max(0, remaining) }
          : undefined,
    });
  }
  // Multi-hit digging (REQ-013): a solid cell soaks swings before it
  // breaks; only the breaking swing moves the miner and yields loot.
  // Every swing is its own logged action and burns battery charge, so a
  // dig can still collapse the trip mid-block.
  if (cell.kind !== "empty") {
    const struck = cellMut(state, t.col, t.row);
    const kindForDig = digKindFor(struck);
    const remaining = (struck.hp ?? hitsFor(kindForDig, state.gear)) - 1;
    if (remaining > 0) {
      struck.hp = remaining;
      miner.energy = Math.max(0, miner.energy - swingCostFor(kindForDig));
      // A swing is a full action: teetering blocks count down and drop,
      // and the battery can still run out mid-block.
      const emptiedMid: Array<{ col: number; row: number }> = [];
      const fallTickMid = tickFalls(state, emptiedMid);
      const settledMid = settleAfterEmptied(state, emptiedMid);
      const fellMid = settleMiner(state);
      const fellTooFarMid = isFatalMinerFall(state, fellMid);
      if (
        fallTickMid.crushed ||
        fellTooFarMid ||
        (miner.row > 0 && miner.energy <= 0)
      ) {
        const lost = minerLostCargo(miner, fallTickMid.crushRest);
        collapse(state, true, lost);
        return {
          ok: true,
          dug: null,
          dugOre: null,
          found: null,
          collapsed: true,
          crushed: fallTickMid.crushed || fellTooFarMid,
          fallingRockTriggered: settledMid.fallingRockTriggered || undefined,
          ladderFalls: ladderFallsOrUndefined(settledMid.ladderFalls),
          fell: fellMid || undefined,
          fallFatal: fellTooFarMid || undefined,
          lost,
        };
      }
      return maybeExplodePendingDynamite(state, {
        ok: true,
        dug: null,
        dugOre: null,
        found: null,
        collapsed: false,
        fallingRockTriggered: settledMid.fallingRockTriggered || undefined,
        ladderFalls: ladderFallsOrUndefined(settledMid.ladderFalls),
        fell: fellMid || undefined,
        cracked: { kind: kindForDig, remaining },
      });
    }
  }
  let laddered = false;
  if (dir === "up" && miner.row >= 1) {
    const here = cellMut(state, miner.col, miner.row);
    if (!here.ladder) {
      if (state.consumables.ladder <= 0)
        return { ok: false, reason: "no-ladder" };
      if (isOnElevatorRail(state)) return { ok: false, reason: "blocked" };
      state.consumables.ladder--;
      state.used.ladder++;
      here.ladder = true;
      laddered = true;
    }
  }
  // Lateral steps never auto-spend planks anymore (REQ-022). A placed
  // plank or ladder support prevents falling; otherwise the move is still
  // legal and deterministic gravity drops the miner after the move.

  let dug: CellKind | null = null;
  let dugOre: OreId | null = null;
  let dugOreCount: number | undefined;
  let found: string | null = null;
  let cost = MOVE_COST;
  let vented = 0;
  let dropped = 0;
  const emptied: Array<{ col: number; row: number }> = [];
  if (cell.kind !== "empty") {
    const kindForDig = digKindFor(cell);
    dug = kindForDig;
    cost = swingCostFor(kindForDig);
    let overflowPile: Partial<Record<OreId, number>> | undefined;
    if (cell.kind === "ore" && cell.ore) {
      const units = oreUnitsAt(t.row);
      const { dropped: spilled, leftover } = fillHold(state, {
        [cell.ore]: units,
      });
      dugOre = cell.ore;
      dugOreCount = units;
      if (spilled > 0) overflowPile = leftover;
    }
    if (cell.kind === "part-cache") {
      found = rollCachePart(state, t.col, t.row);
      miner.carriedParts.push(found);
    }
    setCell(
      state,
      t.col,
      t.row,
      cell.plank ? { kind: "empty", plank: true } : { kind: "empty" },
    );
    emptied.push({ col: t.col, row: t.row });
    if (overflowPile) {
      dropped += dropOreToSurface(state, t.col, t.row, overflowPile);
    }
    // Digging next to a pocket vents it: the burn taxes the robot battery.
    vented = ventGasAround(state, t.col, t.row, emptied);
  }

  const planked = false;

  miner.energy = Math.max(0, miner.energy - cost - vented * GAS_VENT_DRAIN);
  miner.col = t.col;
  miner.row = t.row;
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;

  const fallTick = tickFalls(state, emptied);
  const settled = settleAfterEmptied(state, emptied);
  const fell = settleMiner(state);
  const fellTooFar = isFatalMinerFall(state, fell);
  const { pickedUp, pickedUpBag } = pickupAtMiner(state);

  let collapsed = false;
  let lost: { value: number; parts: string[]; col: number; row: number };
  if (fallTick.crushed || fellTooFar || (miner.row > 0 && miner.energy <= 0)) {
    lost = minerLostCargo(miner, fallTick.crushRest);
    collapse(state, true, lost);
    collapsed = true;
    return {
      ok: true,
      dug,
      dugOre,
      dugOreCount,
      found,
      collapsed,
      crushed: fallTick.crushed || fellTooFar,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
      vented,
      dropped: dropped > 0 ? dropped : undefined,
      laddered,
      planked,
      fell: fell || undefined,
      fallFatal: fellTooFar || undefined,
      lost,
    };
  }
  if (miner.row === 0) {
    bank(miner, state.gear);
  }
  return maybeExplodePendingDynamite(state, {
    ok: true,
    dug,
    dugOre,
    dugOreCount,
    found,
    collapsed,
    crushed: fallTick.crushed,
    fallingRockTriggered: settled.fallingRockTriggered || undefined,
    ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    vented,
    dropped: dropped > 0 ? dropped : undefined,
    laddered,
    planked,
    fell: fell || undefined,
    pickedUp,
    pickedUpBag,
  });
}

function isOnElevatorRail(state: MineState): boolean {
  const rail = Math.min(state.gear.elevator, MINE_BOTTOM_ROW - 1);
  return (
    rail > 0 &&
    state.miner.col === ELEVATOR_COL &&
    state.miner.row >= 0 &&
    state.miner.row <= rail
  );
}

export function canPlacePlank(
  state: MineState,
  dir: "left" | "right",
): boolean {
  return plankPlacementTarget(state, dir).ok;
}

type MoveFailureReason = Extract<MoveResult, { ok: false }>["reason"];

function plankPlacementTarget(
  state: MineState,
  dir: "left" | "right",
):
  | { ok: true; col: number; row: number }
  | { ok: false; reason: MoveFailureReason } {
  if (state.consumables.plank <= 0) return { ok: false, reason: "no-plank" };
  if (isOnElevatorRail(state)) return { ok: false, reason: "blocked" };
  const t = target(state, dir);
  if (t.row < 1) return { ok: false, reason: "surface" };
  const cell = cellAt(state, t.col, t.row);
  if (cell?.kind === "metal") return { ok: false, reason: "blocked" };
  const below = cellAt(state, t.col, t.row + 1);
  if (!cell || !below) return { ok: false, reason: "edge" };
  if (cell.ladder || cell.plank || below.kind !== "empty")
    return { ok: false, reason: "blocked" };
  if (cell.kind === "boulder" || cell.kind === "gas" || cell.kind === "magma")
    return { ok: false, reason: "blocked" };
  return { ok: true, col: t.col, row: t.row };
}

function finishStationaryAction(
  state: MineState,
  base: Extract<MoveResult, { ok: true }>,
  changedSupports: MineCoord[] = [],
): MoveResult {
  const emptied: Array<{ col: number; row: number }> = [];
  const fallTick = tickFalls(state, emptied);
  const settled = settleAfterEmptied(state, emptied, changedSupports);
  const fell = settleMiner(state);
  const fellTooFar = isFatalMinerFall(state, fell);
  if (fallTick.crushed || fellTooFar) {
    const lost = minerLostCargo(state.miner, fallTick.crushRest);
    collapse(state, true, lost);
    return {
      ...base,
      collapsed: true,
      crushed: true,
      fallingRockTriggered:
        base.fallingRockTriggered || settled.fallingRockTriggered || undefined,
      ladderFalls: combinedLadderFalls(base.ladderFalls, settled.ladderFalls),
      fell: fell || undefined,
      fallFatal: fellTooFar || undefined,
      lost,
    };
  }
  return maybeExplodePendingDynamite(state, {
    ...base,
    fallingRockTriggered:
      base.fallingRockTriggered || settled.fallingRockTriggered || undefined,
    ladderFalls: combinedLadderFalls(base.ladderFalls, settled.ladderFalls),
    fell: fell || base.fell,
  });
}

function placePlank(state: MineState, dir: "left" | "right"): MoveResult {
  const placement = plankPlacementTarget(state, dir);
  if (!placement.ok) return placement;
  state.consumables.plank--;
  state.used.plank++;
  cellMut(state, placement.col, placement.row).plank = true;
  return finishStationaryAction(state, {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    plankPlaced: { col: placement.col, row: placement.row },
  });
}

function breakCurrentPlank(state: MineState): MoveResult {
  const miner = state.miner;
  const cell = cellAt(state, miner.col, miner.row);
  if (!cell?.plank) return { ok: false, reason: "blocked" };
  miner.energy = Math.max(0, miner.energy - MOVE_COST);
  const current = cellMut(state, miner.col, miner.row);
  const remaining = (current.plankHp ?? PLANK_HITS) - 1;
  if (remaining > 0) {
    current.plankHp = remaining;
    const base = {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      plankCracked: { remaining },
    } satisfies Extract<MoveResult, { ok: true }>;
    if (miner.row > 0 && miner.energy <= 0) {
      const lost = minerLostCargo(miner);
      collapse(state, true, lost);
      return {
        ...base,
        collapsed: true,
        lost,
      };
    }
    return finishStationaryAction(state, base);
  }
  current.plank = undefined;
  current.plankHp = undefined;
  const salvageValue = salvageSupport(state, "plank");
  const base = {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    supportCollected: { plank: 1 },
    supportSalvageValue: salvageValue,
  } satisfies Extract<MoveResult, { ok: true }>;
  if (miner.row > 0 && miner.energy <= 0) {
    const lost = minerLostCargo(miner);
    collapse(state, true, lost);
    return {
      ...base,
      collapsed: true,
      lost,
    };
  }
  return finishStationaryAction(state, base);
}

export function collectablePlacements(state: MineState): CollectTarget[] {
  const items: CollectTarget[] = [];
  for (const [key, cell] of state.cells) {
    if (!cell.ladder && !cell.plank && !cell.beacon) continue;
    const [col, row] = key.split(",").map(Number);
    if (!isVisible(state, col, row) || !isSupportSalvageTarget(state, col, row))
      continue;
    if (cell.ladder) items.push({ type: "ladder", col, row });
    if (cell.plank) items.push({ type: "plank", col, row });
    if (cell.beacon) items.push({ type: "beacon", col, row });
  }
  items.sort(
    (a, b) => a.row - b.row || a.col - b.col || a.type.localeCompare(b.type),
  );
  return items;
}

function collectPlaced(state: MineState, action: MineAction): MoveResult {
  const targets = parseCollectAction(action);
  if (!targets || targets.length === 0) return { ok: false, reason: "blocked" };
  for (const item of targets) {
    const cell = cellAt(state, item.col, item.row);
    if (
      !cell ||
      !isVisible(state, item.col, item.row) ||
      !isSupportSalvageTarget(state, item.col, item.row) ||
      !cell[item.type]
    )
      return { ok: false, reason: "blocked" };
  }
  const collected: Partial<Record<SalvageablePlacement, number>> = {};
  const changedSupports: MineCoord[] = [];
  let salvageValue = 0;
  for (const item of targets) {
    const cell = cellMut(state, item.col, item.row);
    cell[item.type] = undefined;
    if (item.type === "ladder")
      changedSupports.push({ col: item.col, row: item.row });
    if (item.type === "beacon") {
      cell.beaconOrder = undefined;
      cell.beaconLabel = undefined;
    }
    const value = salvageSupport(state, item.type);
    salvageValue += value;
    collected[item.type] = (collected[item.type] ?? 0) + 1;
  }
  return finishStationaryAction(
    state,
    {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      supportCollected: collected,
      supportSalvageValue: salvageValue,
    },
    changedSupports,
  );
}

/** The part a cache at (col,row) yields; deterministic from the seed. */
function rollCachePart(state: MineState, col: number, row: number): string {
  const table = cachePartIdsAt(row);
  const pick = cellRandom(state.seed, row, col, 1);
  return table[Math.floor(pick * table.length)];
}

export interface MineCoord {
  col: number;
  row: number;
}

export interface LadderFall {
  from: MineCoord;
  to: MineCoord;
}

const DYNAMITE_TIER_OFFSETS: Record<
  Exclude<DynamiteTier, 4>,
  ReadonlyArray<readonly [number, number]>
> = {
  1: [
    [0, 0],
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ],
  2: [
    [0, 0],
    [0, -1],
    [0, -2],
    [-1, 0],
    [-2, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
  3: [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ],
};

export function dynamiteBlastCells(
  state: MineState,
  center: MineCoord,
  tier: DynamiteTier,
): MineCoord[] {
  if (tier === 4) {
    const radius = lightRadius(state.gear);
    const cells: MineCoord[] = [];
    for (let row = center.row - radius; row <= center.row + radius; row++) {
      if (row < 1 || row >= MINE_BOTTOM_ROW) continue;
      for (let col = center.col - radius; col <= center.col + radius; col++) {
        if (
          Math.max(Math.abs(col - center.col), Math.abs(row - center.row)) <=
          radius
        ) {
          cells.push({ col, row });
        }
      }
    }
    return cells;
  }
  return DYNAMITE_TIER_OFFSETS[tier]
    .map(([dc, dr]) => ({ col: center.col + dc, row: center.row + dr }))
    .filter((cell) => cell.row >= 1 && cell.row < MINE_BOTTOM_ROW);
}

export function dynamitePreviewCells(
  state: MineState,
  tier: DynamiteTier,
): MineCoord[] {
  return dynamiteBlastCells(state, state.miner, tier).filter((coord) => {
    const cell = cellAt(state, coord.col, coord.row);
    return Boolean(
      cell &&
        (BLASTABLE.has(cell.kind) ||
          cell.kind === "part-cache" ||
          cell.kind === "gas" ||
          cell.kind === "magma"),
    );
  });
}

interface ExplosionResult {
  vented?: number;
  blasted?: number;
  collected?: number;
  dropped?: number;
  foundParts?: string[];
  fallingRockTriggered?: boolean;
  ladderFalls?: LadderFall[];
  exploded: PendingDynamite;
}

/**
 * Resolves a lit charge once the miner has stepped clear. The selected tier
 * controls the blast shape; it clears dirt, any rock tier, and boulders, and
 * collects ore and caches.
 * Ore beyond the cargo hold spills onto the floor to scoop up later.
 */
function detonateDynamiteAt(
  state: MineState,
  center: PendingDynamite,
): ExplosionResult {
  state.pendingDynamite = undefined;
  const miner = state.miner;
  let blasted = 0;
  let vented = 0;
  let collected = 0;
  let dropped = 0;
  const foundParts: string[] = [];
  const emptied: Array<{ col: number; row: number }> = [];
  for (const coord of dynamiteBlastCells(state, center, center.tier)) {
    const nc = coord.col;
    const nr = coord.row;
    const cell = cellAt(state, nc, nr);
    if (!cell) continue;
    if (cell.kind === "gas" || cell.kind === "magma") {
      // Light it from a distance: chains, but the heat misses the miner.
      setCell(state, nc, nr, { kind: "empty" });
      emptied.push({ col: nc, row: nr });
      vented +=
        (cell.kind === "magma" ? 3 : 1) + ventGasAround(state, nc, nr, emptied);
      blasted++;
      continue;
    }
    if (cell.kind === "part-cache") {
      // Dynamite cracks caches the diamond reaches directly (gas chains
      // still leave them be); the part is collected free of the hold.
      const part = rollCachePart(state, nc, nr);
      miner.carriedParts.push(part);
      foundParts.push(part);
      setCell(state, nc, nr, { kind: "empty" });
      emptied.push({ col: nc, row: nr });
      blasted++;
      continue;
    }
    if (!BLASTABLE.has(cell.kind)) continue;
    // Re-collect any pile already on the cell too, so re-blasting a drop
    // is a valid way to scoop it once the hold has room.
    const pile: Partial<Record<OreId, number>> = { ...cell.drop };
    if (cell.kind === "ore" && cell.ore) {
      const current = cell.oreRemaining ?? oreReserveAt(cell.ore, nr);
      const mined = Math.min(current, dynamiteOreHarvestUnits(center.tier));
      pile[cell.ore] = (pile[cell.ore] ?? 0) + mined;
      if (mined < current) {
        const oreCell = cellMut(state, nc, nr);
        oreCell.oreRemaining = current - mined;
        delete oreCell.hp;
        delete oreCell.drop;
      } else {
        setCell(state, nc, nr, { kind: "empty" });
        emptied.push({ col: nc, row: nr });
      }
    } else {
      setCell(state, nc, nr, { kind: "empty" });
      emptied.push({ col: nc, row: nr });
    }
    blasted++;
    // Fill the hold from the blast centre outward; overflow falls until
    // it lands on the nearest surface.
    const { taken, dropped: spilled, leftover } = fillHold(state, pile);
    collected += taken;
    dropped += spilled;
    if (spilled > 0) dropOreToSurface(state, nc, nr, leftover);
  }
  const settled = settleAfterEmptied(state, emptied);
  return {
    vented: vented > 0 ? vented : undefined,
    blasted: blasted > 0 ? blasted : undefined,
    collected: collected > 0 ? collected : undefined,
    dropped: dropped > 0 ? dropped : undefined,
    foundParts: foundParts.length > 0 ? foundParts : undefined,
    fallingRockTriggered: settled.fallingRockTriggered || undefined,
    ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    exploded: center,
  };
}

function maybeExplodePendingDynamite(
  state: MineState,
  result: Extract<MoveResult, { ok: true }>,
): MoveResult {
  const charge = state.pendingDynamite;
  if (!charge || result.collapsed || !hasDynamiteGap(state, charge))
    return result;
  const explosion = detonateDynamiteAt(state, charge);
  const vented = (result.vented ?? 0) + (explosion.vented ?? 0);
  const collected = (result.collected ?? 0) + (explosion.collected ?? 0);
  const dropped = (result.dropped ?? 0) + (explosion.dropped ?? 0);
  const foundParts = [
    ...(result.foundParts ?? []),
    ...(explosion.foundParts ?? []),
  ];
  const ladderFalls =
    explosion.ladderFalls && explosion.ladderFalls.length > 0
      ? [...(result.ladderFalls ?? []), ...explosion.ladderFalls]
      : result.ladderFalls;
  const fell = settleMiner(state);
  const totalFell = (result.fell ?? 0) + fell;
  if (isFatalMinerFall(state, totalFell)) {
    const lost = minerLostCargo(state.miner);
    collapse(state, true, lost);
    return {
      ...result,
      vented: vented > 0 ? vented : undefined,
      blasted: explosion.blasted,
      collected: collected > 0 ? collected : undefined,
      dropped: dropped > 0 ? dropped : undefined,
      foundParts: foundParts.length > 0 ? foundParts : undefined,
      exploded: explosion.exploded,
      collapsed: true,
      crushed: true,
      fallingRockTriggered:
        result.fallingRockTriggered || explosion.fallingRockTriggered
          ? true
          : undefined,
      ladderFalls,
      fell: totalFell > 0 ? totalFell : undefined,
      fallFatal: true,
      lost,
    };
  }
  return {
    ...result,
    vented: vented > 0 ? vented : undefined,
    blasted: explosion.blasted,
    collected: collected > 0 ? collected : undefined,
    dropped: dropped > 0 ? dropped : undefined,
    foundParts: foundParts.length > 0 ? foundParts : undefined,
    exploded: explosion.exploded,
    fallingRockTriggered:
      result.fallingRockTriggered || explosion.fallingRockTriggered
        ? true
        : undefined,
    ladderFalls,
    fell: totalFell > 0 ? totalFell : undefined,
  };
}

/**
 * Places a lit dynamite charge at the miner's current cell. It explodes after
 * a later successful action moves the miner off the charge.
 */
function plantDynamite(state: MineState, tier: DynamiteTier): MoveResult {
  if (state.consumables.dynamite <= 0)
    return { ok: false, reason: "no-dynamite" };
  if (tier > dynamiteTier(state.gear)) return { ok: false, reason: "blocked" };
  if (state.pendingDynamite) return { ok: false, reason: "blocked" };
  const t = { col: state.miner.col, row: state.miner.row, tier };
  state.consumables.dynamite--;
  state.used.dynamite++;
  state.pendingDynamite = t;
  const emptied: Array<{ col: number; row: number }> = [];
  const fallTick = tickFalls(state, emptied);
  const settled = settleAfterEmptied(state, emptied);
  const fell = settleMiner(state);
  const fellTooFar = isFatalMinerFall(state, fell);
  if (fallTick.crushed || fellTooFar) {
    const lost = minerLostCargo(state.miner, fallTick.crushRest);
    collapse(state, true, lost);
    return {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: true,
      crushed: true,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
      dynamitePlanted: t,
      lost,
      fell: fell || undefined,
      fallFatal: fellTooFar || undefined,
    };
  }
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    fallingRockTriggered: settled.fallingRockTriggered || undefined,
    ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    dynamitePlanted: t,
    fell: fell || undefined,
  };
}

function collectLadder(state: MineState): MoveResult {
  const { col, row } = state.miner;
  const cell = cellAt(state, col, row);
  if (!cell?.ladder) return { ok: false, reason: "blocked" };
  cellMut(state, col, row).ladder = undefined;
  const salvageValue = salvageSupport(state, "ladder");
  return finishStationaryAction(
    state,
    {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      collectedLadder: true,
      supportCollected: { ladder: 1 },
      supportSalvageValue: salvageValue,
    },
    [{ col, row }],
  );
}

/** The recall rope: ends the trip from anywhere, banking the carry. */
function recall(state: MineState): MoveResult {
  const miner = state.miner;
  if (miner.row === 0) return { ok: false, reason: "surface" };
  if (state.consumables.rope <= 0) return { ok: false, reason: "no-rope" };
  state.consumables.rope--;
  state.used.rope++;
  miner.col = START_COL;
  miner.row = 0;
  bank(miner, state.gear);
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    recalled: true,
  };
}

/**
 * Giving up (REQ-025): always available below ground, no consumable
 * needed. The crew hauls you up and the carry stays behind, exactly
 * like a collapse but chosen. The escape valve for being stuck with
 * no ladders and no rope.
 */
function abandon(state: MineState): MoveResult {
  const miner = state.miner;
  if (miner.row === 0) return { ok: false, reason: "surface" };
  const lost = {
    value: carriedValue(miner),
    parts: [...miner.carriedParts],
    col: miner.col,
    row: miner.row,
  };
  // Giving up grants no free recovery stock: only dying refills.
  collapse(state, false, lost);
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: true,
    abandoned: true,
    lost,
  };
}

/**
 * Rows the elevator travels per ride action (REQ-028, user-directed
 * 2026-06-16: "I do not want it to be instant. Start a little faster than
 * taking stairs straight down, then upgrade so the speed picks up faster
 * and faster and greater distances"). Stairs move one row per dig, so the
 * base car covers six; each Elevator Speed level accelerates (~1.6x + 2),
 * so a 1000-row rail clears in just a few steps at the top. Integer and
 * transcendental-free so the server replay agrees.
 */
export function elevatorSpeedRows(gear: MineGear): number {
  const level = Math.max(1, gear.elevatorSpeed ?? 1);
  let rows = 6;
  for (let i = 1; i < level; i++) rows = Math.floor(rows * 1.6) + 2;
  return rows;
}

/**
 * The elevator (REQ-028): logged rides along the elevator column,
 * a fixed number of rows per ride (see elevatorSpeedRows). Ride-down
 * bores the rail span clear on the way (the crew built the shaft; anything
 * inside was milled, no loot) and stops at the owned depth; ride-up lifts
 * toward the surface and banks the carry once it lands. No energy: the rail
 * is the investment paying out. Ride again to keep travelling.
 */
function rideElevator(state: MineState, dir: "down" | "up"): MoveResult {
  const miner = state.miner;
  const rail = Math.min(state.gear.elevator, MINE_BOTTOM_ROW - 1);
  if (rail <= 0) return { ok: false, reason: "no-elevator" };
  const step = elevatorSpeedRows(state.gear);
  if (dir === "down") {
    if (miner.col !== ELEVATOR_COL || miner.row < 0 || miner.row >= rail)
      return { ok: false, reason: "blocked" };
    const target = Math.min(rail, miner.row + step);
    const emptied: Array<{ col: number; row: number }> = [];
    for (let r = miner.row + 1; r <= target; r++) {
      const cell = cellAt(state, ELEVATOR_COL, r);
      if (cell && cell.kind !== "empty") {
        setCell(state, ELEVATOR_COL, r, { kind: "empty" });
        emptied.push({ col: ELEVATOR_COL, row: r });
      }
    }
    miner.row = target;
    if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
    const fallTick = tickFalls(state, emptied);
    const settled = settleAfterEmptied(state, emptied);
    if (fallTick.crushed) {
      const lost = minerLostCargo(miner, fallTick.crushRest);
      collapse(state, true, lost);
      return {
        ok: true,
        dug: null,
        dugOre: null,
        found: null,
        collapsed: true,
        crushed: true,
        fallingRockTriggered: settled.fallingRockTriggered || undefined,
        ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
        lost,
      };
    }
    return {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    };
  }
  if (miner.col !== ELEVATOR_COL || miner.row < 1 || miner.row > rail)
    return { ok: false, reason: "blocked" };
  miner.row = Math.max(0, miner.row - step);
  // Banking happens topside: a partial ride up just travels.
  if (miner.row === 0) bank(miner, state.gear);
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

export interface PlacedBeacon {
  col: number;
  row: number;
  order: number;
  inRange: boolean;
  label: string | null;
}

export interface PlacedPortalBeacon extends BiomePortalDef {
  active: boolean;
}

export function countPlacedBeaconsInDiff(diff: WorldDiff | undefined): number {
  let count = 0;
  for (const [, row, cell] of diff ?? []) {
    if (row >= MINE_BOTTOM_ROW) continue;
    if (cell.beacon) count++;
  }
  return count;
}

function maxBeaconOrder(state: MineState): number {
  let order = 0;
  for (const cell of state.cells.values()) {
    if (
      cell.beacon &&
      Number.isSafeInteger(cell.beaconOrder) &&
      (cell.beaconOrder ?? 0) > order
    )
      order = cell.beaconOrder ?? 0;
  }
  return order;
}

/** Locate placed beacons in newest-first order. */
export function findBeacons(state: MineState): PlacedBeacon[] {
  const range = warpRange(state.gear);
  const beacons: PlacedBeacon[] = [];
  for (const [key, cell] of state.cells) {
    if (!cell.beacon) continue;
    const [col, row] = key.split(",").map(Number);
    if (row >= MINE_BOTTOM_ROW) continue;
    const order = Number.isSafeInteger(cell.beaconOrder)
      ? (cell.beaconOrder ?? 0)
      : 0;
    beacons.push({
      col,
      row,
      order,
      inRange: row <= range,
      label:
        typeof cell.beaconLabel === "string"
          ? normalizeBeaconLabel(cell.beaconLabel) || null
          : null,
    });
  }
  beacons.sort((a, b) => b.order - a.order || b.row - a.row || b.col - a.col);
  return beacons;
}

/** Locate the newest placed beacon in the world diff, if any. */
export function findBeacon(
  state: MineState,
): { col: number; row: number } | null {
  const [beacon] = findBeacons(state);
  return beacon ? { col: beacon.col, row: beacon.row } : null;
}

export function isPortalActive(state: MineState, id: PortalBeaconId): boolean {
  const portal = portalDef(id);
  const cell = cellAt(state, portal.col, portal.row);
  return cell?.portal === id && cell.portalActive === true;
}

export function findPortalBeacons(state: MineState): PlacedPortalBeacon[] {
  return BIOME_PORTALS.map((portal) => ({
    ...portal,
    active: isPortalActive(state, portal.id),
  }));
}

export function activePortalAt(
  state: MineState,
  col: number,
  row: number,
): PlacedPortalBeacon | null {
  const portal = authoredPortalAt(col, row);
  if (!portal || !isPortalActive(state, portal.id)) return null;
  return { ...portal, active: true };
}

/**
 * The teleporter (REQ-029): beacon kits plant persistent anchors in
 * conquered space. The village warp pad jumps to a chosen beacon, and
 * any beacon returns the miner home while its depth is within range.
 * All logged, all free of energy: the late game compresses conquered
 * space, never unconquered space.
 */
function placeBeacon(state: MineState): MoveResult {
  const miner = state.miner;
  if (miner.row < 1) return { ok: false, reason: "surface" };
  if (miner.row >= MINE_BOTTOM_ROW) return { ok: false, reason: "blocked" };
  if (state.consumables.beacon <= 0) return { ok: false, reason: "no-beacon" };
  const cell = cellMut(state, miner.col, miner.row);
  if (cell.beacon) return { ok: false, reason: "blocked" };
  state.consumables.beacon--;
  state.used.beacon++;
  cell.beacon = true;
  cell.beaconOrder = maxBeaconOrder(state) + 1;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function activatePortal(state: MineState, id: PortalBeaconId): MoveResult {
  const portal = portalDef(id);
  const miner = state.miner;
  if (miner.row !== portal.row || miner.col !== portal.col)
    return { ok: false, reason: "blocked" };
  const cell = cellMut(state, portal.col, portal.row);
  cell.kind = "empty";
  cell.portal = id;
  cell.portalActive = true;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function canUsePortalNetwork(state: MineState): boolean {
  const miner = state.miner;
  if (miner.row !== 0) return false;
  return (
    miner.col === WARP_PAD_COL ||
    activePortalAt(state, miner.col, miner.row) !== null
  );
}

function portalWarp(state: MineState, target: PortalTargetId): MoveResult {
  const miner = state.miner;
  if (!canUsePortalNetwork(state)) return { ok: false, reason: "blocked" };
  if (target === "base") {
    miner.col = START_COL;
    miner.row = 0;
    bank(miner, state.gear);
    return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
  }
  const portal = portalDef(target);
  if (!isPortalActive(state, target)) return { ok: false, reason: "no-beacon" };
  miner.col = portal.col;
  miner.row = portal.row;
  bank(miner, state.gear);
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function warpHome(state: MineState): MoveResult {
  const miner = state.miner;
  const here = cellAt(state, miner.col, miner.row);
  if (!here?.beacon) return { ok: false, reason: "blocked" };
  if (miner.row > warpRange(state.gear))
    return { ok: false, reason: "out-of-range" };
  miner.col = WARP_PAD_COL;
  miner.row = 0;
  bank(miner, state.gear);
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function warpDown(
  state: MineState,
  target: { col: number; row: number },
): MoveResult {
  const miner = state.miner;
  if (miner.row !== 0 || miner.col !== WARP_PAD_COL)
    return { ok: false, reason: "blocked" };
  if (target.row >= MINE_BOTTOM_ROW) return { ok: false, reason: "blocked" };
  const cell = cellAt(state, target.col, target.row);
  if (!cell?.beacon) return { ok: false, reason: "no-beacon" };
  if (target.row > warpRange(state.gear))
    return { ok: false, reason: "out-of-range" };
  miner.col = target.col;
  miner.row = target.row;
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function warpToNewestBeacon(state: MineState): MoveResult {
  const beacons = findBeacons(state);
  const beacon = beacons.find((candidate) => candidate.inRange);
  if (!beacon) {
    return beacons.length > 0
      ? { ok: false, reason: "out-of-range" }
      : { ok: false, reason: "no-beacon" };
  }
  return warpDown(state, beacon);
}

function renameBeacon(
  state: MineState,
  target: { col: number; row: number; label: string },
): MoveResult {
  const miner = state.miner;
  if (miner.row !== 0 || miner.col !== WARP_PAD_COL)
    return { ok: false, reason: "blocked" };
  if (!cellAt(state, target.col, target.row)?.beacon)
    return { ok: false, reason: "no-beacon" };
  const cell = cellMut(state, target.col, target.row);
  const label = normalizeBeaconLabel(target.label);
  cell.beaconLabel = label || undefined;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function dropOreFromBag(
  state: MineState,
  pile: Partial<Record<OreId, number>>,
): MoveResult {
  const miner = state.miner;
  if (miner.row < 1) return { ok: false, reason: "surface" };
  const dropped: Partial<Record<OreId, number>> = {};
  for (const ore of ORES) {
    const requested = pile[ore.id] ?? 0;
    if (requested <= 0) continue;
    const carried = miner.carried[ore.id] ?? 0;
    const count = Math.min(carried, requested);
    if (count <= 0) continue;
    const remaining = carried - count;
    if (remaining > 0) miner.carried[ore.id] = remaining;
    else delete miner.carried[ore.id];
    dropped[ore.id] = count;
  }
  const amount = orePileCount(dropped);
  if (amount <= 0) return { ok: false, reason: "blocked" };
  const cell = cellMut(state, miner.col, miner.row);
  cell.drop = mergeOrePiles(cell.drop, dropped);
  cell.dropDeferred = mergeOrePiles(cell.dropDeferred, dropped);
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    droppedFromBag: amount,
  };
}

/** Dispatches any logged trip action (Q-006 default B). */
export function applyAction(state: MineState, action: MineAction): MoveResult {
  if (action.startsWith("collect:")) return collectPlaced(state, action);
  const droppedOre = parseDropOreAction(action);
  if (droppedOre) return dropOreFromBag(state, droppedOre);
  const portalActivation = parseActivatePortalAction(action);
  if (portalActivation) return activatePortal(state, portalActivation);
  const portalTarget = parsePortalWarpAction(action);
  if (portalTarget) return portalWarp(state, portalTarget);
  const warpTarget = parseWarpDownAction(action);
  if (warpTarget) return warpDown(state, warpTarget);
  const renameTarget = parseRenameBeaconAction(action);
  if (renameTarget) return renameBeacon(state, renameTarget);
  switch (action) {
    case "down":
    case "up":
    case "left":
    case "right":
      return step(state, action);
    case "dynamite-1":
      return plantDynamite(state, 1);
    case "dynamite-2":
      return plantDynamite(state, 2);
    case "dynamite-3":
      return plantDynamite(state, 3);
    case "dynamite-4":
      return plantDynamite(state, 4);
    case "plank-left":
      return placePlank(state, "left");
    case "plank-right":
      return placePlank(state, "right");
    case "recall":
      return recall(state);
    case "abandon":
      return abandon(state);
    case "ride-down":
      return rideElevator(state, "down");
    case "ride-up":
      return rideElevator(state, "up");
    case "place-beacon":
      return placeBeacon(state);
    case "collect-ladder":
      return collectLadder(state);
    case "warp-home":
      return warpHome(state);
    case "warp-down":
      return warpToNewestBeacon(state);
  }
  return { ok: false, reason: "blocked" };
}

function bank(miner: MinerState, gear: MineGear): void {
  const totalVibes = carriedValue(miner);
  miner.lastSoldHaul = {
    ores: { ...miner.carried },
    salvageCredits: miner.carriedSalvageCredits,
    totalVibes,
  };
  miner.bankedCredits += totalVibes;
  miner.bankedParts.push(...miner.carriedParts);
  miner.carried = {};
  miner.carriedSalvageCredits = 0;
  miner.carriedParts = [];
  miner.lostCargo = undefined;
  miner.energy = maxEnergy(gear);
}

/** Battery dead underground: cargo drops, and the crew hauls you up. */
/**
 * End the trip the hard way: drop the carry, haul up to the surface,
 * recharge the robot. `recover` marks a death (battery out or crushed) rather
 * than a chosen give-up: a death tops the ladder/plank stock back up to
 * the recovery floor for free so the miner is never stranded, while
 * abandoning grants nothing. Granting is deterministic, so the server
 * replay agrees and the cash-out math forgives exactly what was given.
 */
function collapse(
  state: MineState,
  recover: boolean,
  lost?: { value: number; parts: string[]; col: number; row: number },
): void {
  const miner = state.miner;
  state.pendingDynamite = undefined;
  dropBagAt(state, lost ?? miner, droppedBagFromMiner(miner));
  if (lost && (lost.value > 0 || lost.parts.length > 0)) {
    miner.lostCargo = { ...lost, parts: [...lost.parts] };
  }
  miner.carried = {};
  miner.carriedSalvageCredits = 0;
  miner.carriedParts = [];
  miner.lastSoldHaul = undefined;
  miner.collapses += 1;
  miner.col = START_COL;
  miner.row = 0;
  miner.energy = maxEnergy(state.gear);
  if (recover) {
    grantRecovery(state, "ladder", LADDER_RECOVERY_FLOOR);
    grantRecovery(state, "plank", PLANK_RECOVERY_FLOOR);
  }
}

/** Top one consumable up TO the floor, recording the free grant. */
function grantRecovery(
  state: MineState,
  item: "ladder" | "plank",
  floor: number,
): void {
  const add = Math.max(0, floor - state.consumables[item]);
  state.consumables[item] += add;
  state.granted[item] += add;
}

/** Grid distance used by the lantern cone below and beside the miner. */
export function lanternDistance(
  state: MineState,
  col: number,
  row: number,
): number {
  return Math.max(
    Math.abs(col - state.miner.col),
    Math.max(0, row - state.miner.row),
  );
}

/** A cell is visible when within lantern reach of the miner's cell. */
export function isVisible(state: MineState, col: number, row: number): boolean {
  return lanternDistance(state, col, row) <= lightRadius(state.gear);
}

/** Hard cap on submitted move logs (server replay cost control). */
export const MAX_TRIP_MOVES = 5000;

export interface TripResult {
  bankedCredits: number;
  bankedParts: string[];
  soldHaul?: SoldHaul;
  /** Deepest row reached for the persisted profile record. */
  maxDepth: number;
  moves: number;
  /** Consumables spent (server decrements at cash-out). */
  used: MineConsumables;
  /** Free recovery stock granted by deaths: forgiven at cash-out. */
  granted: MineConsumables;
  /** The world after the trip: persisted as the next checkpoint. */
  diff: WorldDiff;
}

/**
 * Replays a full action log from a seed, gear, and consumable snapshot
 * and returns what got banked. The server uses this to credit
 * cash-outs: the mine is a pure function of (seed, gear, consumables,
 * actions), so an honest client and the server always agree.
 */
export function replayTrip(
  seed: number,
  actions: MineAction[],
  gear: MineGear = DEFAULT_GEAR,
  consumables: MineConsumables = NO_CONSUMABLES,
  diff?: WorldDiff,
): TripResult {
  const state = createMine(seed, gear, consumables, diff);
  const capped = actions.slice(0, MAX_TRIP_MOVES);
  for (const action of capped) {
    applyAction(state, action);
  }
  return {
    bankedCredits: state.miner.bankedCredits,
    bankedParts: [...state.miner.bankedParts],
    soldHaul: state.miner.lastSoldHaul
      ? {
          ores: { ...state.miner.lastSoldHaul.ores },
          salvageCredits: state.miner.lastSoldHaul.salvageCredits,
          totalVibes: state.miner.lastSoldHaul.totalVibes,
        }
      : undefined,
    maxDepth: state.miner.maxDepth,
    moves: capped.length,
    used: { ...state.used },
    granted: { ...state.granted },
    diff: exportDiff(state),
  };
}
