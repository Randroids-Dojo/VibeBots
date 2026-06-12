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
export const MINE_VERSION = 6;

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
}

export const NO_CONSUMABLES: MineConsumables = {
  dynamite: 0,
  rope: 0,
  ladder: 0,
  plank: 0,
};

export const CONSUMABLE_PRICES: Record<keyof MineConsumables, number> = {
  dynamite: 10,
  rope: 8,
  ladder: 2,
  plank: 2,
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
  };
}

/**
 * Free ladders provisioned at the start of every trip. Climbing is
 * ladder-gated (REQ-020): the provision keeps the gentle top learnable
 * without a shop visit; deep runs budget purchased bundles. Leftover
 * provision does not bank between trips (see carryoverConsumables).
 */
export const LADDER_PROVISION = 8;

/**
 * Free planks provisioned per trip (REQ-022): lateral steps over a void
 * are plank-gated; gaps are self-made (digs, blasts, vents), so the
 * provision is smaller than the ladder bundle.
 */
export const PLANK_PROVISION = 4;

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
}

export const DEFAULT_GEAR: MineGear = {
  pickaxe: 1,
  lamp: 1,
  cargo: 1,
  lantern: 1,
};

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
    prices: [40, 150, 500],
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
];

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
 * Rock tier by depth (Terraria-style hard gates): pickaxe level N digs
 * rock tiers up to N - 1, so level 1 digs none and the wall a player
 * hits is always one shop visit away from opening.
 */
export function rockTierAt(row: number): number {
  if (row < 24) return 1;
  if (row < 48) return 2;
  return 3;
}

export function canDigRock(gear: MineGear, tier: number): boolean {
  return gear.pickaxe - 1 >= tier;
}

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

export type CellKind =
  | "dirt"
  | "rock"
  | "ore"
  | "part-cache"
  | "boulder"
  | "gas"
  | "empty";

export interface MineCell {
  kind: CellKind;
  /** Set when kind is "ore". */
  ore?: OreId;
  /** Set when kind is "rock" (hard gate vs the pickaxe level). */
  rockTier?: number;
  /** A boulder whose support was dug: it falls on the next action. */
  wobbling?: boolean;
  /**
   * A deployed ladder (REQ-020), only meaningful on empty cells.
   * Climbing out of this cell is free once placed. Anything that
   * overwrites the cell (a falling boulder) smashes the ladder.
   */
  ladder?: boolean;
  /**
   * A deployed plank bridge (REQ-022), only meaningful on empty cells.
   * Stepping laterally into this cell over a void is free once placed;
   * a falling boulder smashes it like a ladder.
   */
  plank?: boolean;
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
  /** Gear snapshot for the session; part of the replay input (Q-007). */
  gear: MineGear;
  /** Consumables remaining this session; part of the replay input. */
  consumables: MineConsumables;
  /** Consumables spent this session (server decrements at cash-out). */
  used: MineConsumables;
  /** Sparse rows, generated on demand; index 0 is the surface. */
  rows: MineCell[][];
  miner: MinerState;
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

/**
 * Ladders still needed to climb straight home up the current column
 * (REQ-020). Same cleared-shaft assumption as returnEnergyCost: cells
 * already holding a ladder climb free, everything else needs one.
 */
export function returnLadderNeed(state: MineState): number {
  let need = 0;
  for (let r = 1; r <= state.miner.row; r++) {
    const cell = state.rows[r]?.[state.miner.col];
    if (!(cell?.kind === "empty" && cell.ladder)) need++;
  }
  return need;
}

/**
 * Consumables that survive into the next session: purchased stock only.
 * The free ladder provision is per-trip; the pool spends provision
 * first, so the purchased leftover is what remains after subtracting
 * the unspent part of the provision.
 */
export function carryoverConsumables(state: MineState): MineConsumables {
  const ladderFree = Math.max(0, LADDER_PROVISION - state.used.ladder);
  const plankFree = Math.max(0, PLANK_PROVISION - state.used.plank);
  return {
    dynamite: state.consumables.dynamite,
    rope: state.consumables.rope,
    ladder: Math.max(0, state.consumables.ladder - ladderFree),
    plank: Math.max(0, state.consumables.plank - plankFree),
  };
}

/** The top rows never roll rock: the first digs always land. */
export const ROCK_FREE_ROWS = 2;
/** The top rows never roll hazards: the first lesson is gentle. */
export const HAZARD_FREE_ROWS = 4;

function rollCell(seed: number, row: number, col: number): MineCell {
  // Depth scaling: rock, treasure, and hazards all grow with depth.
  const rockChance =
    row <= ROCK_FREE_ROWS ? 0 : Math.min(0.05 + row * 0.012, 0.35);
  const gasChance =
    row <= HAZARD_FREE_ROWS ? 0 : Math.min(0.003 + row * 0.0008, 0.025);
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
  threshold += boulderChance;
  if (roll < threshold) return { kind: "boulder" };
  if (roll < threshold + rockChance)
    return { kind: "rock", rockTier: rockTierAt(row) };
  return { kind: "dirt" };
}

function cacheChance(row: number): number {
  return Math.min(0.004 + row * 0.0012, 0.03);
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

export function createMine(
  seed: number,
  gear: MineGear = DEFAULT_GEAR,
  consumables: MineConsumables = NO_CONSUMABLES,
): MineState {
  const state: MineState = {
    seed,
    gear,
    consumables: {
      ...consumables,
      ladder: consumables.ladder + LADDER_PROVISION,
      plank: consumables.plank + PLANK_PROVISION,
    },
    used: { dynamite: 0, rope: 0, ladder: 0, plank: 0 },
    rows: [],
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
    },
  };
  ensureRows(state, lightRadius(gear) + 1);
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
      /** A falling boulder ended the trip (carry lost). */
      crushed?: boolean;
      /** Gas pockets vented by this action (lamp energy burned). */
      vented?: number;
      /** Cells destroyed by a dynamite blast. */
      blasted?: number;
      /** A recall rope ended the trip from below (carry banked). */
      recalled?: boolean;
      /** This climb consumed and placed a new ladder (REQ-020). */
      laddered?: boolean;
      /** This step consumed and placed a new plank bridge (REQ-022). */
      planked?: boolean;
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
        | "surface";
    };

/**
 * The full trip action vocabulary (Q-006 default B): plain directions
 * dig and move; dynamite tokens blast toward a direction; recall ends
 * the trip from anywhere, banking the carry. The cash-out log is an
 * array of these tokens.
 */
export type MineAction =
  | Direction
  | "dynamite-down"
  | "dynamite-up"
  | "dynamite-left"
  | "dynamite-right"
  | "recall";

export const MINE_ACTIONS = [
  "down",
  "up",
  "left",
  "right",
  "dynamite-down",
  "dynamite-up",
  "dynamite-left",
  "dynamite-right",
  "recall",
] as const;

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
function ventGasAround(state: MineState, col: number, row: number): number {
  const queue: Array<{ col: number; row: number }> = [];
  for (const [dc, dr] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const) {
    const cell = cellAt(state, col + dc, row + dr);
    if (cell?.kind === "gas") queue.push({ col: col + dc, row: row + dr });
  }
  let vented = 0;
  while (queue.length > 0) {
    const g = queue.pop();
    if (!g) break;
    const gasCell = cellAt(state, g.col, g.row);
    if (gasCell?.kind !== "gas") continue;
    state.rows[g.row][g.col] = { kind: "empty" };
    vented++;
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
      if (n.kind === "gas") queue.push({ col: nc, row: nr });
      else if (BLASTABLE.has(n.kind)) state.rows[nr][nc] = { kind: "empty" };
    }
  }
  return vented;
}

