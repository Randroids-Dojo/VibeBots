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
 * surface; running dry underground loses everything you carry.
 */

/**
 * Bumped whenever generation or rules change payouts for the same
 * (seed, moves). The client submits it with a cash-out so a session
 * played on old rules is rejected instead of silently re-priced.
 */
export const MINE_VERSION = 19;

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
  /** Warp beacon kits (REQ-029): one active beacon, replanting moves it. */
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
 * depot. The one free source is dying in the mine (lamp out or crushed,
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

/** Lamp energy burned per gas pocket vented (heat, not shrapnel). */
export const GAS_VENT_DRAIN = 8;

/**
 * Persistent gear tracks (REQ-013/REQ-014): part of the sim input, so a
 * trip replays identically from (seed, gear, moves). Level arrays are
 * indexed by level - 1; prices[i] upgrades from level i+1 to i+2.
 */
export interface MineGear {
  pickaxe: number;
  lamp: number;
  cargo: number;
  lantern: number;
  /** Elevator rail depth in rows (REQ-028); 0 = no rail bought yet. */
  elevator: number;
  /** Warpcoil level (REQ-029): indexes WARP_RANGE. */
  warpcoil: number;
  /**
   * Dynamite blast radius (Manhattan distance). Absent or 1 is the
   * classic 5-cell plus; each level widens the diamond by one ring.
   * Optional for backward-compat with gear snapshots that predate the
   * track (read as 1); bought at the Upgrades stall like the other tracks.
   */
  blast?: number;
  /**
   * Elevator car speed: rows travelled per ride (see elevatorSpeedRows).
   * Optional/back-compat like blast (absent reads as level 1, two rows).
   */
  elevatorSpeed?: number;
}

export const DEFAULT_GEAR: MineGear = {
  pickaxe: 1,
  lamp: 1,
  cargo: 1,
  lantern: 1,
  elevator: 0,
  warpcoil: 1,
  blast: 1,
  elevatorSpeed: 1,
};

/** The elevator's column: the elevator runs down this shaft. */
export const ELEVATOR_COL = -5;
/** Rows of rail per purchased segment (one stratum band). */
export const ELEVATOR_SEGMENT_ROWS = 12;

/** Price of the nth rail segment (1-based): superlinear per stratum. */
export function elevatorSegmentPrice(segment: number): number {
  return Math.round((40 * 2.5 ** (segment - 1)) / 10) * 10;
}

/** Max lamp energy by lamp level. */
export const LAMP_ENERGY = [60, 90, 130, 180] as const;
/** Visible rows below the miner by lantern level. */
export const LANTERN_RADIUS = [3, 5, 7] as const;
/** Ore chunks the hold carries by cargo level (parts ride free). */
export const CARGO_CAPACITY = [8, 14, 22, 32] as const;

export interface GearTrackDef {
  track: keyof MineGear;
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
    prices: [40, 150, 500, 1500],
    blurb: "cuts harder rock tiers",
  },
  {
    track: "lamp",
    name: "Lamp Cell",
    prices: [30, 100, 350],
    blurb: "more energy per trip",
  },
  {
    track: "cargo",
    name: "Cargo Hold",
    prices: [25, 80, 300],
    blurb: "carry more ore per trip",
  },
  {
    track: "lantern",
    name: "Lantern",
    prices: [50, 200],
    blurb: "see deeper ahead",
  },
  {
    track: "warpcoil",
    name: "Warpcoil",
    prices: [120, 400, 1200],
    blurb: "longer beacon warp range",
  },
  {
    track: "blast",
    // A very high cap (radius grows one ring per level) on a steeply
    // staggered ladder: the first rings are mid-game, but each ring costs
    // ~2.6x the last, so the widest blasts run into the millions of vibes
    // and stay a late-game flex. ~2.6x per tier keeps it superlinear.
    name: "Blast Charge",
    prices: [
      200, 500, 1300, 3500, 9000, 24000, 65000, 175000, 480000, 1300000,
      3500000, 9500000, 26000000, 70000000,
    ],
    blurb: "wider dynamite blast, more loot",
  },
  {
    track: "elevatorSpeed",
    name: "Elevator Speed",
    prices: [80, 200, 500, 1300, 3500, 9000, 24000, 65000],
    blurb: "faster elevator rides (needs a rail)",
  },
];

/** Beacon warp reach in rows by warpcoil level (REQ-029). */
export const WARP_RANGE = [60, 150, 400, 1000] as const;

