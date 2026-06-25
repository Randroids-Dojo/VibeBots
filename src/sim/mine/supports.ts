import type {
  LadderFall,
  MineCell,
  MineCoord,
  MinerState,
  MineState,
} from "./cells";
import type { MineConsumables } from "./consumables";
import { MOVE_COST } from "./digging";
import { dropBagToSurface, dropOreToSurface } from "./inventory";
import { cellAt, cellMut } from "./world";

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

export function settleUnsupportedDrops(state: MineState): void {
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

export function ladderFallsOrUndefined(
  falls: LadderFall[],
): LadderFall[] | undefined {
  return falls.length > 0 ? falls : undefined;
}

export function combinedLadderFalls(
  existing: LadderFall[] | undefined,
  incoming: LadderFall[],
): LadderFall[] | undefined {
  if (!existing?.length) return ladderFallsOrUndefined(incoming);
  if (incoming.length === 0) return existing;
  return [...existing, ...incoming];
}

export function settleUnsupportedLadders(
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
