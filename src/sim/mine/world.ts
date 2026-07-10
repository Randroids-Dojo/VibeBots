import { biomeAt } from "./biomes";
import type { MineCell, MineState, WorldDiff } from "./cells";
import {
  MINE_BOTTOM_ROW,
  type MineConsumables,
  NO_CONSUMABLES,
} from "./consumables";
import { rockTierAt, START_COL } from "./digging";
import { DEFAULT_GEAR, ELEVATOR_COL, type MineGear, maxEnergy } from "./gear";
import { earlyOreBoost, oreChanceAt, oreDef, oreIdsForBiome } from "./ores";
import { cellRandom } from "./random";

export const cellKey = (col: number, row: number) => `${col},${row}`;

/** The world diff, sorted for deterministic serialization. */
export function exportCells(cells: Map<string, MineCell>): WorldDiff {
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

export function importDiff(diff: WorldDiff | undefined): Map<string, MineCell> {
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

/**
 * Structural integrity (REQ-015 extension): a contiguous unpropped
 * empty span this wide destabilizes the ceiling directly above it,
 * dirt and ore included, not just rock. Planks split spans and prop
 * the cell above them, so tunnels stay safe when braced every few
 * cells.
 */
export const SPAN_COLLAPSE_WIDTH = 5;

/**
 * Actions a wide-span ceiling teeters before it drops: double the
 * undercut teeter, because a roof failure threatens the whole tunnel
 * and the miner needs time to place a prop or clear out.
 */
export const SPAN_COLLAPSE_DELAY_ACTIONS = 4;

/**
 * Gas propagation (REQ-015 extension): a fall or collapse that vacates
 * a cell beside a gas pocket uncorks it (digging beside gas still vents
 * instantly, so falls are the only un-vented exposure). An uncorked
 * pocket leaks up to this many wisp cells into open tunnel, one per
 * action.
 */
export const GAS_SEEP_BUDGET = 3;

/** Actions a seeped wisp lingers before fading back to clear air. */
export const GAS_SEEPED_FADE_ACTIONS = 10;

/** Battery drain for shouldering through a wisp cell (dispersing it). */
export const GAS_WISP_DISPERSE_DRAIN = 4;

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
  // Early rows get a denser ore band so the first digs pay off (F-060).
  const oreBoost = earlyOreBoost(row);
  for (const id of oreIdsForBiome(biome)) {
    const ore = oreDef(id);
    threshold += oreChanceAt(ore, row) * oreBoost;
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
export function generatedCell(
  seed: number,
  col: number,
  row: number,
): MineCell {
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
export function cellMut(state: MineState, col: number, row: number): MineCell {
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