export function warpRange(gear: MineGear): number {
  return WARP_RANGE[Math.min(gear.warpcoil, WARP_RANGE.length) - 1];
}

/** The village warp pad's column. */
export const WARP_PAD_COL = 6;

export function gearTrackDef(track: keyof MineGear): GearTrackDef {
  const def = GEAR_TRACKS.find((t) => t.track === track);
  if (!def) throw new Error(`unknown gear track: ${track}`);
  return def;
}

export function maxGearLevel(track: keyof MineGear): number {
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
 * Lamp energy per swing. At pickaxe 1 a block's swing total matches
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

/** Lamp energy one swing at this kind costs. */
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
 * maxRow). The previous tier stays present one band deeper; the next
 * teases at a band's bottom edge.
 */
export type OreId =
  | "coal"
  | "copper"
  | "silver"
  | "emerald"
  | "ruby"
  | "diamond"
  | "core-crystal";

export interface OreDef {
  id: OreId;
  name: string;
  /** Credits paid when banked (Q-005: display currency is credits). */
  value: number;
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
    minRow: 1,
    peakStart: 2,
    peakEnd: 12,
    maxRow: 24,
    peakChance: 0.09,
  },
  {
    id: "copper",
    name: "Copper",
    value: 3,
    minRow: 4,
    peakStart: 8,
    peakEnd: 20,
    maxRow: 30,
    peakChance: 0.07,
  },
  {
    id: "silver",
    name: "Silver",
    value: 8,
    minRow: 14,
    peakStart: 20,
    peakEnd: 34,
    maxRow: 44,
    peakChance: 0.06,
  },
  {
    id: "emerald",
    name: "Emerald",
    value: 20,
    minRow: 24,
    peakStart: 32,
    peakEnd: 46,
    maxRow: 58,
    peakChance: 0.05,
  },
  {
    id: "ruby",
    name: "Ruby",
    value: 50,
    minRow: 36,
    peakStart: 44,
    peakEnd: 58,
    maxRow: 72,
    peakChance: 0.04,
  },
  {
    id: "diamond",
    name: "Diamond",
    value: 125,
    minRow: 48,
    peakStart: 58,
    peakEnd: 76,
    maxRow: 92,
    peakChance: 0.03,
  },
  {
    id: "core-crystal",
    name: "Core Crystal",
    value: 320,
    minRow: 64,
    peakStart: 80,
    peakEnd: Number.POSITIVE_INFINITY,
    maxRow: Number.POSITIVE_INFINITY,
    peakChance: 0.025,
  },
];

const ORE_BY_ID = new Map(ORES.map((ore) => [ore.id, ore]));

export function oreDef(id: OreId): OreDef {
  const def = ORE_BY_ID.get(id);
  if (!def) throw new Error(`unknown ore: ${id}`);
  return def;
}

/** Trapezoid band ramp: 0 outside, linear fades, 1 across the peak. */
export function oreChanceAt(ore: OreDef, row: number): number {
  if (row < ore.minRow || row > ore.maxRow) return 0;
  if (row < ore.peakStart)
    return (ore.peakChance * (row - ore.minRow)) / (ore.peakStart - ore.minRow);
  if (row <= ore.peakEnd) return ore.peakChance;
  return (ore.peakChance * (ore.maxRow - row)) / (ore.maxRow - ore.peakEnd);
}

/**
 * Named strata (REQ-012): every band has its own look, and crossing
 * into a stratum for the first time ever pays a one-time bonus credited
 * at banking. The server computes the bonus against the player's
 * persistent deepest-depth record.
 */
export interface Stratum {
  name: string;
  startRow: number;
  /** One-time credit bonus the first time a player ever reaches it. */
  firstReachBonus: number;
}

export const STRATA: readonly Stratum[] = [
  { name: "Topsoil", startRow: 0, firstReachBonus: 0 },
  { name: "Clay Beds", startRow: 12, firstReachBonus: 15 },
  { name: "Old Granite", startRow: 24, firstReachBonus: 40 },
  { name: "Glow Caverns", startRow: 36, firstReachBonus: 100 },
  { name: "Magma Verge", startRow: 48, firstReachBonus: 250 },
  { name: "Ashfall Galleries", startRow: 64, firstReachBonus: 500 },
  { name: "The Black Seam", startRow: 84, firstReachBonus: 1000 },
  { name: "Echo Vaults", startRow: 110, firstReachBonus: 1800 },
  { name: "Core Approach", startRow: 140, firstReachBonus: 3000 },
];

