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
 * owns the pending/banked branch, inventory guards, and feedback.
 * "collect" fires when the player walks over an overflow-loot cell. */
export interface FpEditIntent {
  kind: "place" | "pry" | "dig" | "collect";
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
  return value === FP_SOLID_PART || value === FP_ROCK_UNDUG;
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

/**
 * The local cell the player spawns in. The rig plants the feet on the room
 * floor (local y 0) at the front depth (z 0), so the spawn cell MUST be a
 * STANDABLE floor-front cell or the player materializes inside a blocker.
 * We select against the final collision grid, which stamps BOTH undug claim
 * rock (every cell starts solid; only the dug set, including the pre-mined
 * spawn pocket, is open) AND placed parts (walls, floors, roofs, turrets),
 * so a normal entry into a built-out base cannot land inside a part either.
 * Returns the standable floor-front cell nearest the miner's entry column,
 * scanning outward. If the whole front floor row is walled off, it takes any
 * standable cell in the volume (preferring the lowest, nearest-to-front,
 * nearest-to-entry one, so gravity and the movement push-out settle it in a
 * step) rather than trusting a centre that could also be blocked, and only
 * falls back to the footprint centre when nothing is open at all (which the
 * preserved pocket rules out). The miner's row is ignored: the rig grounds
 * the player on the floor regardless of where along the tunnel they entered.
 */
export function fpSpawnCell(
  solid: FpSolidGrid,
  footprint: BunkerFootprint,
  minerCol: number,
): FpLocalCell {
  const clampedLocal = Math.min(
    Math.max(minerCol - footprint.col, 0),
    FP_COLS - 1,
  );
  // 1) Nearest standable cell on the floor-front row, scanning outward.
  for (let d = 0; d < FP_COLS; d++) {
    const left = clampedLocal - d;
    if (left >= 0 && !fpCellBlocks(solid[fpCellIndex(left, 0, 0)])) {
      return { x: left, y: 0, z: 0 };
    }
    const right = clampedLocal + d;
    if (
      d > 0 &&
      right < FP_COLS &&
      !fpCellBlocks(solid[fpCellIndex(right, 0, 0)])
    ) {
      return { x: right, y: 0, z: 0 };
    }
  }
  // 2) Front floor fully blocked: take any standable cell, scored so the
  // lowest / nearest-to-front / nearest-to-entry one wins (a short fall).
  let best: FpLocalCell | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = 0; y < FP_ROWS; y++) {
    for (let z = 0; z < FP_DEPTH; z++) {
      for (let x = 0; x < FP_COLS; x++) {
        if (fpCellBlocks(solid[fpCellIndex(x, y, z)])) continue;
        const score = y * 1000 + z * 100 + Math.abs(x - clampedLocal);
        if (score < bestScore) {
          bestScore = score;
          best = { x, y, z };
        }
      }
    }
  }
  if (best) return best;
  // 3) Nothing open anywhere (impossible while the pocket is preserved).
  return { x: Math.floor(FP_COLS / 2), y: 0, z: 0 };
}

/**
 * Fills all 175 cells of `out` from the bunker state. Every cell starts
 * as solid claim rock (F-115/F-116); the dug set (including the depth-0
 * plane and the pre-mined spawn pocket) opens cells, then parts stamp
 * their solidity over what they occupy. Legacy wire shapes (parts
 * without depth, bunkers without dug) normalize to an unexcavated
 * interior.
 */
export function buildFpSolidGrid(bunker: BunkerState, out: FpSolidGrid): void {
  out.fill(FP_ROCK_UNDUG);
  const footprint = bunker.footprint;
  const bottomRow = footprint.row + footprint.height - 1;
  for (const cell of bunker.dug ?? []) {
    const x = cell.col - footprint.col;
    const y = bottomRow - cell.row;
    const z = cell.depth;
    if (!fpCellInGrid(x, y, z)) continue;
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
}
