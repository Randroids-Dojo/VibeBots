import type {
  LadderFall,
  MineCell,
  MineCoord,
  MinerState,
  MineState,
} from "./cells";
import { MINE_BOTTOM_ROW, type MineConsumables } from "./consumables";
import { MOVE_COST } from "./digging";
import { elevatorColumn } from "./gear";
import { dropBagToSurface, dropOreToSurface } from "./inventory";
import { cellAt, cellMut } from "./world";

export interface ReturnHomeEstimate {
  reachable: boolean;
  laddersNeeded: number;
  steps: number;
  energyCost: number;
  visited: number;
  capped: boolean;
}

export const RETURN_HOME_VISIT_CAP = 4096;

interface ReturnRouteNode {
  col: number;
  row: number;
  laddersNeeded: number;
  steps: number;
  energyCost: number;
}

class ReturnRouteHeap {
  private nodes: ReturnRouteNode[] = [];

  get length(): number {
    return this.nodes.length;
  }

  push(node: ReturnRouteNode): void {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): ReturnRouteNode | undefined {
    const first = this.nodes[0];
    const last = this.nodes.pop();
    if (!first || !last) return first;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private bubbleUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (compareRouteNode(this.nodes[parent], this.nodes[child]) <= 0) break;
      [this.nodes[parent], this.nodes[child]] = [
        this.nodes[child],
        this.nodes[parent],
      ];
      child = parent;
    }
  }

  private bubbleDown(index: number): void {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;
      if (
        left < this.nodes.length &&
        compareRouteNode(this.nodes[left], this.nodes[best]) < 0
      ) {
        best = left;
      }
      if (
        right < this.nodes.length &&
        compareRouteNode(this.nodes[right], this.nodes[best]) < 0
      ) {
        best = right;
      }
      if (best === parent) break;
      [this.nodes[parent], this.nodes[best]] = [
        this.nodes[best],
        this.nodes[parent],
      ];
      parent = best;
    }
  }
}

