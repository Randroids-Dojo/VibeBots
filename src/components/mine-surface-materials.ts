/**
 * Cached PBR material families for the industrial surface village.
 * High detail adds restrained TSL variation. Low detail keeps a flat,
 * simple metallic roughness recipe for the WebGL2 fallback. Every value
 * is a shared singleton, so meshes that attach one must use dispose=null.
 */

import { float, positionWorld, sin, vertexColor } from "three/tsl";
import { Color, MeshStandardNodeMaterial } from "three/webgpu";
import { cached, grainNoise, tintUniform } from "./mine-block-materials";
import {
  SURFACE_PALETTE,
  type SurfaceMaterialRole,
} from "./mine-surface-geometry";

function build(
  key: string,
  baseHex: string,
  detail: boolean,
  configure: (material: MeshStandardNodeMaterial, detailOn: boolean) => void,
): MeshStandardNodeMaterial {
  return cached(`surface:${key}:${baseHex}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.colorNode = tintUniform(baseHex);
    material.flatShading = false;
    configure(material, detail);
    return material;
  });
}

export function surfaceCoatedMetal(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return build("coated", baseHex, detail, (material, detailOn) => {
    material.metalness = 0.68;
    material.roughness = 0.46;
    material.envMapIntensity = 0.85;
    if (!detailOn) return;
    const grain = grainNoise(28);
    material.colorNode = tintUniform(baseHex).mul(
      float(0.96).add(grain.mul(0.06)),
    );
    material.roughnessNode = float(0.42).add(grain.mul(0.08));
  });
}

export function surfaceBareMetal(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return build("bare", baseHex, detail, (material, detailOn) => {
    material.metalness = 0.92;
    material.roughness = 0.28;
    material.envMapIntensity = 1.12;
    if (!detailOn) return;
    const brush = sin(positionWorld.y.mul(68)).mul(0.5).add(0.5);
    material.roughnessNode = float(0.24).add(brush.mul(0.12));
  });
}

export function surfaceComposite(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return build("composite", baseHex, detail, (material, detailOn) => {
    material.metalness = 0.05;
    material.roughness = 0.78;
    material.envMapIntensity = 0.46;
    if (!detailOn) return;
    const speckle = grainNoise(42);
    material.colorNode = tintUniform(baseHex).mul(
      float(0.94).add(speckle.mul(0.1)),
    );
    material.roughnessNode = float(0.72).add(speckle.mul(0.14));
  });
}

export function surfaceEmissive(
  baseHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  return build("emissive", baseHex, detail, (material) => {
    material.metalness = 0.18;
    material.roughness = 0.32;
    material.emissive = new Color(baseHex);
    material.emissiveIntensity = 1.55;
    material.envMapIntensity = 0.7;
  });
}

export function surfaceMaterial(
  role: SurfaceMaterialRole,
  accentHex: string,
  emissiveHex: string,
  detail: boolean,
): MeshStandardNodeMaterial {
  switch (role) {
    case "shell":
      return surfaceCoatedMetal(SURFACE_PALETTE.armoredShell, detail);
    case "frame":
      return surfaceBareMetal(SURFACE_PALETTE.brushedTitanium, detail);
    case "composite":
      return surfaceComposite(SURFACE_PALETTE.voidGraphite, detail);
    case "accent":
      return surfaceCoatedMetal(accentHex, detail);
    case "emissive":
      return surfaceEmissive(emissiveHex, detail);
  }
}

export function surfaceVillageMaterial(
  role: SurfaceMaterialRole,
  detail: boolean,
): MeshStandardNodeMaterial {
  if (role !== "accent" && role !== "emissive") {
    return surfaceMaterial(
      role,
      SURFACE_PALETTE.safetyOrange,
      SURFACE_PALETTE.warmWorkLight,
      detail,
    );
  }
  return cached(`surface:village:${role}:${detail}`, () => {
    const material = new MeshStandardNodeMaterial();
    material.colorNode = vertexColor();
    material.flatShading = false;
    if (role === "accent") {
      material.metalness = 0.68;
      material.roughness = 0.42;
      material.envMapIntensity = 0.85;
    } else {
      material.metalness = 0.18;
      material.roughness = 0.32;
      material.envMapIntensity = 0.7;
      material.emissiveNode = vertexColor().mul(1.55);
    }
    return material;
  });
}
