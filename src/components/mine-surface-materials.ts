/**
 * Cached PBR material families for the industrial surface village.
 * High detail adds restrained TSL variation. Low detail keeps a flat,
 * simple metallic roughness recipe for the WebGL2 fallback. Every value
 * is a shared singleton, so meshes that attach one must use dispose=null.
 */

import { float, positionWorld, sin, vertexColor } from "three/tsl";
import { Color, MeshStandardNodeMaterial } from "three/webgpu";
import {
  type BasePartId,
  type BunkerSkinId,
  DEFAULT_BUNKER_SKIN,
} from "@/sim/bunker";
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

/**
 * Bunker base-part role mapping, third sibling of surfaceMaterial and
 * surfaceVillageMaterial. Underground light is the miner's lamp plus
 * dim ambient, so the steel body reads through the DIFFUSE composite
 * recipe with a light gunmetal tint rather than the surface metals
 * (metalness 0.68-0.92 goes near black without sky light). Two extra
 * cached instances on shaders the village already compiled.
 */
const BUNKER_STEEL_HEX = "#78848F";

/** Per-skin palettes for the bunker part roles (F-087). Cosmetic only:
 * same cached-material factory, different hex per role, so each skin
 * costs a handful of extra cached materials warmed at load. */
export const BUNKER_SKIN_PALETTES: Record<
  BunkerSkinId,
  { shell: string; frame: string; accent: string }
> = {
  steelworks: {
    shell: BUNKER_STEEL_HEX,
    frame: SURFACE_PALETTE.brushedTitanium,
    accent: SURFACE_PALETTE.safetyOrange,
  },
  gilded: {
    shell: "#9C8452",
    frame: "#C4A45E",
    accent: "#7A2E2E",
  },
  verdant: {
    shell: "#5F7A66",
    frame: "#8FA98F",
    accent: "#B08D3F",
  },
};

export const BASE_PART_EMISSIVES: Record<BasePartId, string> = {
  "wall-panel": SURFACE_PALETTE.energyCyan,
  "floor-panel": SURFACE_PALETTE.energyCyan,
  "roof-panel": SURFACE_PALETTE.warmWorkLight,
  "door-panel": SURFACE_PALETTE.energyCyan,
  "floor-spikes": SURFACE_PALETTE.energyCyan,
  "basic-turret": SURFACE_PALETTE.energyCyan,
  "stair-panel": SURFACE_PALETTE.warmWorkLight,
};

export function bunkerPartMaterial(
  role: SurfaceMaterialRole,
  emissiveHex: string,
  detail: boolean,
  skin: BunkerSkinId = DEFAULT_BUNKER_SKIN,
): MeshStandardNodeMaterial {
  const palette = BUNKER_SKIN_PALETTES[skin];
  switch (role) {
    case "shell":
      return surfaceComposite(palette.shell, detail);
    case "frame":
      return surfaceCoatedMetal(palette.frame, detail);
    case "composite":
      return surfaceComposite(SURFACE_PALETTE.voidGraphite, detail);
    case "accent":
      return surfaceCoatedMetal(palette.accent, detail);
    case "emissive":
      return surfaceEmissive(emissiveHex, detail);
  }
}

/** Every material a bunker part can draw with, for the load warm-up. */
export function collectBunkerPartMaterials(
  detail: boolean,
): MeshStandardNodeMaterial[] {
  const emissives = new Set(Object.values(BASE_PART_EMISSIVES));
  const skins = Object.keys(BUNKER_SKIN_PALETTES) as BunkerSkinId[];
  return [
    ...skins.flatMap((skin) => [
      bunkerPartMaterial("shell", "", detail, skin),
      bunkerPartMaterial("frame", "", detail, skin),
      bunkerPartMaterial("accent", "", detail, skin),
    ]),
    bunkerPartMaterial("composite", "", detail),
    ...[...emissives].map((hex) => surfaceEmissive(hex, detail)),
  ];
}
