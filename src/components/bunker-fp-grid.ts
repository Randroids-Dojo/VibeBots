import {
  BUNKER_CLAIM_DEPTH,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  type BunkerFootprint,
  type BunkerState,
} from "@/sim/bunker";
import { bunkerCellBlock, bunkerCellGenCoords } from "@/sim/bunker-blocks";
import type { OreId } from "@/sim/mine/ores";

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

/** Face neighbors paired with the rotation that turns an OreCrystals
 * cluster's local +Z toward that face. Grid z maps to world -z (worldZ =
 * -depth), so a shallower open neighbor (dz -1) faces world +Z (identity).
 * Ordered by how visible the face usually is from the dug-in side: the
 * pocket-facing shallow face first, then the side walls, then floor and
 * ceiling, then the deep back face last. */
export const FP_ORE_FACES: readonly {
  d: readonly [number, number, number];
  rot: readonly [number, number, number];
}[] = [
  { d: [0, 0, -1], rot: [0, 0, 0] },
  { d: [1, 0, 0], rot: [0, Math.PI / 2, 0] },
  { d: [-1, 0, 0], rot: [0, -Math.PI / 2, 0] },
  { d: [0, 1, 0], rot: [-Math.PI / 2, 0, 0] },
  { d: [0, -1, 0], rot: [Math.PI / 2, 0, 0] },
  { d: [0, 0, 1], rot: [0, Math.PI, 0] },
];

/** A crystal cluster the fp viewer overlays on an undug cell. Either a
 * fully exposed vein (`hint` false, crystals on the block's own open face)
 * or a buried vein glimpsed through the dirt/rock wall in front of it
 * (`hint` true), so digging reads like the 2D mine: the ore shows before
 * you break through. `key` is the cell's fp index (stable identity). */
export interface FpOreVein {
  key: number;
  x: number;
  y: number;
  z: number;
  hashCol: number;
  hashRow: number;
  ore: OreId;
  rot: readonly [number, number, number];
  hint: boolean;
}

/** The first face of an undug cell that opens onto dug/open space, or null
 * when the cell is fully buried. Prefers the pocket-facing shallow face so
 * a vein exposed from a side, floor, ceiling, or back still points into
 * the gap instead of poking into solid rock. */
function fpFirstExposedFace(
  grid: FpSolidGrid,
  x: number,
  y: number,
  z: number,
): (typeof FP_ORE_FACES)[number] | null {
  for (const face of FP_ORE_FACES) {
    const nx = x + face.d[0];
    const ny = y + face.d[1];
    const nz = z + face.d[2];
    if (nx < 0 || nx >= FP_COLS || ny < 0 || ny >= FP_ROWS) continue;
    if (nz < 0 || nz >= FP_DEPTH) continue;
    if (grid[fpCellIndex(nx, ny, nz)] === FP_OPEN) return face;
  }
  return null;
}

/**
 * Every ore crystal cluster the fp viewer should draw over the claim rock,
 * given the current solidity grid. Two kinds:
 *
 * - Fully exposed veins: an ore block with an open face renders its
 *   crystals on that face (the vein you can mine right now).
 * - Buried hints: a dirt or rock wall facing the open pocket whose cell one
 *   step deeper is an ore block renders a faint recessed cluster, so the
 *   ore reads through the wall before it is dug, like the 2D mine.
 *
 * The hint borrows the buried ore's generator coords and ore id so the
 * cluster it shows matches the vein that gets exposed once the wall breaks.
 * Pure (no three), so it unit-tests in node. Returns [] when the bunker
 * has no block seed (legacy claims render no ore until reset, Q-022).
 */
export function fpOreVeins(
  bunker: BunkerState,
  grid: FpSolidGrid,
): FpOreVein[] {
  const veins: FpOreVein[] = [];
  const blockSeed = bunker.blockSeed;
  if (blockSeed === undefined) return veins;
  const footprint = bunker.footprint;
  for (let z = 0; z < FP_DEPTH; z++) {
    for (let y = 0; y < FP_ROWS; y++) {
      for (let x = 0; x < FP_COLS; x++) {
        if (grid[fpCellIndex(x, y, z)] !== FP_ROCK_UNDUG) continue;
        const face = fpFirstExposedFace(grid, x, y, z);
        if (!face) continue;
        const block = bunkerCellBlock(blockSeed, footprint, x, y, z);
        if (block.kind === "ore" && block.ore) {
          const art = bunkerCellGenCoords(footprint, x, y, z);
          veins.push({
            key: fpCellIndex(x, y, z),
            x,
            y,
            z,
            hashCol: art.col,
            hashRow: art.row,
            ore: block.ore,
            rot: face.rot,
            hint: false,
          });
          continue;
        }
        // A dirt or rock wall: peek one cell deeper (away from the open
        // face) for a buried ore vein to hint at.
        const dx = x - face.d[0];
        const dy = y - face.d[1];
        const dz = z - face.d[2];
        if (dx < 0 || dx >= FP_COLS || dy < 0 || dy >= FP_ROWS) continue;
        if (dz < 0 || dz >= FP_DEPTH) continue;
        if (grid[fpCellIndex(dx, dy, dz)] !== FP_ROCK_UNDUG) continue;
        const deep = bunkerCellBlock(blockSeed, footprint, dx, dy, dz);
        if (deep.kind !== "ore" || !deep.ore) continue;
        const art = bunkerCellGenCoords(footprint, dx, dy, dz);
        veins.push({
          key: fpCellIndex(x, y, z),
          x,
          y,
          z,
          hashCol: art.col,
          hashRow: art.row,
          ore: deep.ore,
          rot: face.rot,
          hint: true,
        });
      }
    }
  }
  return veins;
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