/**
 * Wobbling boulders drop until they rest on something solid. Returns
 * true when one passed through or landed on the miner (the crew digs
 * you out, the carry stays under the rock). Bottom-up per column so
 * stacked boulders settle onto each other deterministically.
 */
function resolveFalls(state: MineState): boolean {
  const miner = state.miner;
  let crushed = false;
  for (let row = state.rows.length - 1; row >= 1; row--) {
    for (let col = 0; col < MINE_WIDTH; col++) {
      const cell = state.rows[row][col];
      if (cell.kind !== "boulder" || !cell.wobbling) continue;
      let rest = row;
      while (true) {
        const below = cellAt(state, col, rest + 1);
        if (!below || below.kind !== "empty") break;
        rest++;
        if (miner.col === col && miner.row === rest) crushed = true;
      }
      state.rows[row][col] = { kind: "empty" };
      state.rows[rest][col] = { kind: "boulder" };
    }
  }
  return crushed;
}

/** Boulders whose support vanished start wobbling (one-action warning). */
function markWobbling(state: MineState): void {
  for (let row = 1; row < state.rows.length - 1; row++) {
    for (let col = 0; col < MINE_WIDTH; col++) {
      const cell = state.rows[row][col];
      if (cell.kind !== "boulder" || cell.wobbling) continue;
      if (state.rows[row + 1]?.[col]?.kind === "empty") cell.wobbling = true;
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
  const cell = cellAt(state, t.col, t.row);
  if (!cell) return { ok: false, reason: "edge" };
  if (cell.kind === "rock" && !canDigRock(state.gear, cell.rockTier ?? 1))
    return { ok: false, reason: "rock" };
  if (cell.kind === "boulder" || cell.kind === "gas")
    return { ok: false, reason: "blocked" };
  if (cell.kind === "ore" && carriedCount(miner) >= cargoCapacity(state.gear))
    return { ok: false, reason: "hold-full" };
  if (dir === "up" && cell.kind !== "empty")
    return { ok: false, reason: "blocked" };
  let laddered = false;
  if (dir === "up" && miner.row >= 1) {
    const here = state.rows[miner.row][miner.col];
    if (!here.ladder) {
      if (state.consumables.ladder <= 0)
        return { ok: false, reason: "no-ladder" };
      state.consumables.ladder--;
      state.used.ladder++;
      here.ladder = true;
      laddered = true;
    }
  }
  // Lateral steps over a void need a plank bridge in the target cell
  // (REQ-022). The surface walk row is boardwalked; below it, a placed
  // plank carries every later crossing. Checked before any mutation so
  // a refusal costs nothing.
  let needPlank = false;
  if ((dir === "left" || dir === "right") && t.row >= 1) {
    const below = cellAt(state, t.col, t.row + 1);
    if (below?.kind === "empty" && !cell.plank) {
      if (state.consumables.plank <= 0)
        return { ok: false, reason: "no-plank" };
      needPlank = true;
    }
  }

  let dug: CellKind | null = null;
  let dugOre: OreId | null = null;
  let found: string | null = null;
  let cost = MOVE_COST;
  let vented = 0;
  if (cell.kind !== "empty") {
    dug = cell.kind;
    cost = cell.kind === "rock" ? ROCK_DIG_COST : DIG_COST_DIRT;
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
    // Digging next to a pocket vents it: the burn is lamp heat.
    vented = ventGasAround(state, t.col, t.row);
  }

  let planked = false;
  if (needPlank) {
    // After dig resolution the target object may be a fresh empty cell;
    // the plank lives on whatever now occupies the target.
    state.consumables.plank--;
    state.used.plank++;
    state.rows[t.row][t.col].plank = true;
    planked = true;
  }

  miner.energy = Math.max(0, miner.energy - cost - vented * GAS_VENT_DRAIN);
  miner.col = t.col;
  miner.row = t.row;
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;

  const crushed = resolveFalls(state);
  markWobbling(state);

  let collapsed = false;
  let lost: { value: number; parts: string[]; col: number; row: number };
  if (crushed || (miner.row > 0 && miner.energy <= 0)) {
    lost = {
      value: carriedValue(miner),
      parts: [...miner.carriedParts],
      col: miner.col,
      row: miner.row,
    };
    collapse(miner, state.gear);
    collapsed = true;
    ensureRows(state, lost.row + lightRadius(state.gear) + 1);
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
      lost,
    };
  }
  if (miner.row === 0) {
    bank(miner, state.gear);
  }
  ensureRows(state, miner.row + lightRadius(state.gear) + 1);
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
  };
}

