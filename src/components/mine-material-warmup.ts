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
  cellJointMaterial,
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
  rockColorsForBiome,
  STRATA_DIRT,
  TECH_DIRT_BAND,
  tunnelColorForBiome,
  WINTER_DIRT_BAND,
} from "./mine-render-palette";

const DIRT_TINTS = [...STRATA_DIRT, ...WINTER_DIRT_BAND, ...TECH_DIRT_BAND];
const ROCK_TINTS = [
  ...rockColorsForBiome("default"),
  ...rockColorsForBiome("winter"),
  ...rockColorsForBiome("highTech"),
];
const TUNNEL_TINTS = [
  tunnelColorForBiome("default"),
  tunnelColorForBiome("winter"),
  tunnelColorForBiome("highTech"),
];

/**
 * The dirt/ore/rock/metal bodies the instanced grid streams. Warmed on an
 * InstancedMesh (three compiles a distinct program for the instanced draw,
 * which carries the instanceMatrix attribute) AND on a plain mesh via
 * collectBlockNodeMaterials, because MineBlockBody still draws them plain
 * for teetering/fallen cells and the Holodeck.
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
 * Everything the instanced grid streams: the solid bodies plus the tunnel
 * floors (instanced-only since the floors left the React path; the canvas
 * adds its local darkness buckets itself). Warm these on an InstancedMesh.
 */
export function collectInstancedGridMaterials(
  detail: boolean,
): MeshStandardNodeMaterial[] {
  const materials = collectInstancedBodyMaterials(detail);
  for (const tint of DIRT_TINTS) materials.push(cellJointMaterial(tint));
  for (const tint of TUNNEL_TINTS) materials.push(tunnelFloorMaterial(tint));
  return materials;
}

/**
 * Every node-material variant a mine cell body or overlay can render on a
 * plain mesh at the given detail tier (tunnel floors are instanced-only,
 * so they warm through collectInstancedGridMaterials instead). Returned
 * for the canvas to compile up front; the factories dedupe through their
 * caches, so warming then playing reuses the exact same singletons.
 */
export function collectBlockNodeMaterials(
  detail: boolean,
): MeshStandardNodeMaterial[] {
  const materials = collectInstancedBodyMaterials(detail);
  materials.push(gasBlockMaterial(GAS_COLOR, detail));
  materials.push(boulderBlockMaterial(BOULDER_COLOR, detail));
  for (const ore of Object.keys(ORE_COLORS) as OreId[]) {
    materials.push(
      crystalMaterial(ORE_COLORS[ore], GLOWING_ORES.has(ore), detail),
    );
  }
  return materials;
}
