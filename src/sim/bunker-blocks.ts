/**
 * Bunker interior as a mineable voxel volume (F-115 + F-116).
 *
 * The redesign turns the bunker from a mostly-open 7x5 plane into a
 * solid block of claim rock you dig out: a small pre-mined spawn pocket,
 * every other cell a mineable block generated the SAME way as the
 * surface mine at that depth (so it drops the depth-appropriate ore into
 * your bag), and the `dug` set records depletion so mined-out ore never
 * comes back.
 *
 * Pure sim: no react/three, and randomness comes only from the shared
 * seeded mine generator (integer hashing, no nondeterministic calls).
 * Block kinds come from that generator seeded by a stable per-bunker
 * block seed, so the client preview and the server credit path agree.
 */

import type { BunkerFootprint } from "./bunker";
import type { MineCell } from "./mine/cells";
import { type OreId, oreReserveAt } from "./mine/ores";
import { generatedCell } from "./mine/world";

/** The pre-mined starter room: 3 wide (local x), 3 tall (local y), 3
 * deep (local z), centered on the spawn column at the bunker floor, so
 * the player spawns standing in an open chamber, with headroom overhead
 * and diggable rock a few steps ahead, instead of pressed inside a
 * cramped box. */
export const BUNKER_POCKET_WIDTH = 3;
export const BUNKER_POCKET_HEIGHT = 3;
export const BUNKER_POCKET_DEPTH = 3;

/** One depth layer is offset this far in the generator's column space so
 * the five stacked layers get distinct blocks while sharing each row's
 * depth-appropriate ore odds. A prime keeps the layers from aliasing. */
const BUNKER_DEPTH_COLUMN_STRIDE = 1009;

/** The mineable kinds a bunker block can take. Hazards and specials from
 * the mine generator (gas, magma, boulder, metal, part-cache) are
 * coerced away: a claimed room is stone and ore, not a gas pocket. */
export type BunkerBlockKind = "dirt" | "rock" | "ore";

export interface BunkerBlock {
  kind: BunkerBlockKind;
  /** Set when kind is "ore": which ore the block drops. */
  ore?: OreId;
  /** Set when kind is "rock": appearance tier (dig stays free inside). */
  rockTier?: number;
}

/** A deterministic 32-bit block seed for a bunker, mixed from the mine
 * seed and the claim footprint so a bunker's blocks are stable across
 * sessions and reproducible on the server. Integer math only. */