/**
 * Throws dynamite at the adjacent cell in the given direction: a plus
 * blast clears dirt, ore (loot destroyed), any rock tier, and boulders;
 * caught gas chains. Costs one dynamite, no energy; the miner stays put
 * behind cover.
 */
function blast(state: MineState, dir: Direction): MoveResult {
  if (state.consumables.dynamite <= 0)
    return { ok: false, reason: "no-dynamite" };
  const t = target(state, dir);
  if (t.col < 0 || t.col >= MINE_WIDTH || t.row < 1)
    return { ok: false, reason: "edge" };
  state.consumables.dynamite--;
  state.used.dynamite++;
  let blasted = 0;
  let vented = 0;
  for (const [dc, dr] of [
    [0, 0],
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const) {
    const nc = t.col + dc;
    const nr = t.row + dr;
    if (nr < 1) continue;
    const cell = cellAt(state, nc, nr);
    if (!cell) continue;
    if (cell.kind === "gas") {
      // Light it from a distance: chains, but the heat misses the lamp.
      state.rows[nr][nc] = { kind: "empty" };
      vented += 1 + ventGasAround(state, nc, nr);
      blasted++;
    } else if (BLASTABLE.has(cell.kind)) {
      state.rows[nr][nc] = { kind: "empty" };
      blasted++;
    }
  }
  const crushed = resolveFalls(state);
  markWobbling(state);
  let collapsed = false;
  let lost:
    | { value: number; parts: string[]; col: number; row: number }
    | undefined;
  if (crushed) {
    lost = {
      value: carriedValue(state.miner),
      parts: [...state.miner.carriedParts],
      col: state.miner.col,
      row: state.miner.row,
    };
    collapse(state.miner, state.gear);
    collapsed = true;
  }
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed,
    crushed,
    vented,
    blasted,
    lost,
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

/** Dispatches any logged trip action (Q-006 default B). */
export function applyAction(state: MineState, action: MineAction): MoveResult {
  switch (action) {
    case "down":
    case "up":
    case "left":
    case "right":
      return step(state, action);
    case "dynamite-down":
      return blast(state, "down");
    case "dynamite-up":
      return blast(state, "up");
    case "dynamite-left":
      return blast(state, "left");
    case "dynamite-right":
      return blast(state, "right");
    case "recall":
      return recall(state);
  }
}

function bank(miner: MinerState, gear: MineGear): void {
  miner.bankedCredits += carriedValue(miner);
  miner.bankedParts.push(...miner.carriedParts);
  miner.carried = {};
  miner.carriedParts = [];
  miner.energy = maxEnergy(gear);
}

/** Lamp dead underground: cargo is lost, the crew hauls you up. */
function collapse(miner: MinerState, gear: MineGear): void {
  miner.carried = {};
  miner.carriedParts = [];
  miner.collapses += 1;
  miner.col = START_COL;
  miner.row = 0;
  miner.energy = maxEnergy(gear);
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
): TripResult {
  const state = createMine(seed, gear, consumables);
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
  };
}
