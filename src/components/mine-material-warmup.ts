/**
 * Material warm-up set (shader-compile stall fix). three compiles each
 * material program lazily on its first draw, so a new tint/kind appearing
 * mid-play (descending a stratum, an ore crystal, a gas pocket) blocks the
 * frame while the driver compiles, tens to hundreds of ms on a phone and
 * seconds for the high-tier node shaders even on a fast desktop GPU. This
 * enumerates every block/crystal/tunnel node-material variant the mine can
 * show so the canvas can compile them once behind the load, not one hitch
 * at a time during play. Calling a factory returns its cached singleton,
 * so collecting is cheap and populates the caches as a side effect.
 */

import type { MeshStandardNodeMaterial } from "three/webgpu";
import type { OreId } from "@/sim/mine";
import {
  boulderBlockMaterial,
  crystalMaterial,
  dirtBlockMaterial,
  gasBlockMaterial,
  metalBlockMaterial,
  rockBlockMaterial,
  tunnelFloorMaterial,
} from "./mine-block-materials";
import {
  BOULDER_COLOR,
  GAS_COLOR,
  GLOWING_ORES,
  METAL_COLOR,
  ORE_COLORS,
  ROCK_COLORS,
  STRATA_DIRT,
  TECH_DIRT_BAND,
  TECH_ROCK_COLORS,
  tunnelColorForBiome,
  WINTER_DIRT_BAND,
  WINTER_ROCK_COLORS,
} from "./mine-render-palette";

const DIRT_TINTS = [...STRATA_DIRT, ...WINTER_DIRT_BAND, ...TECH_DIRT_BAND];
const ROCK_TINTS = [...ROCK_COLORS, ...WINTER_ROCK_COLORS, ...TECH_ROCK_COLORS];
const TUNNEL_TINTS = [
  tunnelColorForBiome("default"),
  tunnelColorForBiome("winter"),
  tunnelColorForBiome("highTech"),
];

/**
 * The dirt/ore/rock/metal bodies the instanced grid streams. These must be
 * warmed on an InstancedMesh: three compiles a distinct program for the
 * instanced draw (it carries the instanceMatrix attribute), so warming
 * them on a plain mesh would miss the program the grid actually uses.
 */
export function collectInstancedBodyMaterials(
  detail: boolean,
): MeshStandardNodeMaterial[] {
  const materials: MeshStandardNodeMaterial[] = [];
  for (const tint of DIRT_TINTS)
    materials.push(dirtBlockMaterial(tint, detail));
  for (const tint of ROCK_TINTS)
    materials.push(rockBlockMaterial(tint, detail));
  materials.push(metalBlockMaterial(METAL_COLOR, detail));
  return materials;
}

/**
 * Every node-material variant a mine cell body or overlay can render at
 * the given detail tier. Returned for the canvas to compile up front; the
 * factories dedupe through their caches, so warming then playing reuses
 * the exact same singletons.
 */
export function collectBlockNodeMaterials(
  detail: boolean,
): MeshStandardNodeMaterial[] {
  const materials: MeshStandardNodeMaterial[] = [];
  for (const tint of DIRT_TINTS)
    materials.push(dirtBlockMaterial(tint, detail));
  for (const tint of ROCK_TINTS)
    materials.push(rockBlockMaterial(tint, detail));
  for (const tint of TUNNEL_TINTS) materials.push(tunnelFloorMaterial(tint));
  materials.push(metalBlockMaterial(METAL_COLOR, detail));
  materials.push(gasBlockMaterial(GAS_COLOR, detail));
  materials.push(boulderBlockMaterial(BOULDER_COLOR, detail));
  for (const ore of Object.keys(ORE_COLORS) as OreId[]) {
    materials.push(
      crystalMaterial(ORE_COLORS[ore], GLOWING_ORES.has(ore), detail),
    );
  }
  return materials;
}