export function stratumAt(row: number): Stratum {
  let current = STRATA[0];
  for (const stratum of STRATA) {
    if (row >= stratum.startRow) current = stratum;
  }
  return current;
}

/**
 * Total first-reach bonus for strata first crossed when the deepest
 * record moves from prevDeepest to newDeepest. Pure helper shared by
 * the cash-out route (server-side, against the stored record).
 */
export function strataBonusBetween(
  prevDeepest: number,
  newDeepest: number,
): number {
  let total = 0;
  for (const stratum of STRATA) {
    if (stratum.startRow > prevDeepest && stratum.startRow <= newDeepest)
      total += stratum.firstReachBonus;
  }
  return total;
}

export type CellKind =
  | "dirt"
  | "rock"
  | "ore"
  | "part-cache"
  | "boulder"
  | "gas"
  | "magma"
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
  /**
   * Swings remaining before this block breaks (REQ-013). Unset means
   * full health for its kind and the digger's pickaxe.
   */
  hp?: number;
  /** The active warp beacon stands here (REQ-029); at most one world-wide. */
  beacon?: boolean;
  /**
   * Ore lying on the floor of an empty cell: chunks that overflowed a
   * dynamite blast's cargo hold. Scooped up by walking over the cell once
   * the hold has room (a partial take leaves the rest as a smaller pile).
   * A falling block buries it like a ladder. Only meaningful on empty
   * cells; never stored empty.
   */
  drop?: Partial<Record<OreId, number>>;
  /** A rock that entered the falling-rock hazard system. Render-layer cue. */
  fallen?: boolean;
}

export interface PendingDynamite {
  col: number;
  row: number;
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
  /** Carried ore counts by id; lost on collapse, banked on the surface. */
  carried: Partial<Record<OreId, number>>;
  carriedParts: string[];
  bankedCredits: number;
  bankedParts: string[];
  /** Deepest row reached this session (drives milestone bonuses). */
  maxDepth: number;
  /** Trips that ended underground with a dead lamp (lost cargo). */
  collapses: number;
  /** Last dropped cargo location for the render-layer locator. */
  lostCargo?: { value: number; parts: string[]; col: number; row: number };
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
   * Planted consumables recovered from the world during this session.
   * They offset later use at cash-out but do bank if carried home.
   */
  recovered: MineConsumables;
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
      cells.set(cellKey(col, row), { ...cell });
    }
  }
  return cells;
}

/**
 * Buying rail through a carved ladder shaft returns those bought rungs
 * to stock and removes them from the persistent world diff. The empty
 * shaft stays carved.
 */
export function refundRailLaddersInDiff(
  diff: WorldDiff,
  fromDepth: number,
  toDepth: number,
): { diff: WorldDiff; refunded: number } {
  const cells = importDiff(diff);
  let refunded = 0;
  for (let row = Math.max(1, fromDepth + 1); row <= toDepth; row++) {
    const key = cellKey(ELEVATOR_COL, row);
    const cell = cells.get(key);
    if (!cell?.ladder) continue;
    const next = { ...cell };
    delete next.ladder;
    cells.set(key, next);
    refunded++;
  }
  return { diff: exportCells(cells), refunded };
}

/** Max lamp energy for the session's gear. */
export function maxEnergy(gear: MineGear): number {
  return LAMP_ENERGY[Math.min(gear.lamp, LAMP_ENERGY.length) - 1];
}

/** Lantern reach for the session's gear. */
export function lightRadius(gear: MineGear): number {
  return LANTERN_RADIUS[Math.min(gear.lantern, LANTERN_RADIUS.length) - 1];
}

/** Ore chunks the hold takes for the session's gear. */
export function cargoCapacity(gear: MineGear): number {
  return CARGO_CAPACITY[Math.min(gear.cargo, CARGO_CAPACITY.length) - 1];
}

/**
 * Dynamite blast radius in cells (Manhattan distance). Level 1 (or
 * unset) is the classic 5-cell plus; each blast-gear level adds a ring.
 */
export function blastRadius(gear: MineGear): number {
  return Math.max(1, gear.blast ?? 1);
}

