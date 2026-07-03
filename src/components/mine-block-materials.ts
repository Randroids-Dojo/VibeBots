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
  time,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { Color, MeshStandardNodeMaterial } from "three/webgpu";
import {
  hasCoarsePointer,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";

export type BlockMaterialKind = "dirt" | "rock" | "metal" | "boulder" | "gas";

/** Detail nodes compile in only when the caller passes detail: the high
 * quality tier AND the live WebGPU backend (the WebGL2 fallback serves
 * exactly the machines that cannot afford per-fragment noise, and CI's
 * software-GL runners proved it by missing motion windows). */
export function blockDetailEnabled(webgpuBackend: boolean): boolean {
  if (typeof window === "undefined" || !webgpuBackend) return false;
  return (
    resolveGraphicsQualityTier(
      readStoredGraphicsQuality(),
      hasCoarsePointer(),
    ) === "high"
  );
}

/** Stable in-shader hash of the cell's integer world coordinate, the
 * TSL twin of cellHash(): same cell, same value, no shimmer. */
export function cellHashNode() {
  const cell = floor(add(positionWorld.xy, vec2(0.5, 0.5)));
  return fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));
}

/** Base tints enter the shader as uniforms, not constants: a constant
 * hex bakes into the program source, so every distinct tint would
 * compile its own program. Uniforms keep one program per material
 * shape, which is what makes first paint survive software GL (CI) and
 * cheap GPUs. */
export function tintUniform(baseHex: string) {
  return uniform(new Color(baseHex));
}

/** The old variedColor() lightness jitter, in-shader. */
export function jitteredColor(baseHex: string) {
  const jitter = cellHashNode().sub(0.5).mul(0.16).add(1.0);
  return tintUniform(baseHex).mul(jitter);
}

export function grainNoise(scale: number) {
  return mx_noise_float(positionWorld.xyz.mul(scale));
}

const cache = new Map<string, MeshStandardNodeMaterial>();

export function cached(
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
export function dirtBlockMaterial(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return cached(`dirt:${baseHex}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.metalness = 0;
    // Matte soil barely answers the environment; the low response keeps
    // tunnels grounded while ores and metal pop against them (G2).
    material.envMapIntensity = 0.25;
    if (!detail) {
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
export function rockBlockMaterial(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return cached(`rock:${baseHex}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.metalness = 0.15;
    material.envMapIntensity = 0.55;
    if (!detail) {
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
export function metalBlockMaterial(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return cached(`metal:${baseHex}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.envMapIntensity = 1.2;
    if (!detail) {
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
  detail: boolean,
): MeshStandardNodeMaterial {
  return cached(`boulder:${baseHex}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.metalness = 0.05;
    material.envMapIntensity = 0.3;
    if (!detail) {
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

/** Ore crystals: glassy facets with bright fresnel rims; the glowing
 * tiers breathe. Detail keeps the pulse and rim; the flat tier keeps
 * the old constant emissive so phones pay nothing new. */
export function crystalMaterial(
  baseHex: string,
  glow: boolean,
  detail: boolean,
): MeshStandardNodeMaterial {
  return cached(`crystal:${baseHex}:${glow}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    // Hero surface (G2): smooth-shaded so the facets catch the
    // environment as curved glass instead of flat paint chips.
    material.flatShading = false;
    material.metalness = 0.1;
    material.roughness = 0.15;
    material.envMapIntensity = 1.45;
    material.colorNode = tintUniform(baseHex);
    if (!detail) {
      material.emissiveNode = tintUniform(baseHex).mul(glow ? 1.1 : 0.4);
      return material;
    }
    const rim = oneMinus(abs(dot(normalView, positionViewDirection)));
    const facetRim = rim.mul(rim).mul(1.6);
    const breath = glow
      ? sin(time.mul(1.7).add(cellHashNode().mul(6.28)))
          .mul(0.25)
          .add(1.0)
      : float(1.0);
    material.emissiveNode = tintUniform(baseHex)
      .mul(float(glow ? 0.85 : 0.3).add(facetRim))
      .mul(breath);
    return material;
  });
}

/** Gas pockets: sickly membrane with a slow interior churn. */
export function gasBlockMaterial(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return cached(`gas:${baseHex}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.flatShading = true;
    material.metalness = 0;
    material.roughness = 0.55;
    if (!detail) {
      material.colorNode = jitteredColor(baseHex);
      material.emissiveNode = tintUniform(baseHex).mul(0.25);
      return material;
    }
    const churn = grainNoise(5);
    material.colorNode = jitteredColor(baseHex).mul(
      float(0.85).add(churn.mul(0.3)),
    );
    material.emissiveNode = tintUniform(baseHex).mul(churn.mul(0.35).add(0.15));
    return material;
  });
}
