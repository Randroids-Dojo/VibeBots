import { Box3 } from "three/webgpu";
import { BASE_PART_IDS, type BasePartId } from "@/sim/bunker";
import {
  type BunkerPartGeometry,
  bunkerPartGeometry,
} from "./mine-bunker-part-geometry";
import {
  type BuildContext,
  blankParts,
  box,
  chamferedBox,
  cylinder,
  mergeLayers,
  type SurfaceGeometryTier,
  triangleCount,
} from "./mine-surface-geometry";

/**
 * Full-cell (1x1x1) bunker part geometry for the first-person viewer.
 * The 2D overlay draws thin slabs on the tunnel plane; walked past at
 * eye level those read as cardboard, so the sealing parts (wall,
 * floor, roof, door) get room-filling variants in the same industrial
 * riveted language: a gunmetal shell, dark seam strips that meet the
 * neighbor's as one groove, and proud corner rivets. Floor spikes and
 * the turret keep the existing bunkerPartGeometry models unchanged
 * (their silhouettes already stand in the room).
 *
 * Same BunkerPartGeometry return shape as the 2D module so the shared
 * bunkerPartMaterial singletons apply per layer role: no new
 * materials, no new shader programs. Extents stay within +-0.5 (+1e-3)
 * so adjacent cells tile seamlessly and never z-fight a neighbor.
 *
 * The door's hatch leaf (slab, spin wheel, spokes) is merged into ONE
 * dedicated layer: the door's only "accent" layer, so a later slice
 * can swing it open by animating that mesh alone.
 */

const RIVET_SPOTS: readonly (readonly [number, number])[] = [
  [-0.36, -0.36],
  [-0.36, 0.36],
  [0.36, -0.36],
  [0.36, 0.36],
];

/** Proud rivet heads on a +-z face pair (and +-x on the high tier). */
function faceRivets(ctx: BuildContext): void {
  for (const face of [-1, 1] as const) {
    for (const [a, b] of RIVET_SPOTS) {
      cylinder(
        ctx,
        "frame",
        0.045,
        0.05,
        0.04,
        [a, b, face * 0.478],
        [Math.PI / 2, 0, 0],
        6,
      );
    }
  }
  if (ctx.tier !== "high") return;
  for (const face of [-1, 1] as const) {
    for (const [a, b] of RIVET_SPOTS) {
      cylinder(
        ctx,
        "frame",
        0.045,
        0.05,
        0.04,
        [face * 0.478, a, b],
        [0, 0, Math.PI / 2],
        6,
      );
    }
  }
}

/**
 * The full-cell vocabulary every sealing part starts from: a 0.98
 * shell cube plus twelve dark seam strips along the cube edges whose
 * outer faces reach exactly +-0.5, so two adjacent cells share one
 * continuous seam groove.
 */
function fullCellShell(ctx: BuildContext): void {
  box(ctx, "shell", [0.98, 0.98, 0.98], [0, 0, 0]);
  const c = 0.4725;
  for (const a of [-c, c]) {
    for (const b of [-c, c]) {
      box(ctx, "composite", [1, 0.055, 0.055], [0, a, b]);
      box(ctx, "composite", [0.055, 1, 0.055], [a, 0, b]);
      box(ctx, "composite", [0.055, 0.055, 1], [a, b, 0]);
    }
  }
  faceRivets(ctx);
}

function buildFpWall(ctx: BuildContext): void {
  fullCellShell(ctx);
  // Plate midline bands on the four side faces, hazard chevron on the
  // corridor-facing pair: the 2D wall's patched-steel identity.
  for (const face of [-1, 1] as const) {
    box(ctx, "composite", [0.8, 0.03, 0.016], [0, 0.09, face * 0.4885]);
    box(ctx, "composite", [0.016, 0.03, 0.8], [face * 0.4885, 0.09, 0]);
    box(
      ctx,
      "accent",
      [0.16, 0.16, 0.02],
      [0, -0.2, face * 0.4885],
      [0, 0, Math.PI / 4],
    );
  }
  if (ctx.tier === "high") {
    for (const face of [-1, 1] as const) {
      box(ctx, "composite", [0.03, 0.34, 0.016], [-0.22, 0.26, face * 0.4885]);
      box(ctx, "composite", [0.03, 0.34, 0.016], [0.22, 0.26, face * 0.4885]);
    }
  }
}

const FP_GRATE_XS_LOW = [-0.3, -0.1, 0.1, 0.3] as const;
const FP_GRATE_XS_HIGH = [-0.35, -0.21, -0.07, 0.07, 0.21, 0.35] as const;

function buildFpFloor(ctx: BuildContext): void {
  fullCellShell(ctx);
  // Walkway grate on the TOP face: rails, slats, and warm edge strips
  // (the surface the player actually stands on and looks down at).
  box(ctx, "frame", [0.94, 0.024, 0.07], [0, 0.487, 0.3]);
  box(ctx, "frame", [0.94, 0.024, 0.07], [0, 0.487, -0.3]);
  const slats = ctx.tier === "high" ? FP_GRATE_XS_HIGH : FP_GRATE_XS_LOW;
  for (const x of slats) {
    box(ctx, "frame", [0.06, 0.024, 0.82], [x, 0.487, 0]);
  }
  box(ctx, "accent", [0.94, 0.02, 0.05], [0, 0.4885, 0.155]);
  box(ctx, "accent", [0.94, 0.02, 0.05], [0, 0.4885, -0.155]);
}