export function deriveBunkerBlockSeed(
  mineSeed: number,
  footprint: BunkerFootprint,
): number {
  let h = mineSeed | 0;
  h = Math.imul(h ^ (footprint.col | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (footprint.row | 0), 0x165667b1);
  h ^= h >>> 15;
  return h >>> 0;
}

/** The real mine row a bunker cell sits at (deeper rows richer in ore):
 * the bunker spans rows footprint.row .. footprint.row + height - 1, and
 * local y grows upward from the floor. */
export function bunkerCellMineRow(
  footprint: BunkerFootprint,
  y: number,
): number {
  return footprint.row + footprint.height - 1 - y;
}

/**
 * The generator column/row a bunker cell samples. Exposed so first-person
 * ore-crystal art can hash off the SAME cell identity the block kind came
 * from, keeping the crystal layout deterministic with the cell instead of
 * an ad-hoc stride. Integer math only.
 */
export function bunkerCellGenCoords(
  footprint: BunkerFootprint,
  x: number,
  y: number,
  z: number,
): { col: number; row: number } {
  return {
    col: footprint.col + x + z * BUNKER_DEPTH_COLUMN_STRIDE,
    row: bunkerCellMineRow(footprint, y),
  };
}

/**
 * The mineable block at a bunker cell, generated like the surface mine
 * at that depth. `x`/`y`/`z` are room-local (x across, y up from the
 * floor, z into the rock). Each depth layer draws from a distinct slice
 * of generator column space so the layers differ, while the row keeps
 * the depth-appropriate ore odds. Hazards and specials are coerced to
 * plain rock or dirt.
 */
export function bunkerCellBlock(
  blockSeed: number,
  footprint: BunkerFootprint,
  x: number,
  y: number,
  z: number,
): BunkerBlock {
  const { col, row } = bunkerCellGenCoords(footprint, x, y, z);
  return coerceBunkerBlock(generatedCell(blockSeed, col, row));
}

/**
 * The ore a broken bunker block drops (F-116), by ABSOLUTE cell. A block
 * yields the full ore reserve of its mine row, the same total you get from
 * fully mining that cell on the surface, so bunker digging pays the
 * depth-appropriate ore. Rock and dirt drop nothing.
 *
 * A bunker cell's mine row is exactly its absolute `row` (the local-y
 * round-trip through `bunkerCellMineRow` cancels), so the yield reads the
 * reserve at `row` directly. Returns null when the block is not ore or the
 * bunker has no block seed (legacy claims hard-reset per Q-022, and credit
 * nothing in the meantime). Deterministic integer math only.
 */
export function bunkerCellOreYield(
  footprint: BunkerFootprint,
  blockSeed: number | undefined,
  col: number,
  row: number,
  depth: number,
): { ore: OreId; units: number } | null {
  if (blockSeed === undefined) return null;
  const x = col - footprint.col;
  const y = footprint.row + footprint.height - 1 - row;
  const block = bunkerCellBlock(blockSeed, footprint, x, y, depth);
  if (block.kind !== "ore" || !block.ore) return null;
  const units = oreReserveAt(block.ore, row);
  if (units <= 0) return null;
  return { ore: block.ore, units };
}

/** Reduce a raw mine cell to a bunker block: keep ore and plain rock,
 * fold every hazard/special/empty into dirt or rock. */
function coerceBunkerBlock(cell: MineCell): BunkerBlock {
  if (cell.kind === "ore" && cell.ore) {
    return { kind: "ore", ore: cell.ore };
  }
  if (cell.kind === "rock") {
    return { kind: "rock", rockTier: cell.rockTier ?? 0 };
  }
  // boulder / magma / metal read as harder stone; everything else
  // (dirt, gas, part-cache, empty) reads as plain dirt.
  if (
    cell.kind === "boulder" ||
    cell.kind === "magma" ||
    cell.kind === "metal"
  ) {
    return { kind: "rock", rockTier: cell.rockTier ?? 1 };
  }
  return { kind: "dirt" };
}

/**
 * True when a local cell falls inside the pre-mined spawn pocket around
 * `spawnX` on the bunker floor. The pocket is clamped into the volume by
 * the caller's grid bounds; this only tests membership by offset.
 */
export function isBunkerPocketCell(
  spawnX: number,
  x: number,
  y: number,
  z: number,
): boolean {
  const half = (BUNKER_POCKET_WIDTH - 1) / 2;
  return (
    x >= spawnX - half &&
    x <= spawnX + half &&
    y >= 0 &&
    y < BUNKER_POCKET_HEIGHT &&
    z >= 0 &&
    z < BUNKER_POCKET_DEPTH
  );
}

/**
 * The absolute {col,row,depth} cells of the pre-mined spawn pocket for a
 * footprint: a 3x3x3 room centered on the spawn column at the floor.
 * Seeded into the bunker's `dug` set at claim so the player spawns
 * inside an open room instead of a solid-rock trap. Local y grows up
 * from the floor (row = bottomRow - y); depth grows into the rock.
 */
export function bunkerSpawnPocketCells(
  footprint: BunkerFootprint,
): Array<{ col: number; row: number; depth: number }> {
  const spawnX = Math.floor(footprint.width / 2);
  const half = (BUNKER_POCKET_WIDTH - 1) / 2;
  const bottomRow = footprint.row + footprint.height - 1;
  const cells: Array<{ col: number; row: number; depth: number }> = [];
  for (let z = 0; z < BUNKER_POCKET_DEPTH; z++) {
    for (let y = 0; y < BUNKER_POCKET_HEIGHT; y++) {
      for (let dx = -half; dx <= half; dx++) {
        cells.push({
          col: footprint.col + spawnX + dx,
          row: bottomRow - y,
          depth: z,
        });
      }
    }
  }
  return cells;
}

/**
 * Union the spawn pocket into a dug set, deduped. Load boundaries call
 * this so every bunker, including legacy claims stored before the
 * dig-out redesign, always ships an open spawn room. Without it a
 * pre-F-115 bunker (dug set from the old depth-0-open model) would spawn
 * the player inside solid rock.
 */
export function withSpawnPocket(
  footprint: BunkerFootprint,
  dug: Array<{ col: number; row: number; depth: number }>,
): Array<{ col: number; row: number; depth: number }> {
  const seen = new Set(dug.map((cell) => cellKey(cell)));
  const merged = [...dug];
  for (const cell of bunkerSpawnPocketCells(footprint)) {
    const key = cellKey(cell);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cell);
  }
  return merged;
}

function cellKey(cell: { col: number; row: number; depth: number }): string {
  return `${cell.col},${cell.row},${cell.depth}`;
}
