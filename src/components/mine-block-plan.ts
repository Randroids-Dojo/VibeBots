/**
 * Pure planning core for the instanced block grid (mine-instanced-grid.ts
 * owns the three glue). This file carries no runtime three import (the
 * geometry/material references are type-only and erase at compile), so the
 * classification and the pooled plan list stay node-testable.
 *
 * Frame-loop rule: pushBlockInstance runs at input cadence (once per
 * visible cell per store tick), never per frame. The plan reuses its
 * pooled entries across ticks, so steady-state filling allocates nothing;
 * only the tail grows, and only once.
 */

import type { BufferGeometry, Material } from "three/webgpu";
import type { MineCell } from "@/sim/mine";

/** One block to draw this tick: a shared geometry + material and the
 * cell's world transform. `z` is the class's constant depth offset
 * (solid bodies 0, tunnel floors recessed, darkness veils raised). */
export interface BlockInstance {
  geometry: BufferGeometry;
  material: Material;
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  /** Skip the quaternion build when the block sits axis-aligned. */
  rotated: boolean;
}

/** A reusable, growable list of block instances the render fills each
 * tick. `count` is the live length; entries past it are stale scratch. */
export interface BlockInstancePlan {
  items: BlockInstance[];
  count: number;
}

/** A fresh, empty block-instance plan (one per canvas, kept in a ref). */
export function createBlockInstancePlan(): BlockInstancePlan {
  return { items: [], count: 0 };
}

/** Reset the plan for a fresh tick, returning it for chaining. */
export function beginBlockPlan(plan: BlockInstancePlan): BlockInstancePlan {
  plan.count = 0;
  return plan;
}

/** Append one block, reusing the pooled entry at the write index (only the
 * tail grows, and only once, so steady-state ticks allocate nothing). */
export function pushBlockInstance(
  plan: BlockInstancePlan,
  geometry: BufferGeometry,
  material: Material,
  x: number,
  y: number,
  z: number,
  rotX: number,
  rotY: number,
  rotZ: number,
): void {
  let entry = plan.items[plan.count];
  if (entry === undefined) {
    entry = { geometry, material, x, y, z, rotX, rotY, rotZ, rotated: false };
    plan.items[plan.count] = entry;
  } else {
    entry.geometry = geometry;
    entry.material = material;
    entry.x = x;
    entry.y = y;
    entry.z = z;
    entry.rotX = rotX;
    entry.rotY = rotY;
    entry.rotZ = rotZ;
  }
  entry.rotated = rotX !== 0 || rotY !== 0 || rotZ !== 0;
  plan.count += 1;
}

/**
 * Single source of truth for which cells the instanced grid draws. True
 * for the static solid bodies the grid streams (dirt, ore, non-fallen
 * rock, metal); false for cells the mine canvas keeps in React: teetering
 * or fallen blocks (they wobble on individual transforms) and the
 * inline-material kinds (boulder, magma, gas, part-cache) and empty
 * tunnels. buildCellEntry gates its body branches on this; the render loop
 * fills the instance plan with instancedBlockBody for the same cells.
 * Tunnel floors and darkness veils also ride the plan (pushed directly by
 * the render loop with their class z offset), but they are overlays on
 * empty/edge cells, not bodies, so they do not go through this gate.
 */
export function instancedBlockDraw(cell: MineCell): boolean {
  if (cell.fallIn !== undefined) return false;
  switch (cell.kind) {
    case "ore":
      return cell.ore !== undefined;
    case "rock":
      return cell.fallen !== true;
    case "metal":
    case "dirt":
      return true;
    default:
      return false;
  }
}