const FP_FIN_XS_LOW = [-0.14, 0, 0.14] as const;
const FP_FIN_XS_HIGH = [-0.2, -0.1, 0, 0.1, 0.2] as const;

function buildFpRoof(ctx: BuildContext): void {
  fullCellShell(ctx);
  // Work lamp on the BOTTOM face: the emissive panel hangs proud of
  // its housing so the warm room glow reads from below.
  box(ctx, "frame", [0.36, 0.04, 0.22], [0, -0.47, 0]);
  box(ctx, "emissive", [0.28, 0.05, 0.15], [0, -0.472, 0]);
  // Vent ridge on the top face.
  box(ctx, "composite", [0.6, 0.024, 0.24], [0, 0.487, 0]);
  const fins = ctx.tier === "high" ? FP_FIN_XS_HIGH : FP_FIN_XS_LOW;
  for (const x of fins) {
    box(ctx, "frame", [0.05, 0.022, 0.26], [x, 0.4885, 0]);
  }
}

function buildFpDoor(ctx: BuildContext): void {
  // Doorframe instead of a solid shell: sill, lintel, and jambs leave
  // a hatch opening the leaf fills.
  box(ctx, "shell", [0.98, 0.18, 0.98], [0, -0.405, 0]);
  box(ctx, "shell", [0.98, 0.24, 0.98], [0, 0.37, 0]);
  box(ctx, "shell", [0.16, 0.98, 0.98], [-0.41, 0, 0]);
  box(ctx, "shell", [0.16, 0.98, 0.98], [0.41, 0, 0]);
  const c = 0.4725;
  for (const a of [-c, c]) {
    for (const b of [-c, c]) {
      box(ctx, "composite", [1, 0.055, 0.055], [0, a, b]);
      box(ctx, "composite", [0.055, 1, 0.055], [a, 0, b]);
      box(ctx, "composite", [0.055, 0.055, 1], [a, b, 0]);
    }
  }
  faceRivets(ctx);
  // Hinge knuckles on the left jamb, beside the leaf edges.
  box(ctx, "frame", [0.06, 0.14, 0.08], [-0.37, 0.1, 0.13]);
  box(ctx, "frame", [0.06, 0.14, 0.08], [-0.37, 0.1, -0.13]);
  box(ctx, "frame", [0.06, 0.14, 0.08], [-0.37, -0.18, 0.13]);
  box(ctx, "frame", [0.06, 0.14, 0.08], [-0.37, -0.18, -0.13]);
  // Ready light on the lintel, both corridor faces.
  box(ctx, "emissive", [0.14, 0.045, 0.018], [0.28, 0.31, 0.489]);
  box(ctx, "emissive", [0.14, 0.045, 0.018], [0.28, 0.31, -0.489]);
  // THE LEAF: the door's single dedicated "accent" layer (slab, spin
  // wheel, spokes together), future-swingable as one mesh.
  chamferedBox(ctx, "accent", [0.7, 0.6, 0.22], [0, -0.03, 0], 0.05);
  const wheelSegments = ctx.tier === "high" ? 12 : 8;
  for (const face of [-1, 1] as const) {
    cylinder(
      ctx,
      "accent",
      0.09,
      0.09,
      0.05,
      [0, -0.03, face * 0.135],
      [Math.PI / 2, 0, 0],
      wheelSegments,
    );
    box(ctx, "accent", [0.2, 0.026, 0.02], [0, -0.03, face * 0.165]);
    box(ctx, "accent", [0.026, 0.2, 0.02], [0, -0.03, face * 0.165]);
  }
}

const FP_BUILDERS: Partial<Record<BasePartId, (ctx: BuildContext) => void>> = {
  "wall-panel": buildFpWall,
  "floor-panel": buildFpFloor,
  "roof-panel": buildFpRoof,
  "door-panel": buildFpDoor,
};

const FP_ZERO_ANCHOR = [0, 0, 0] as const;

const cache = new Map<string, BunkerPartGeometry>();

export function bunkerPartFpGeometry(
  id: BasePartId,
  tier: SurfaceGeometryTier,
): BunkerPartGeometry {
  const builder = FP_BUILDERS[id];
  // Spikes and the turret reuse the 2D cache's exact objects: same
  // geometry, same durability-wilt motion assembly.
  if (!builder) return bunkerPartGeometry(id, tier);
  const key = `${id}:${tier}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const ctx: BuildContext = {
    tier,
    parts: blankParts(),
    motionParts: blankParts(),
  };
  builder(ctx);
  const layers = mergeLayers(ctx.parts);
  const bounds = new Box3();
  for (const layer of layers) {
    if (layer.geometry.boundingBox) bounds.union(layer.geometry.boundingBox);
  }
  const model: BunkerPartGeometry = {
    id,
    tier,
    layers,
    motionLayers: [],
    motionAnchor: FP_ZERO_ANCHOR,
    bounds,
    triangleCount: layers.reduce(
      (sum, layer) => sum + triangleCount(layer.geometry),
      0,
    ),
  };
  cache.set(key, model);
  return model;
}

export function clearBunkerFpPartGeometryCacheForTests(): void {
  for (const model of cache.values()) {
    for (const layer of model.layers) layer.geometry.dispose();
  }
  cache.clear();
}

export { BASE_PART_IDS };