function compareRouteNode(a: ReturnRouteNode, b: ReturnRouteNode): number {
  return (
    a.laddersNeeded - b.laddersNeeded ||
    a.energyCost - b.energyCost ||
    a.steps - b.steps
  );
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
 * Cheapest known route home through already cleared cells. The search is
 * sparse and capped so the HUD can ask this every render without scanning
 * generated mine space.
 */
export function returnHomeEstimate(state: MineState): ReturnHomeEstimate {
  if (state.miner.row <= 0) {
    return {
      reachable: true,
      laddersNeeded: 0,
      steps: 0,
      energyCost: 0,
      visited: 0,
      capped: false,
    };
  }
  if (isElevatorRailCell(state, state.miner.col, state.miner.row)) {
    return {
      reachable: true,
      laddersNeeded: 0,
      steps: 1,
      energyCost: 0,
      visited: 0,
      capped: false,
    };
  }

  const candidates = new Set<string>();
  const addCandidate = (col: number, row: number): void => {
    if (row < 0 || row > state.miner.row) return;
    candidates.add(coordKey(col, row));
  };
  for (const [key, cell] of state.cells) {
    if (cell.kind !== "empty") continue;
    const [col, row] = parseCoordKey(key);
    if (row < 1 || row > state.miner.row) continue;
    addCandidate(col, row);
    if (row === 1) addCandidate(col, 0);
  }
  addCandidate(state.miner.col, state.miner.row);
  if (state.miner.row === 1) addCandidate(state.miner.col, 0);

  const startKey = coordKey(state.miner.col, state.miner.row);
  if (!candidates.has(startKey)) {
    return blockedReturnEstimate(0, false);
  }

  const heap = new ReturnRouteHeap();
  const best = new Map<
    string,
    Pick<ReturnRouteNode, "laddersNeeded" | "steps" | "energyCost">
  >();
  heap.push({
    col: state.miner.col,
    row: state.miner.row,
    laddersNeeded: 0,
    steps: 0,
    energyCost: 0,
  });
  best.set(startKey, { laddersNeeded: 0, steps: 0, energyCost: 0 });

  let visited = 0;
  while (heap.length > 0) {
    const current = heap.pop();
    if (!current) break;
    const key = coordKey(current.col, current.row);
    const currentBest = best.get(key);
    if (!currentBest || compareRouteCost(current, currentBest) !== 0) continue;
    if (isElevatorRailCell(state, current.col, current.row)) {
      return {
        reachable: true,
        laddersNeeded: current.laddersNeeded,
        steps: current.steps + 1,
        energyCost: current.energyCost,
        visited,
        capped: false,
      };
    }
    if (current.row === 0) {
      return {
        reachable: true,
        laddersNeeded: current.laddersNeeded,
        steps: current.steps,
        energyCost: current.energyCost,
        visited,
        capped: false,
      };
    }
    if (visited >= RETURN_HOME_VISIT_CAP) {
      return blockedReturnEstimate(visited, true);
    }
    visited++;
    for (const next of routeNeighbors(state, candidates, current)) {
      const nextKey = coordKey(next.col, next.row);
      const previous = best.get(nextKey);
      if (previous && compareRouteCost(previous, next) <= 0) continue;
      best.set(nextKey, {
        laddersNeeded: next.laddersNeeded,
        steps: next.steps,
        energyCost: next.energyCost,
      });
      heap.push(next);
    }
  }
  return blockedReturnEstimate(visited, false);
}

/**
 * Ladders still needed to climb home (REQ-020). Existing callers keep the
 * numeric API while the HUD uses the richer route estimate.
 */
export function returnLadderNeed(state: MineState): number {
  return returnHomeEstimate(state).laddersNeeded;
}

function routeNeighbors(
  state: MineState,
  candidates: ReadonlySet<string>,
  current: ReturnRouteNode,
): ReturnRouteNode[] {
  const next: ReturnRouteNode[] = [];
  const here = cellAt(state, current.col, current.row);
  const hasLadder = here?.kind === "empty" && here.ladder === true;
  if (current.row > 0) {
    const row = current.row - 1;
    const key = coordKey(current.col, row);
    if (candidates.has(key)) {
      if (hasLadder || !isElevatorRailCell(state, current.col, current.row)) {
        next.push({
          col: current.col,
          row,
          laddersNeeded: current.laddersNeeded + (hasLadder ? 0 : 1),
          steps: current.steps + 1,
          energyCost: current.energyCost + MOVE_COST,
        });
      }
    }
  }
  for (const col of [current.col - 1, current.col + 1]) {
    const key = coordKey(col, current.row);
    const entersElevator = isElevatorRailCell(state, col, current.row);
    if (
      !candidates.has(key) ||
      (!entersElevator && !isStableReturnCell(state, col, current.row))
    )
      continue;
    next.push({
      col,
      row: current.row,
      laddersNeeded: current.laddersNeeded,
      steps: current.steps + 1,
      energyCost: current.energyCost + (entersElevator ? 0 : MOVE_COST),
    });
  }
  const downRow = current.row + 1;
  if (downRow <= state.miner.row) {
    const key = coordKey(current.col, downRow);
    if (
      candidates.has(key) &&
      isStableReturnCell(state, current.col, downRow)
    ) {
      next.push({
        col: current.col,
        row: downRow,
        laddersNeeded: current.laddersNeeded,
        steps: current.steps + 1,
        energyCost: current.energyCost + MOVE_COST,
      });
    }
  }
  return next;
}

function isStableReturnCell(
  state: MineState,
  col: number,
  row: number,
): boolean {
  if (row === 0) return true;
  const here = cellAt(state, col, row);
  if (here?.kind !== "empty") return false;
  const below = cellAt(state, col, row + 1);
  return !!(
    here.ladder ||
    here.plank ||
    below?.ladder ||
    (below && below.kind !== "empty")
  );
}

function isElevatorRailCell(
  state: MineState,
  col: number,
  row: number,
): boolean {
  const rail = Math.min(state.gear.elevator, MINE_BOTTOM_ROW - 1);
  const column = elevatorColumn(state.gear);
  return column !== null && col === column && row >= 0 && row <= rail;
}

function blockedReturnEstimate(
  visited: number,
  capped: boolean,
): ReturnHomeEstimate {
  return {
    reachable: false,
    laddersNeeded: 0,
    steps: 0,
    energyCost: 0,
    visited,
    capped,
  };
}

function coordKey(col: number, row: number): string {
  return `${col},${row}`;
}

function parseCoordKey(key: string): [number, number] {
  const [col, row] = key.split(",").map(Number);
  return [col, row];
}

function compareRouteCost(
  a: Pick<ReturnRouteNode, "laddersNeeded" | "steps" | "energyCost">,
  b: Pick<ReturnRouteNode, "laddersNeeded" | "steps" | "energyCost">,
): number {
  return (
    a.laddersNeeded - b.laddersNeeded ||
    a.energyCost - b.energyCost ||
    a.steps - b.steps
  );
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
