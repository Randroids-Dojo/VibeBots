import {
  type BunkerFootprint,
  type BunkerState,
  containsBunkerCell,
} from "@/sim/bunker";
import {
  cellAt,
  type Direction,
  type MineCoord,
  type MineState,
} from "@/sim/mine";

export const BUNKER_BUILD_DIRECTIONS = [
  "up",
  "up-right",
  "right",
  "down-right",
  "down",
  "down-left",
  "left",
  "up-left",
] as const;

export type BunkerBuildDirection = (typeof BUNKER_BUILD_DIRECTIONS)[number];

export const BUNKER_BUILD_HITS = 4;

const CARDINAL_STEPS: ReadonlyArray<{
  direction: Direction;
  dc: number;
  dr: number;
}> = [
  { direction: "up", dc: 0, dr: -1 },
  { direction: "right", dc: 1, dr: 0 },
  { direction: "down", dc: 0, dr: 1 },
  { direction: "left", dc: -1, dr: 0 },
];

export function bunkerBuildDirectionFromVector(
  x: number,
  y: number,
): BunkerBuildDirection | null {
  if (x === 0 && y === 0) return null;
  const angle = Math.atan2(y, x);
  const octant = Math.round(angle / (Math.PI / 4));
  const index = (octant + 8) % 8;
  return [
    "right",
    "down-right",
    "down",
    "down-left",
    "left",
    "up-left",
    "up",
    "up-right",
  ][index] as BunkerBuildDirection;
}

export function bunkerBuildDirectionVector(direction: BunkerBuildDirection): {
  dc: number;
  dr: number;
} {
  return {
    dc: direction.includes("left") ? -1 : direction.includes("right") ? 1 : 0,
    dr: direction.includes("up") ? -1 : direction.includes("down") ? 1 : 0,
  };
}

export function advanceBunkerBuildCursor(
  cursor: MineCoord | null,
  origin: MineCoord,
  direction: BunkerBuildDirection,
  footprint: BunkerFootprint,
): MineCoord {
  const start = cursor ?? origin;
  const { dc, dr } = bunkerBuildDirectionVector(direction);
  const next = { col: start.col + dc, row: start.row + dr };
  return containsBunkerCell(footprint, next.col, next.row) ? next : start;
}

function coordKey(col: number, row: number): string {
  return `${col}:${row}`;
}

function bunkerCellWalkable(
  mine: MineState,
  bunker: BunkerState,
  col: number,
  row: number,
  start: MineCoord,
  target: MineCoord,
): boolean {
  if (!containsBunkerCell(bunker.footprint, col, row)) return false;
  if (col === target.col && row === target.row) return false;
  if (col === start.col && row === start.row) return true;
  if (cellAt(mine, col, row)?.kind !== "empty") return false;
  if (bunker.core.col === col && bunker.core.row === row) return false;
  return !bunker.parts.some((part) => part.col === col && part.row === row);
}

export function bunkerBuildPath(
  mine: MineState,
  bunker: BunkerState,
  target: MineCoord,
  options: { allowOccupiedTarget?: boolean } = {},
): Direction[] | null {
  if (!containsBunkerCell(bunker.footprint, target.col, target.row))
    return null;
  if (cellAt(mine, target.col, target.row)?.kind !== "empty") return null;
  if (bunker.core.col === target.col && bunker.core.row === target.row)
    return null;
  if (
    !options.allowOccupiedTarget &&
    bunker.parts.some(
      (part) => part.col === target.col && part.row === target.row,
    )
  ) {
    return null;
  }

  const start = { col: mine.miner.col, row: mine.miner.row };
  const startKey = coordKey(start.col, start.row);
  const queue: MineCoord[] = [start];
  const directions = new Map<string, Direction[]>();
  directions.set(startKey, []);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const path = directions.get(coordKey(current.col, current.row)) ?? [];
    if (
      Math.abs(current.col - target.col) +
        Math.abs(current.row - target.row) ===
      1
    ) {
      return path;
    }
    for (const step of CARDINAL_STEPS) {
      const col = current.col + step.dc;
      const row = current.row + step.dr;
      const key = coordKey(col, row);
      if (directions.has(key)) continue;
      if (!bunkerCellWalkable(mine, bunker, col, row, start, target)) continue;
      directions.set(key, [...path, step.direction]);
      queue.push({ col, row });
    }
  }
  return null;
}

export function bunkerConstructionProgress(hit: number): number {
  return Math.max(0, Math.min(1, hit / BUNKER_BUILD_HITS));
}
