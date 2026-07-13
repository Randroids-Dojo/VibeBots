import { type BunkerFootprint, containsBunkerCell } from "@/sim/bunker";
import type { MineCoord } from "@/sim/mine";

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

export function bunkerBuildTarget(
  origin: MineCoord,
  direction: BunkerBuildDirection,
  footprint: BunkerFootprint,
): MineCoord | null {
  const { dc, dr } = bunkerBuildDirectionVector(direction);
  const target = { col: origin.col + dc, row: origin.row + dr };
  return containsBunkerCell(footprint, target.col, target.row) ? target : null;
}

export function bunkerConstructionProgress(hit: number): number {
  return Math.max(0, Math.min(1, hit / BUNKER_BUILD_HITS));
}
