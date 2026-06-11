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
export const MINE_VERSION = 2;

export const MINE_WIDTH = 9;
/** Column the miner starts in (surface shaft entrance). */
export const START_COL = 4;
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

export type CellKind = "dirt" | "rock" | "ore" | "part-cache" | "empty";

export interface MineCell {
  kind: CellKind;
  /** Set when kind is "ore". */
  ore?: OreId;
}

/** Rare robot parts discoverable underground (REQ-007). */
const CACHE_PART_IDS = ["drive-wheel", "ram-spike", "frame-plate"];

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
}

export interface MineState {
  seed: number;
  /** Sparse rows, generated on demand; index 0 is the surface. */
  rows: MineCell[][];
  miner: MinerState;
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
 * Energy needed to climb straight home through a cleared shaft
 * (REQ-017): the trip-back decision should be a real call, not a guess.
 */
export function returnEnergyCost(miner: MinerState): number {
  return miner.row * MOVE_COST;
}

/** The top rows never roll rock: the first digs always land. */
export const ROCK_FREE_ROWS = 2;

function rollCell(seed: number, row: number, col: number): MineCell {
  // Depth scaling: rock and treasure both grow with depth.
  const rockChance =
    row <= ROCK_FREE_ROWS ? 0 : Math.min(0.05 + row * 0.012, 0.35);
  const cacheChance = Math.min(0.004 + row * 0.0012, 0.03);
  const roll = cellRandom(seed, row, col, 0);
  if (roll < cacheChance) return { kind: "part-cache" };
  let threshold = cacheChance;
  for (const ore of ORES) {
    threshold += oreChanceAt(ore, row);
    if (roll < threshold) return { kind: "ore", ore: ore.id };
  }
  if (roll < threshold + rockChance) return { kind: "rock" };
  return { kind: "dirt" };
}

/** Generates rows up to and including the given row index. */
export function ensureRows(state: MineState, row: number): void {
  while (state.rows.length <= row) {
    const index = state.rows.length;
    const cells: MineCell[] = [];
    if (index === 0) {
      for (let c = 0; c < MINE_WIDTH; c++) cells.push({ kind: "empty" });
    } else {
      for (let c = 0; c < MINE_WIDTH; c++)
        cells.push(rollCell(state.seed, index, c));
    }
    state.rows.push(cells);
  }
}

export function createMine(seed: number): MineState {
  const state: MineState = {
    seed,
    rows: [],
    miner: {
      col: START_COL,
      row: 0,
      energy: START_ENERGY,
      carried: {},
      carriedParts: [],
      bankedCredits: 0,
      bankedParts: [],
      maxDepth: 0,
      collapses: 0,
    },
  };
  ensureRows(state, LIGHT_RADIUS + 1);
  return state;
}

export function cellAt(
  state: MineState,
  col: number,
  row: number,
): MineCell | null {
  if (col < 0 || col >= MINE_WIDTH || row < 0) return null;
  ensureRows(state, row);
  return state.rows[row][col];
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

export type MoveResult =
  | {
      ok: true;
      dug: CellKind | null;
      /** Set when dug was an ore cell. */
      dugOre: OreId | null;
      found: string | null;
      collapsed: boolean;
    }
  | { ok: false; reason: "blocked" | "edge" };

/**
 * Dig toward or move into the adjacent cell. Dirt/ore/cache cells are
 * dug (cost + loot); empty cells are walked into; rock is undiggable at
 * pickaxe level 1; moving up works only through already-dug cells
 * (ladders are implicit in the shaft you cleared).
 */
export function step(state: MineState, dir: Direction): MoveResult {
  const miner = state.miner;
  const t = target(state, dir);
  const cell = cellAt(state, t.col, t.row);
  if (!cell) return { ok: false, reason: "edge" };
  if (cell.kind === "rock") return { ok: false, reason: "blocked" };
  if (dir === "up" && cell.kind !== "empty")
    return { ok: false, reason: "blocked" };

  let dug: CellKind | null = null;
  let dugOre: OreId | null = null;
  let found: string | null = null;
  let cost = MOVE_COST;
  if (cell.kind !== "empty") {
    dug = cell.kind;
    cost = DIG_COST_DIRT;
    if (cell.kind === "ore" && cell.ore) {
      dugOre = cell.ore;
      miner.carried[cell.ore] = (miner.carried[cell.ore] ?? 0) + 1;
    }
    if (cell.kind === "part-cache") {
      const pick = cellRandom(state.seed, t.row, t.col, 1);
      found = CACHE_PART_IDS[Math.floor(pick * CACHE_PART_IDS.length)];
      miner.carriedParts.push(found);
    }
    state.rows[t.row][t.col] = { kind: "empty" };
  }

  miner.energy = Math.max(0, miner.energy - cost);
  miner.col = t.col;
  miner.row = t.row;
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;

  let collapsed = false;
  if (miner.row === 0) {
    bank(miner);
  } else if (miner.energy <= 0) {
    collapse(miner);
    collapsed = true;
  }
  ensureRows(state, miner.row + LIGHT_RADIUS + 1);
  return { ok: true, dug, dugOre, found, collapsed };
}

function bank(miner: MinerState): void {
  miner.bankedCredits += carriedValue(miner);
  miner.bankedParts.push(...miner.carriedParts);
  miner.carried = {};
  miner.carriedParts = [];
  miner.energy = START_ENERGY;
}

/** Lamp dead underground: cargo is lost, the crew hauls you up. */
function collapse(miner: MinerState): void {
  miner.carried = {};
  miner.carriedParts = [];
  miner.collapses += 1;
  miner.col = START_COL;
  miner.row = 0;
  miner.energy = START_ENERGY;
}

/** A cell is visible when within lantern reach of the miner's row. */
export function isVisible(state: MineState, row: number): boolean {
  return row <= state.miner.row + LIGHT_RADIUS;
}

/** Hard cap on submitted move logs (server replay cost control). */
export const MAX_TRIP_MOVES = 5000;

export interface TripResult {
  bankedCredits: number;
  bankedParts: string[];
  /** Deepest row reached (drives the milestone bonus server-side). */
  maxDepth: number;
  moves: number;
}

/**
 * Replays a full move log from a seed and returns what got banked. The
 * server uses this to credit cash-outs: the mine is a pure function of
 * (seed, moves), so an honest client and the server always agree.
 */
export function replayTrip(seed: number, moves: Direction[]): TripResult {
  const state = createMine(seed);
  const capped = moves.slice(0, MAX_TRIP_MOVES);
  for (const dir of capped) {
    step(state, dir);
  }
  return {
    bankedCredits: state.miner.bankedCredits,
    bankedParts: [...state.miner.bankedParts],
    maxDepth: state.miner.maxDepth,
    moves: capped.length,
  };
}
