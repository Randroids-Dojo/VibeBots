import {
  BUNKER_CLAIM_DEPTH,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  type BunkerFootprint,
  type BunkerState,
} from "@/sim/bunker";

/**
 * Solidity grid for the first-person bunker viewer. Pure module (no
 * three imports) so movement and mapping unit-test in node.
 *
 * Room-local space: x = col - footprint.col (0..6), y counts UP from
 * the footprint's BOTTOM row (0..4), z = depth (0..4). A cell's world
 * position is (x, y, -z): the camera walks negative world z as it
 * heads deeper into the claim rock.
 */

export const FP_COLS = BUNKER_CLAIM_WIDTH;
export const FP_ROWS = BUNKER_CLAIM_HEIGHT;
export const FP_DEPTH = BUNKER_CLAIM_DEPTH;
export const FP_CELL_COUNT = FP_COLS * FP_ROWS * FP_DEPTH;

/** Walkable air (or an excavated cell). */
export const FP_OPEN = 0;
/** A placed blocking part (wall, floor, roof, turret pedestal). */
export const FP_SOLID_PART = 1;
/** The bunker core: solid so the player cannot stand inside it. */
export const FP_CORE = 2;
/** Floor spikes: walkable for the owner, rendered in the cell. */
export const FP_SPIKES = 3;
/** Undug claim rock (depths 1-4): solid until excavated. */
export const FP_ROCK_UNDUG = 4;
/** The owner's door: renders closed but the owner passes through. */
export const FP_DOOR_OWNED = 5;

export type FpSolidGrid = Uint8Array;

export interface FpLocalCell {
  x: number;
  y: number;
  z: number;
}

/** A bunker cell in mine-grid coordinates plus depth (the sim's
 * col/row/depth addressing for place/remove/move/excavate). */
export interface FpEditCell {
  col: number;
  row: number;
  depth: number;
}

/** An edit the first-person canvas asks mine-panel to apply. The panel
 * owns the pending/banked branch, inventory guards, and feedback. */
export interface FpEditIntent {
  kind: "place" | "pry" | "dig";
  cell: FpEditCell;
}

/** Maps a room-local cell back to mine-grid coordinates (the inverse
 * of fpLocalFromGrid). Allocates; call at input cadence, not per
 * frame. */
export function fpGridCellFromLocal(
  footprint: BunkerFootprint,
  x: number,
  y: number,
  z: number,
): FpEditCell {
  return {
    col: footprint.col + x,
    row: footprint.row + footprint.height - 1 - y,
    depth: z,
  };
}

export function createFpSolidGrid(): FpSolidGrid {
  return new Uint8Array(FP_CELL_COUNT);
}

export function fpCellIndex(x: number, y: number, z: number): number {
  return x + y * FP_COLS + z * FP_COLS * FP_ROWS;
}

export function fpCellInGrid(x: number, y: number, z: number): boolean {
  return (
    x >= 0 && x < FP_COLS && y >= 0 && y < FP_ROWS && z >= 0 && z < FP_DEPTH
  );
}

/** True when a solidity value blocks movement. Open cells, spikes
 * (owner-immune), and the owner's door all pass. */
export function fpCellBlocks(value: number): boolean {
  return (
    value === FP_SOLID_PART || value === FP_CORE || value === FP_ROCK_UNDUG
  );
}

/**
 * True when the cell has no passable lateral neighbor: all four of
 * +x/-x/+z/-z blocked at feet level (out-of-grid neighbors are
 * boundary rock). Prying a neighboring part refunds it and opens the
 * cell immediately, so the hint stands down through the normal grid
 * rebuild.
 */
export function fpCellBoxedIn(
  solid: FpSolidGrid,
  x: number,
  y: number,
  z: number,
): boolean {
  for (let side = 0; side < 4; side++) {
    const nx = side === 0 ? x + 1 : side === 1 ? x - 1 : x;
    const nz = side === 2 ? z + 1 : side === 3 ? z - 1 : z;
    if (!fpCellInGrid(nx, y, nz)) continue;
    if (!fpCellBlocks(solid[fpCellIndex(nx, y, nz)])) return false;
  }
  return true;
}

/** Maps a mine-grid cell into room-local fp space, writing into `out`
 * (frame loops pass a hoisted scratch object). The footprint's bottom
 * row is y 0; y grows upward. */
export function fpLocalFromGrid(
  footprint: BunkerFootprint,
  col: number,
  row: number,
  depth: number,
  out: FpLocalCell,
): FpLocalCell {
  out.x = col - footprint.col;
  out.y = footprint.row + footprint.height - 1 - row;
  out.z = depth;
  return out;
}

/** The local cell the player spawns in: the miner's mine-grid cell on
 * the tunnel plane (z 0), clamped into the footprint defensively. */
export function fpSpawnCell(
  footprint: BunkerFootprint,
  minerCol: number,
  minerRow: number,
): FpLocalCell {
  const col = Math.min(
    Math.max(minerCol, footprint.col),
    footprint.col + footprint.width - 1,
  );
  const row = Math.min(
    Math.max(minerRow, footprint.row),
    footprint.row + footprint.height - 1,
  );
  return {
    x: col - footprint.col,
    y: footprint.row + footprint.height - 1 - row,
    z: 0,
  };
}

/**
 * Fills all 175 cells of `out` from the bunker state. Depth 0 is open
 * by claim; depths 1-4 are rock unless dug. Parts and the core then
 * stamp their solidity over the open cells they occupy. Legacy wire
 * shapes (parts without depth, bunkers without dug) normalize to the
 * tunnel plane and an unexcavated interior.
 */
export function buildFpSolidGrid(bunker: BunkerState, out: FpSolidGrid): void {
  const planeCells = FP_COLS * FP_ROWS;
  for (let z = 0; z < FP_DEPTH; z++) {
    const base = z * planeCells;
    const fill = z === 0 ? FP_OPEN : FP_ROCK_UNDUG;
    for (let i = 0; i < planeCells; i++) out[base + i] = fill;
  }
  const footprint = bunker.footprint;
  const bottomRow = footprint.row + footprint.height - 1;
  for (const cell of bunker.dug ?? []) {
    const x = cell.col - footprint.col;
    const y = bottomRow - cell.row;
    const z = cell.depth;
    if (!fpCellInGrid(x, y, z) || z === 0) continue;
    out[fpCellIndex(x, y, z)] = FP_OPEN;
  }
  for (const part of bunker.parts) {
    const x = part.col - footprint.col;
    const y = bottomRow - part.row;
    const z = part.depth ?? 0;
    if (!fpCellInGrid(x, y, z)) continue;
    out[fpCellIndex(x, y, z)] =
      part.partId === "door-panel"
        ? FP_DOOR_OWNED
        : part.partId === "floor-spikes"
          ? FP_SPIKES
          : FP_SOLID_PART;
  }
  const coreX = bunker.core.col - footprint.col;
  const coreY = bottomRow - bunker.core.row;
  const coreZ = bunker.core.depth ?? 0;
  if (fpCellInGrid(coreX, coreY, coreZ)) {
    out[fpCellIndex(coreX, coreY, coreZ)] = FP_CORE;
  }
}
