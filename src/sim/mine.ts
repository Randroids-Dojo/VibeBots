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
 * The mining loop (REQ-006/REQ-007): a deterministic 2D vertical grid.
 * Pure logic; rendering draws these cells as low-poly 3D blocks from a
 * side camera (Q-004 resolution). Same seed, same mine, same finds:
 * mining rewards stay verifiable like everything else in the sim.
 *
 * Core tension: every action costs energy. Banking happens only on the
 * surface; running dry underground loses everything you carry.
 */

export const MINE_WIDTH = 9;
/** Column the miner starts in (surface shaft entrance). */
export const START_COL = 4;
export const START_ENERGY = 60;

export const DIG_COST_DIRT = 1;
export const MOVE_COST = 0.5;
/** Rows visible below the miner without better lanterns. */
export const LIGHT_RADIUS = 3;

export type CellKind = "dirt" | "rock" | "emerald" | "part-cache" | "empty";

export interface MineCell {
  kind: CellKind;
}

/** Rare robot parts discoverable underground (REQ-007). */
const CACHE_PART_IDS = ["drive-wheel", "ram-spike", "frame-plate"];

export interface MinerState {
  col: number;
  row: number; // 0 = surface walk row; digging starts at row 1
  energy: number;
  carriedEmeralds: number;
  carriedParts: string[];
  bankedEmeralds: number;
  bankedParts: string[];
  /** Trips that ended underground with a dead lamp (lost cargo). */
  collapses: number;
}

export interface MineState {
  seed: number;
  /** Sparse rows, generated on demand; index 0 is the surface. */
  rows: MineCell[][];
  miner: MinerState;
}

function rollCell(seed: number, row: number, col: number): MineCell {
  // Depth scaling: rock and treasure both grow with depth.
  const rockChance = Math.min(0.05 + row * 0.012, 0.35);
  const emeraldChance = Math.min(0.04 + row * 0.01, 0.22);
  const cacheChance = Math.min(0.004 + row * 0.0012, 0.03);
  const roll = cellRandom(seed, row, col, 0);
  if (roll < cacheChance) return { kind: "part-cache" };
  if (roll < cacheChance + emeraldChance) return { kind: "emerald" };
  if (roll < cacheChance + emeraldChance + rockChance) return { kind: "rock" };
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
      carriedEmeralds: 0,
      carriedParts: [],
      bankedEmeralds: 0,
      bankedParts: [],
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
  | { ok: true; dug: CellKind | null; found: string | null; collapsed: boolean }
  | { ok: false; reason: "blocked" | "edge" };

/**
 * Dig toward or move into the adjacent cell. Dirt/emerald/cache cells are
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
  let found: string | null = null;
  let cost = MOVE_COST;
  if (cell.kind !== "empty") {
    dug = cell.kind;
    cost = DIG_COST_DIRT;
    if (cell.kind === "emerald") miner.carriedEmeralds += 1;
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

  let collapsed = false;
  if (miner.row === 0) {
    bank(miner);
  } else if (miner.energy <= 0) {
    collapse(miner);
    collapsed = true;
  }
  ensureRows(state, miner.row + LIGHT_RADIUS + 1);
  return { ok: true, dug, found, collapsed };
}

function bank(miner: MinerState): void {
  miner.bankedEmeralds += miner.carriedEmeralds;
  miner.bankedParts.push(...miner.carriedParts);
  miner.carriedEmeralds = 0;
  miner.carriedParts = [];
  miner.energy = START_ENERGY;
}

/** Lamp dead underground: cargo is lost, the crew hauls you up. */
function collapse(miner: MinerState): void {
  miner.carriedEmeralds = 0;
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