/** Credit value of everything currently carried (the bet on the table). */
export function carriedValue(miner: MinerState): number {
  let total = 0;
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
  for (const ore of ORES) {
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
    recovered: { dynamite: 0, rope: 0, ladder: 0, plank: 0, beacon: 0 },
    cells: importDiff(diff),
    miner: {
      col: START_COL,
      row: 0,
      energy: maxEnergy(gear),
      carried: {},
      carriedParts: [],
      bankedCredits: 0,
      bankedParts: [],
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
  return (
    state.cells.get(cellKey(col, row)) ?? generatedCell(state.seed, col, row)
  );
}

/** Materialize a cell into the diff and return the stored object. */
function cellMut(state: MineState, col: number, row: number): MineCell {
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
    2
  );
}

export type MoveResult =
  | {
      ok: true;
      dug: CellKind | null;
      /** Set when dug was an ore cell. */
      dugOre: OreId | null;
      found: string | null;
      collapsed: boolean;
      /** A falling boulder ended the trip (carry lost). */
      crushed?: boolean;
      /** Gas pockets vented by this action (lamp energy burned). */
      vented?: number;
      /** Cells destroyed by a dynamite blast. */
      blasted?: number;
      /** Ore chunks a dynamite blast collected into the hold. */
      collected?: number;
      /** Ore chunks a blast left on the floor because the hold was full. */
      dropped?: number;
      /** Parts a dynamite blast cracked out of caches in range. */
      foundParts?: string[];
      /** A dynamite charge was placed and is waiting for space. */
      dynamitePlanted?: PendingDynamite;
      /** Center cell of a delayed dynamite explosion. */
      exploded?: PendingDynamite;
      /** Ore chunks scooped by walking over a floor drop. */
      pickedUp?: number;
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
      /** A planted ladder was recovered into the carried stock. */
      collectedLadder?: boolean;
      /** This action placed a plank in the facing cell. */
      plankPlaced?: { col: number; row: number };
      /** Placed supports picked back up into inventory. */
      supportCollected?: Partial<Record<"ladder" | "plank", number>>;
      /** The swing damaged but did not break the block (REQ-013). */
      cracked?: { kind: CellKind; remaining: number };
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
  | "dynamite-down"
  | "dynamite-up"
  | "dynamite-left"
  | "dynamite-right"
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
  type: "ladder" | "plank";
  col: number;
  row: number;
};

/**
 * The full trip action vocabulary (Q-006 default B): plain directions
 * dig and move; dynamite and plank tokens act toward a direction;
 * collect tokens pick placed traversal supports back up by coordinate.
 */
export type MineAction = BaseMineAction | `collect:${string}`;

export const MINE_ACTIONS = [
  "down",
  "up",
  "left",
  "right",
  "dynamite-down",
  "dynamite-up",
  "dynamite-left",
  "dynamite-right",
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
    const match = /^(ladder|plank):(-?\d+),(-?\d+)$/.exec(part);
    if (!match) return null;
    const type = match[1] as "ladder" | "plank";
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

export function isMineAction(action: string): action is MineAction {
  return BASE_MINE_ACTIONS.has(action) || parseCollectAction(action) !== null;
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
      if (nr < 1) continue;
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
 * reach zero drop until they rest on something solid (REQ-015). Returns
 * true when a dropping block passed through or landed on the miner (the
 * crew digs you out, the carry stays under the rubble). Bottom-up per
 * column so stacked blocks settle onto each other deterministically.
 */
function tickFalls(
  state: MineState,
  emptied: Array<{ col: number; row: number }>,
): boolean {
  const miner = state.miner;
  let crushed = false;
  // Only override cells teeter (pristine cells never do), so the scan is
  // bounded by the teeter count. Decrement every countdown; the ones
  // that reach zero fall this action. Sort bottom-up, then by column, so
  // stacked blocks settle deterministically regardless of insertion order.
  const dropping: Array<{ col: number; row: number; cell: MineCell }> = [];
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
      if (miner.col === col && miner.row === rest) crushed = true;
    }
    setCell(state, col, row, { kind: "empty" });
    emptied.push({ col, row });
    // The block relocates intact: a rock keeps its tier gate, a boulder
    // stays a boulder. The teeter resets and crack damage is shaken off.
    const placed: MineCell = { kind: cell.kind };
    if (cell.rockTier !== undefined) placed.rockTier = cell.rockTier;
    if (cell.kind === "rock") placed.fallen = true;
    setCell(state, col, rest, placed);
  }
  return crushed;
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
): void {
  for (const { col, row } of emptied) {
    const blockRow = row - 1;
    if (blockRow <= HAZARD_FREE_ROWS) continue;
    const above = cellAt(state, col, blockRow);
    if (!above || (above.kind !== "rock" && above.kind !== "boulder")) continue;
    if (above.fallIn !== undefined) continue;
    if (cellAt(state, col, row)?.kind === "empty") {
      cellMut(state, col, blockRow).fallIn = FALL_DELAY_ACTIONS;
    }
  }
}

/**
 * Dig toward or move into the adjacent cell. Dirt/ore/cache cells are
 * dug (cost + loot); empty cells are walked into; rock needs the
 * pickaxe tier for its depth (REQ-013) and costs more energy to cut;
 * a full cargo hold refuses ore until it is banked (REQ-014); moving up
 * works only through already-dug cells AND needs a ladder in the cell
 * being climbed from (REQ-020): one is consumed and placed on first
 * climb, then the shaft climbs free until something smashes it.
 */
export function step(state: MineState, dir: Direction): MoveResult {
  const miner = state.miner;
  const t = target(state, dir);
  if (isPendingDynamiteAt(state, t.col, t.row))
    return { ok: false, reason: "blocked" };
  const cell = cellAt(state, t.col, t.row);
  if (!cell) return { ok: false, reason: "edge" };
  if (cell.kind === "rock" && !canDigRock(state.gear, cell.rockTier ?? 1))
    return { ok: false, reason: "rock" };
  if (cell.kind === "boulder" || cell.kind === "gas" || cell.kind === "magma")
    return { ok: false, reason: "blocked" };
  if (cell.kind === "ore" && carriedCount(miner) >= cargoCapacity(state.gear))
    return { ok: false, reason: "hold-full" };
  if (dir === "up" && cell.kind !== "empty")
    return { ok: false, reason: "blocked" };
  // Multi-hit digging (REQ-013): a solid cell soaks swings before it
  // breaks; only the breaking swing moves the miner and yields loot.
  // Every swing is its own logged action and burns lamp energy, so a
  // dig can still collapse the trip mid-block.
  if (cell.kind !== "empty") {
    const struck = cellMut(state, t.col, t.row);
    const remaining = (struck.hp ?? hitsFor(struck.kind, state.gear)) - 1;
    if (remaining > 0) {
      struck.hp = remaining;
      miner.energy = Math.max(0, miner.energy - swingCostFor(struck.kind));
      // A swing is a full action: teetering blocks count down and drop,
      // and the lamp can still die mid-block.
      const emptiedMid: Array<{ col: number; row: number }> = [];
      const crushedMid = tickFalls(state, emptiedMid);
      markUnstable(state, emptiedMid);
      const fellMid = settleMiner(state);
      if (crushedMid || (miner.row > 0 && miner.energy <= 0)) {
        const lost = {
          value: carriedValue(miner),
          parts: [...miner.carriedParts],
          col: miner.col,
          row: miner.row,
        };
        collapse(state, true, lost);
        return {
          ok: true,
          dug: null,
          dugOre: null,
          found: null,
          collapsed: true,
          crushed: crushedMid,
          fell: fellMid || undefined,
          lost,
        };
      }
      return maybeExplodePendingDynamite(state, {
        ok: true,
        dug: null,
        dugOre: null,
        found: null,
        collapsed: false,
        fell: fellMid || undefined,
        cracked: { kind: struck.kind, remaining },
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
  let found: string | null = null;
  let cost = MOVE_COST;
  let vented = 0;
  const emptied: Array<{ col: number; row: number }> = [];
  if (cell.kind !== "empty") {
    dug = cell.kind;
    cost = swingCostFor(cell.kind);
    if (cell.kind === "ore" && cell.ore) {
      dugOre = cell.ore;
      miner.carried[cell.ore] = (miner.carried[cell.ore] ?? 0) + 1;
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
    // Digging next to a pocket vents it: the burn is lamp heat.
    vented = ventGasAround(state, t.col, t.row, emptied);
  }

  const planked = false;

  miner.energy = Math.max(0, miner.energy - cost - vented * GAS_VENT_DRAIN);
  miner.col = t.col;
  miner.row = t.row;
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;

  // Walk-over pickup: scoop a floor drop on the entered cell into the
  // hold, ore up to the cap (a partial take leaves the rest as a smaller
  // pile). Only stored cells can hold a drop, so a miss never materializes
  // a pristine cell.
  let pickedUp: number | undefined;
  if (miner.row >= 1) {
    const here = state.cells.get(cellKey(t.col, t.row));
    if (here?.drop) {
      const { taken, dropped, leftover } = fillHold(state, here.drop);
      if (dropped > 0) here.drop = leftover;
      else delete here.drop;
      if (taken > 0) pickedUp = taken;
    }
  }

  const crushed = tickFalls(state, emptied);
  markUnstable(state, emptied);
  const fell = settleMiner(state);

  let collapsed = false;
  let lost: { value: number; parts: string[]; col: number; row: number };
  if (crushed || (miner.row > 0 && miner.energy <= 0)) {
    lost = {
      value: carriedValue(miner),
      parts: [...miner.carriedParts],
      col: miner.col,
      row: miner.row,
    };
    collapse(state, true, lost);
    collapsed = true;
    return {
      ok: true,
      dug,
      dugOre,
      found,
      collapsed,
      crushed,
      vented,
      laddered,
      planked,
      fell: fell || undefined,
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
    found,
    collapsed,
    crushed,
    vented,
    laddered,
    planked,
    fell: fell || undefined,
    pickedUp,
  });
}

function isOnElevatorRail(state: MineState): boolean {
  return (
    state.gear.elevator > 0 &&
    state.miner.col === ELEVATOR_COL &&
    state.miner.row >= 0 &&
    state.miner.row <= state.gear.elevator
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
): MoveResult {
  const emptied: Array<{ col: number; row: number }> = [];
  const crushed = tickFalls(state, emptied);
  markUnstable(state, emptied);
  if (crushed) {
    const lost = {
      value: carriedValue(state.miner),
      parts: [...state.miner.carriedParts],
      col: state.miner.col,
      row: state.miner.row,
    };
    collapse(state, true);
    return {
      ...base,
      collapsed: true,
      crushed: true,
      lost,
    };
  }
  return maybeExplodePendingDynamite(state, base);
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

export function collectablePlacements(state: MineState): CollectTarget[] {
  const items: CollectTarget[] = [];
  for (const [key, cell] of state.cells) {
    if (!cell.ladder && !cell.plank) continue;
    const [col, row] = key.split(",").map(Number);
    if (!isVisible(state, row)) continue;
    if (cell.ladder) items.push({ type: "ladder", col, row });
    if (cell.plank) items.push({ type: "plank", col, row });
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
    if (!cell || !isVisible(state, item.row) || !cell[item.type])
      return { ok: false, reason: "blocked" };
  }
  const collected: Partial<Record<"ladder" | "plank", number>> = {};
  for (const item of targets) {
    const cell = cellMut(state, item.col, item.row);
    cell[item.type] = undefined;
    state.consumables[item.type]++;
    if (state.used[item.type] > 0) state.used[item.type]--;
    else state.recovered[item.type]++;
    collected[item.type] = (collected[item.type] ?? 0) + 1;
  }
  return finishStationaryAction(state, {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    supportCollected: collected,
  });
}

/** The part a cache at (col,row) yields; deterministic from the seed. */
function rollCachePart(state: MineState, col: number, row: number): string {
  const table = cachePartIdsAt(row);
  const pick = cellRandom(state.seed, row, col, 1);
  return table[Math.floor(pick * table.length)];
}

/**
 * Cell offsets within Manhattan distance r of the blast centre, ordered
 * centre-out (ring ascending) then by (dr, dc). The order is frozen: the
 * hold fills along it, so changing it would change which ore overflows
 * to the floor. r=1 yields the classic 5-cell plus; r=2 -> 13, r=3 -> 25.
 */
function diamondOffsets(r: number): ReadonlyArray<readonly [number, number]> {
  const out: Array<[number, number]> = [];
  for (let ring = 0; ring <= r; ring++) {
    const ringCells: Array<[number, number]> = [];
    for (let dr = -ring; dr <= ring; dr++) {
      const dc = ring - Math.abs(dr);
      ringCells.push([dc, dr]);
      if (dc !== 0) ringCells.push([-dc, dr]);
    }
    ringCells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    out.push(...ringCells);
  }
  return out;
}

interface ExplosionResult {
  vented?: number;
  blasted?: number;
  collected?: number;
  dropped?: number;
  foundParts?: string[];
  exploded: PendingDynamite;
}

/**
 * Resolves a lit charge once the miner has stepped clear: a diamond blast
 * clears dirt, any rock tier, and boulders, and collects ore and caches.
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
  for (const [dc, dr] of diamondOffsets(blastRadius(state.gear))) {
    const nc = center.col + dc;
    const nr = center.row + dr;
    if (nr < 1) continue;
    const cell = cellAt(state, nc, nr);
    if (!cell) continue;
    if (cell.kind === "gas" || cell.kind === "magma") {
      // Light it from a distance: chains, but the heat misses the lamp.
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
    if (cell.kind === "ore" && cell.ore)
      pile[cell.ore] = (pile[cell.ore] ?? 0) + 1;
    setCell(state, nc, nr, { kind: "empty" });
    emptied.push({ col: nc, row: nr });
    blasted++;
    // Fill the hold from the blast centre outward; the overflow stays on
    // the now-empty cell as a floor drop.
    const { taken, dropped: spilled, leftover } = fillHold(state, pile);
    collected += taken;
    dropped += spilled;
    if (spilled > 0) cellMut(state, nc, nr).drop = leftover;
  }
  markUnstable(state, emptied);
  return {
    vented: vented > 0 ? vented : undefined,
    blasted: blasted > 0 ? blasted : undefined,
    collected: collected > 0 ? collected : undefined,
    dropped: dropped > 0 ? dropped : undefined,
    foundParts: foundParts.length > 0 ? foundParts : undefined,
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
  return {
    ...result,
    vented: vented > 0 ? vented : undefined,
    blasted: explosion.blasted,
    collected: collected > 0 ? collected : undefined,
    dropped: dropped > 0 ? dropped : undefined,
    foundParts: foundParts.length > 0 ? foundParts : undefined,
    exploded: explosion.exploded,
  };
}

/**
 * Places a lit dynamite charge at the adjacent cell. It explodes after
 * a later successful action leaves at least one cell of gap between the
 * miner and the charge.
 */
function plantDynamite(state: MineState, dir: Direction): MoveResult {
  if (state.consumables.dynamite <= 0)
    return { ok: false, reason: "no-dynamite" };
  if (state.pendingDynamite) return { ok: false, reason: "blocked" };
  const t = target(state, dir);
  if (t.row < 1) return { ok: false, reason: "edge" };
  state.consumables.dynamite--;
  state.used.dynamite++;
  state.pendingDynamite = t;
  const emptied: Array<{ col: number; row: number }> = [];
  const crushed = tickFalls(state, emptied);
  markUnstable(state, emptied);
  const fell = settleMiner(state);
  if (crushed) {
    const lost = {
      value: carriedValue(state.miner),
      parts: [...state.miner.carriedParts],
      col: state.miner.col,
      row: state.miner.row,
    };
    collapse(state, true, lost);
    return {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: true,
      crushed: true,
      dynamitePlanted: t,
      lost,
      fell: fell || undefined,
    };
  }
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    dynamitePlanted: t,
    fell: fell || undefined,
  };
}

function collectLadder(state: MineState): MoveResult {
  const cell = cellAt(state, state.miner.col, state.miner.row);
  if (!cell?.ladder) return { ok: false, reason: "blocked" };
  cellMut(state, state.miner.col, state.miner.row).ladder = undefined;
  state.consumables.ladder++;
  if (state.used.ladder > 0) state.used.ladder--;
  else state.recovered.ladder++;
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    collectedLadder: true,
  };
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
 * base car covers two; each Elevator Speed level accelerates (~1.6x + 1),
 * so a deep rail clears in fewer rides as the gear climbs. Integer and
 * transcendental-free so the server replay agrees.
 */
export function elevatorSpeedRows(gear: MineGear): number {
  const level = Math.max(1, gear.elevatorSpeed ?? 1);
  let rows = 2;
  for (let i = 1; i < level; i++) rows = Math.floor(rows * 1.6) + 1;
  return rows;
}

/**
 * The elevator (REQ-028): logged rides along the elevator's column,
 * a fixed number of rows per ride (see elevatorSpeedRows). Ride-down
 * bores the rail span clear on the way (the crew built the shaft; anything
 * inside was milled, no loot) and stops at the rail bottom; ride-up lifts
 * toward the surface and banks the carry once it lands. No energy: the
 * rail is the investment paying out. Ride again to keep travelling.
 */
function rideElevator(state: MineState, dir: "down" | "up"): MoveResult {
  const miner = state.miner;
  const rail = state.gear.elevator;
  if (rail <= 0) return { ok: false, reason: "no-elevator" };
  const step = elevatorSpeedRows(state.gear);
  if (dir === "down") {
    if (miner.col !== ELEVATOR_COL || miner.row >= rail)
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
    const crushed = tickFalls(state, emptied);
    markUnstable(state, emptied);
    if (crushed) {
      const lost = {
        value: carriedValue(miner),
        parts: [...miner.carriedParts],
        col: miner.col,
        row: miner.row,
      };
      collapse(state, true, lost);
      return {
        ok: true,
        dug: null,
        dugOre: null,
        found: null,
        collapsed: true,
        crushed: true,
        lost,
      };
    }
    return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
  }
  if (miner.col !== ELEVATOR_COL || miner.row < 1 || miner.row > rail)
    return { ok: false, reason: "blocked" };
  miner.row = Math.max(0, miner.row - step);
  // Banking happens topside: a partial ride up just travels.
  if (miner.row === 0) bank(miner, state.gear);
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

/** Locate the active beacon in the world diff, if any. */
export function findBeacon(
  state: MineState,
): { col: number; row: number } | null {
  for (const [key, cell] of state.cells) {
    if (cell.beacon) {
      const [col, row] = key.split(",").map(Number);
      return { col, row };
    }
  }
  return null;
}

/**
 * The teleporter (REQ-029): a beacon kit plants the one active beacon
 * at the miner's cell; the village warp pad and the beacon exchange
 * the miner freely while the beacon's depth is within warpcoil range.
 * All logged, all free of energy: the late game compresses conquered
 * space, never unconquered space.
 */
function placeBeacon(state: MineState): MoveResult {
  const miner = state.miner;
  if (miner.row < 1) return { ok: false, reason: "surface" };
  if (state.consumables.beacon <= 0) return { ok: false, reason: "no-beacon" };
  const old = findBeacon(state);
  if (old) {
    const cell = cellMut(state, old.col, old.row);
    cell.beacon = undefined;
  }
  state.consumables.beacon--;
  state.used.beacon++;
  cellMut(state, miner.col, miner.row).beacon = true;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function warp(state: MineState, dir: "home" | "down"): MoveResult {
  const miner = state.miner;
  const beacon = findBeacon(state);
  if (!beacon) return { ok: false, reason: "no-beacon" };
  if (beacon.row > warpRange(state.gear))
    return { ok: false, reason: "out-of-range" };
  if (dir === "home") {
    if (miner.col !== beacon.col || miner.row !== beacon.row)
      return { ok: false, reason: "blocked" };
    miner.col = WARP_PAD_COL;
    miner.row = 0;
    bank(miner, state.gear);
    return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
  }
  if (miner.row !== 0 || miner.col !== WARP_PAD_COL)
    return { ok: false, reason: "blocked" };
  miner.col = beacon.col;
  miner.row = beacon.row;
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

/** Dispatches any logged trip action (Q-006 default B). */
export function applyAction(state: MineState, action: MineAction): MoveResult {
  if (action.startsWith("collect:")) return collectPlaced(state, action);
  switch (action) {
    case "down":
    case "up":
    case "left":
    case "right":
      return step(state, action);
    case "dynamite-down":
      return plantDynamite(state, "down");
    case "dynamite-up":
      return plantDynamite(state, "up");
    case "dynamite-left":
      return plantDynamite(state, "left");
    case "dynamite-right":
      return plantDynamite(state, "right");
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
      return warp(state, "home");
    case "warp-down":
      return warp(state, "down");
  }
  return { ok: false, reason: "blocked" };
}

function bank(miner: MinerState, gear: MineGear): void {
  miner.bankedCredits += carriedValue(miner);
  miner.bankedParts.push(...miner.carriedParts);
  miner.carried = {};
  miner.carriedParts = [];
  miner.lostCargo = undefined;
  miner.energy = maxEnergy(gear);
}

/** Lamp dead underground: cargo is lost, the crew hauls you up. */
/**
 * End the trip the hard way: drop the carry, haul up to the surface,
 * refill the lamp. `recover` marks a death (lamp out or crushed) rather
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
  if (lost && (lost.value > 0 || lost.parts.length > 0)) {
    miner.lostCargo = { ...lost, parts: [...lost.parts] };
  }
  miner.carried = {};
  miner.carriedParts = [];
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

/** A cell is visible when within lantern reach of the miner's row. */
export function isVisible(state: MineState, row: number): boolean {
  return row <= state.miner.row + lightRadius(state.gear);
}

/** Hard cap on submitted move logs (server replay cost control). */
export const MAX_TRIP_MOVES = 5000;

export interface TripResult {
  bankedCredits: number;
  bankedParts: string[];
  /** Deepest row reached (drives the milestone bonus server-side). */
  maxDepth: number;
  moves: number;
  /** Consumables spent (server decrements at cash-out). */
  used: MineConsumables;
  /** Free recovery stock granted by deaths: forgiven at cash-out. */
  granted: MineConsumables;
  /** World-stock recovered during this trip: forgiven if re-used. */
  recovered: MineConsumables;
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
    maxDepth: state.miner.maxDepth,
    moves: capped.length,
    used: { ...state.used },
    granted: { ...state.granted },
    recovered: { ...state.recovered },
    diff: exportDiff(state),
  };
}
