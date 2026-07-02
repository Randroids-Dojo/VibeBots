/**
 * Shared TSL materials for the surface village structures (world-art
 * slice W2). The same recipe as the block materials: one material per
 * palette role, spatial grain on the high tier, flat color on the low
 * tier and non-WebGPU backends. Meshes attach with dispose={null} (or
 * primitive attach), never dispose these singletons.
 */

import { float, positionWorld, sin } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { cached, grainNoise, tintUniform } from "./mine-block-materials";

function build(
  key: string,
  baseHex: string,
  detail: boolean,
  configure: (material: MeshStandardNodeMaterial, detailOn: boolean) => void,
): MeshStandardNodeMaterial {
  return cached(`surface:${key}:${baseHex}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.colorNode = tintUniform(baseHex);
    configure(material, detail);
    return material;
  });
}

/** Quarried stone: mottled, matte. */
export function surfaceStone(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return build("stone", baseHex, detail, (material, detailOn) => {
    material.metalness = 0.02;
    if (!detailOn) {
      material.roughness = 0.85;
      return;
    }
    const mottle = grainNoise(11);
    material.colorNode = tintUniform(baseHex).mul(
      float(0.9).add(mottle.mul(0.16)),
    );
    material.roughnessNode = float(0.78).add(mottle.mul(0.16));
  });
}

/** Sawn timber: vertical wood striations. */
export function surfaceTimber(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return build("timber", baseHex, detail, (material, detailOn) => {
    material.metalness = 0;
    if (!detailOn) {
      material.roughness = 0.85;
      return;
    }
    const rings = sin(positionWorld.x.mul(38).add(grainNoise(5).mul(4)))
      .mul(0.5)
      .add(0.5);
    material.colorNode = tintUniform(baseHex).mul(
      float(0.88).add(rings.mul(0.1)).add(grainNoise(13).mul(0.08)),
    );
    material.roughnessNode = float(0.8).add(rings.mul(0.12));
  });
}

/** Structural metal trim: lightly brushed, catches the environment. */
export function surfaceMetal(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return build("metal", baseHex, detail, (material, detailOn) => {
    material.metalness = 0.75;
    if (!detailOn) {
      material.roughness = 0.35;
      return;
    }
    const brush = sin(positionWorld.y.mul(52)).mul(0.5).add(0.5);
    material.roughnessNode = float(0.3).add(brush.mul(0.14));
  });
}
