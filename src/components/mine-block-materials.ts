/**
 * Shared TSL materials for mine cell blocks (world-art slice W1, closing
 * F-046's material half). Today every rendered cell creates its own
 * material instance; here each (kind, tint) pair is one shared node
 * material, and the per-cell look lives in the shader:
 *
 * - Per-cell tint jitter replicates the old variedColor() using a hash
 *   of the cell's integer world coordinates (positionWorld), so blocks
 *   stay stable per cell without per-mesh materials.
 * - Surface detail (soil grain, rock crag, brushed metal) rides noise
 *   nodes on the high tier and compiles away to flat color on the low
 *   tier, keeping phones at their current fragment cost.
 *
 * Shared singletons: meshes must attach with `dispose={null}`.
 */

import {
  abs,
  add,
  color,
  dot,
  float,
  floor,
  fract,
  mx_noise_float,
  normalView,
  oneMinus,
  positionViewDirection,
  positionWorld,
  sin,
  vec2,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  hasCoarsePointer,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";

export type BlockMaterialKind = "dirt" | "rock" | "metal" | "boulder" | "gas";

/** Detail nodes are compiled in only on the high tier; phones keep the
 * flat-shaded cost they have today. Resolved once at module init: the
 * material set is created on first use and shared for the session. */
function detailEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    resolveGraphicsQualityTier(
      readStoredGraphicsQuality(),
      hasCoarsePointer(),
    ) === "high"
  );
}

/** Stable in-shader hash of the cell's integer world coordinate, the
 * TSL twin of cellHash(): same cell, same value, no shimmer. */
function cellHashNode() {
  const cell = floor(add(positionWorld.xy, vec2(0.5, 0.5)));
  return fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));
}

/** The old variedColor() lightness jitter, in-shader. */
function jitteredColor(baseHex: string) {
  const jitter = cellHashNode().sub(0.5).mul(0.16).add(1.0);
  return color(baseHex).mul(jitter);
}

function grainNoise(scale: number) {
  return mx_noise_float(positionWorld.xyz.mul(scale));
}

const cache = new Map<string, MeshStandardNodeMaterial>();

function cached(
  key: string,
  build: () => MeshStandardNodeMaterial,
): MeshStandardNodeMaterial {
  const hit = cache.get(key);
  if (hit) return hit;
  const material = build();
  cache.set(key, material);
  return material;
}

/** Soil: warm grain, pebbly speckle, matte. */
export function dirtBlockMaterial(baseHex: string): MeshStandardNodeMaterial {
  return cached(`dirt:${baseHex}:${detailEnabled()}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.metalness = 0;
    if (!detailEnabled()) {
      material.colorNode = jitteredColor(baseHex);
      material.roughness = 0.95;
      return material;
    }
    const grain = grainNoise(9);
    const speckle = grainNoise(34);
    // Grain mottles the tint; sparse bright speckles read as grit.
    const mottled = jitteredColor(baseHex)
      .mul(float(0.92).add(grain.mul(0.16)))
      .add(vec3(0.05, 0.04, 0.03).mul(speckle.step(0.62).mul(speckle)));
    material.colorNode = mottled;
    material.roughnessNode = float(0.9).add(grain.mul(0.1));
    return material;
  });
}

/** Rock: harder crag striations and a faint cool sheen at grazing angles. */
export function rockBlockMaterial(baseHex: string): MeshStandardNodeMaterial {
  return cached(`rock:${baseHex}:${detailEnabled()}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.metalness = 0.15;
    if (!detailEnabled()) {
      material.colorNode = jitteredColor(baseHex);
      material.roughness = 0.6;
      return material;
    }
    const crag = grainNoise(6);
    const strata = sin(positionWorld.y.mul(14).add(crag.mul(3)))
      .mul(0.5)
      .add(0.5);
    material.colorNode = jitteredColor(baseHex).mul(
      float(0.86).add(crag.mul(0.14)).add(strata.mul(0.08)),
    );
    material.roughnessNode = float(0.52).add(crag.mul(0.18));
    const rim = oneMinus(abs(dot(normalView, positionViewDirection)));
    material.emissiveNode = color("#9fb4d8").mul(rim.mul(rim).mul(0.1));
    return material;
  });
}

/** Bedrock metal: brushed bands, full metalness (IBL pays for it). */
export function metalBlockMaterial(baseHex: string): MeshStandardNodeMaterial {
  return cached(`metal:${baseHex}:${detailEnabled()}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    if (!detailEnabled()) {
      material.colorNode = jitteredColor(baseHex);
      material.metalness = 0.85;
      material.roughness = 0.28;
      return material;
    }
    const brush = sin(positionWorld.y.mul(64))
      .mul(0.5)
      .add(0.5)
      .mul(grainNoise(3).mul(0.5).add(0.5));
    material.colorNode = jitteredColor(baseHex).mul(
      float(0.94).add(brush.mul(0.1)),
    );
    material.metalness = 0.85;
    material.roughnessNode = float(0.22).add(brush.mul(0.14));
    material.emissiveNode = color("#101820").mul(0.14);
    return material;
  });
}

/** Boulders: dusty weathered stone, warm-edged. */
export function boulderBlockMaterial(
  baseHex: string,
): MeshStandardNodeMaterial {
  return cached(`boulder:${baseHex}:${detailEnabled()}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.metalness = 0.05;
    if (!detailEnabled()) {
      material.colorNode = jitteredColor(baseHex);
      material.roughness = 0.8;
      return material;
    }
    const wear = grainNoise(7);
    material.colorNode = jitteredColor(baseHex).mul(
      float(0.88).add(wear.mul(0.2)),
    );
    material.roughnessNode = float(0.72).add(wear.mul(0.2));
    return material;
  });
}

/** Gas pockets: sickly membrane with a slow interior churn. */
export function gasBlockMaterial(baseHex: string): MeshStandardNodeMaterial {
  return cached(`gas:${baseHex}:${detailEnabled()}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.metalness = 0;
    material.roughness = 0.55;
    if (!detailEnabled()) {
      material.colorNode = jitteredColor(baseHex);
      material.emissiveNode = color(baseHex).mul(0.25);
      return material;
    }
    const churn = grainNoise(5);
    material.colorNode = jitteredColor(baseHex).mul(
      float(0.85).add(churn.mul(0.3)),
    );
    material.emissiveNode = color(baseHex).mul(churn.mul(0.35).add(0.15));
    return material;
  });
}
