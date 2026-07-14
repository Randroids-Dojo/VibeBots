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
import type { OreId } from "./mine/ores";
import { generatedCell } from "./mine/world";

/** The pre-mined starter room: 3 wide (local x), 2 tall (local y), 2
 * deep (local z), centered on the spawn column at the bunker floor, so
 * the player clearly stands inside a room facing diggable rock. */
export const BUNKER_POCKET_WIDTH = 3;
export const BUNKER_POCKET_HEIGHT = 2;
export const BUNKER_POCKET_DEPTH = 2;

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
  const row = bunkerCellMineRow(footprint, y);
  const col = footprint.col + x + z * BUNKER_DEPTH_COLUMN_STRIDE;
  return coerceBunkerBlock(generatedCell(blockSeed, col, row));
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
