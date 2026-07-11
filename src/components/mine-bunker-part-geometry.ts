import { Box3, Vector3 } from "three/webgpu";
import { BASE_PART_IDS, type BasePartId } from "@/sim/bunker";
import {
  type BuildContext,
  blankParts,
  boltRow,
  box,
  chamferedBox,
  cylinder,
  mergeLayer,
  type SurfaceGeometryLayer,
  type SurfaceGeometryTier,
  type SurfaceMaterialRole,
} from "./mine-surface-geometry";

/**
 * Bunker base-part geometry in the industrial settlement language
 * (REQ-035). Parts are built in local cell space (the overlay parents
 * each part at its cell center), and the pieces that seal a room fill
 * their cell exactly to +-0.5 on the edges they share with neighbors,
 * so adjacent cells tile seamlessly: two walls meet as one continuous
 * bulkhead, floor plates form one deck, roof caps one ceiling. Border
 * frame rails sit half on each cell so the joint reads as a designed
 * seam line, not a gap.
 *
 * Geometry is cached per (part, tier) and drawn with the shared
 * surfaceMaterial singletons, so placing parts creates no geometry, no
 * materials, and no new shader programs (the stratum-crossing lesson).
 */

/** Half-extent of a bunker cell; sealing edges must reach exactly this. */
export const BUNKER_CELL_HALF = 0.5;

/** Local z depth budget so parts keep the overlay's existing plane. */
export const BUNKER_PART_MAX_DEPTH = 0.26;

export interface BunkerPartGeometry {
  id: BasePartId;
  tier: SurfaceGeometryTier;
  /** Static layers, one merged geometry per material role. */
  layers: readonly SurfaceGeometryLayer[];
  /**
   * Durability-scaled sub-assembly (spike tips, turret head), built in
   * anchor space with its base at y 0 so a y-scale wilts it downward.
   */
  motionLayers: readonly SurfaceGeometryLayer[];
  /** Where the motion sub-assembly attaches in local cell space. */
  motionAnchor: readonly [number, number, number];
  bounds: Box3;
  triangleCount: number;
}

/**
 * Shared vocabulary of the riveted-steel look (the Fallout-Shelter-like
 * cutaway reference): a light gunmetal body slab, a dark inset seam
 * border whose half-width edges combine with the neighbor's into one
 * seam line, and proud corner rivets. Every sealing part starts from
 * this so an assembled room reads as one continuous riveted lattice.
 */
function steelBlock(ctx: BuildContext, depth = 0.2): void {
  const face = depth / 2;
  box(ctx, "shell", [1, 1, depth], [0, 0, 0]);
  // Dark seam border, half on each neighbor.
  box(ctx, "composite", [1, 0.05, 0.015], [0, 0.475, face]);
  box(ctx, "composite", [1, 0.05, 0.015], [0, -0.475, face]);
  box(ctx, "composite", [0.05, 1, 0.015], [0.475, 0, face]);
  box(ctx, "composite", [0.05, 1, 0.015], [-0.475, 0, face]);
  rivets(ctx, face + 0.012);
}

/** Proud corner rivets on both tiers: they carry the whole style. */
function rivets(ctx: BuildContext, z: number): void {
  for (const x of [-0.38, 0.38]) {
    for (const y of [-0.38, 0.38]) {
      cylinder(
        ctx,
        "frame",
        0.042,
        0.05,
        0.03,
        [x, y, z],
        [Math.PI / 2, 0, 0],
        8,
      );
    }
  }
  if (ctx.tier !== "high") return;
  // Edge-midpoint rivets complete the reference's studded border rows.
  for (const [x, y] of [
    [0, -0.38],
    [0, 0.38],
    [-0.38, 0],
    [0.38, 0],
  ] as const) {
    cylinder(
      ctx,
      "frame",
      0.042,
      0.05,
      0.03,
      [x, y, z],
      [Math.PI / 2, 0, 0],
      8,
    );
  }
}

function buildWall(ctx: BuildContext): void {
  steelBlock(ctx);
  // Plate midline and a small hazard chevron, like the reference's
  // patched steel bands.
  box(ctx, "composite", [0.8, 0.028, 0.012], [0, 0, 0.1]);
  box(
    ctx,
    "accent",
    [0.16, 0.16, 0.024],
    [0, -0.21, 0.105],
    [0, 0, Math.PI / 4],
  );
  if (ctx.tier === "high") {
    box(ctx, "composite", [0.028, 0.34, 0.012], [-0.24, 0.235, 0.1]);
    box(ctx, "composite", [0.028, 0.34, 0.012], [0.24, 0.235, 0.1]);
  }
}

function buildFloor(ctx: BuildContext): void {
  steelBlock(ctx);
  // Recessed walkway grate across the top half of the face.
  box(ctx, "composite", [0.78, 0.4, 0.03], [0, 0.15, 0.095]);
  box(ctx, "frame", [0.82, 0.05, 0.05], [0, 0.38, 0.1]);
  const bars =
    ctx.tier === "high" ? [-0.3, -0.15, 0, 0.15, 0.3] : [-0.26, 0, 0.26];
  for (const x of bars) {
    box(ctx, "frame", [0.05, 0.4, 0.04], [x, 0.15, 0.1]);
  }
  box(ctx, "accent", [0.78, 0.045, 0.02], [0, -0.12, 0.105]);
}

function buildRoof(ctx: BuildContext): void {
  steelBlock(ctx);
  // Under-mounted work lamp: the warm room glow from the reference.
  box(ctx, "frame", [0.3, 0.07, 0.1], [0, -0.42, 0.1]);
  box(ctx, "emissive", [0.22, 0.045, 0.08], [0, -0.47, 0.1]);
  // Vent ridge along the top face half.
  box(ctx, "composite", [0.56, 0.16, 0.03], [0, 0.24, 0.095]);
  const fins =
    ctx.tier === "high" ? [-0.2, -0.1, 0, 0.1, 0.2] : [-0.14, 0, 0.14];
  for (const x of fins) {
    box(ctx, "frame", [0.045, 0.16, 0.045], [x, 0.24, 0.105]);
  }
}

function buildDoor(ctx: BuildContext): void {
  steelBlock(ctx);
  // Inset hatch leaf: dark steel with rounded corners, a porthole, an
  // orange spin-wheel, and a warm ready light.
  chamferedBox(ctx, "composite", [0.62, 0.74, 0.1], [0, 0, 0.08], 0.06);
  chamferedBox(ctx, "frame", [0.2, 0.2, 0.03], [0, 0.19, 0.135], 0.05);
  cylinder(
    ctx,
    "accent",
    0.1,
    0.1,
    0.035,
    [0, -0.12, 0.14],
    [Math.PI / 2, 0, 0],
    ctx.tier === "high" ? 12 : 8,
  );
  box(ctx, "accent", [0.16, 0.03, 0.02], [0, -0.12, 0.155]);
  box(ctx, "accent", [0.03, 0.16, 0.02], [0, -0.12, 0.155]);
  box(ctx, "emissive", [0.05, 0.05, 0.02], [0.22, -0.3, 0.14]);
  // Hinge knuckles on the left jamb.
  box(ctx, "frame", [0.06, 0.12, 0.06], [-0.34, 0.2, 0.11]);
  box(ctx, "frame", [0.06, 0.12, 0.06], [-0.34, -0.2, 0.11]);
}

const SPIKE_XS_LOW = [-0.33, -0.11, 0.11, 0.33] as const;
const SPIKE_XS_HIGH = [-0.4, -0.2, 0, 0.2, 0.4] as const;

function buildSpikes(ctx: BuildContext): void {
  // Low riveted anchor plate; the spikes are the durability-scaled
  // motion assembly.
  box(ctx, "shell", [1, 0.12, 0.3], [0, -0.44, 0]);
  box(ctx, "composite", [1, 0.03, 0.012], [0, -0.39, 0.15]);
  cylinder(
    ctx,
    "frame",
    0.042,
    0.05,
    0.03,
    [-0.4, -0.44, 0.162],
    [Math.PI / 2, 0, 0],
    8,
  );
  cylinder(
    ctx,
    "frame",
    0.042,
    0.05,
    0.03,
    [0.4, -0.44, 0.162],
    [Math.PI / 2, 0, 0],
    8,
  );
  box(ctx, "accent", [0.34, 0.05, 0.02], [-0.24, -0.35, 0.15]);
  box(ctx, "accent", [0.34, 0.05, 0.02], [0.24, -0.35, 0.15]);
  const motion: BuildContext = { ...ctx, parts: ctx.motionParts };
  const xs = ctx.tier === "high" ? SPIKE_XS_HIGH : SPIKE_XS_LOW;
  for (const x of xs) {
    cylinder(motion, "frame", 0, 0.07, 0.42, [x, 0.21, 0], [0, 0, 0], 6);
  }
}

function buildTurret(ctx: BuildContext): void {
  // Riveted pedestal stays put; the sensor head and barrel wilt with
  // damage.
  box(ctx, "shell", [0.8, 0.16, 0.3], [0, -0.42, 0]);
  box(ctx, "composite", [0.8, 0.03, 0.012], [0, -0.37, 0.15]);
  box(ctx, "composite", [0.5, 0.1, 0.24], [0, -0.31, 0]);
  const motion: BuildContext = { ...ctx, parts: ctx.motionParts };
  cylinder(motion, "frame", 0.15, 0.2, 0.22, [0, 0.11, 0], [0, 0, 0], 10);
  chamferedBox(motion, "accent", [0.3, 0.2, 0.24], [0, 0.32, 0], 0.04);
  // The barrel sweeps the approach lane, not the camera.
  cylinder(
    motion,
    "frame",
    0.04,
    0.05,
    0.44,
    [0.26, 0.34, 0],
    [0, 0, Math.PI / 2],
    8,
  );
  box(motion, "emissive", [0.08, 0.06, 0.02], [0, 0.34, 0.13]);
}

const BUILDERS: Record<BasePartId, (ctx: BuildContext) => void> = {
  "wall-panel": buildWall,
  "floor-panel": buildFloor,
  "roof-panel": buildRoof,
  "door-panel": buildDoor,
  "floor-spikes": buildSpikes,
  "basic-turret": buildTurret,
};

const MOTION_ANCHORS: Record<BasePartId, readonly [number, number, number]> = {
  "wall-panel": [0, 0, 0],
  "floor-panel": [0, 0, 0],
  "roof-panel": [0, 0, 0],
  "door-panel": [0, 0, 0],
  "floor-spikes": [0, -0.38, 0.12],
  "basic-turret": [0, -0.26, 0.02],
};

function triangleCount(layer: SurfaceGeometryLayer): number {
  const geometry = layer.geometry;
  return geometry.index
    ? geometry.index.count / 3
    : (geometry.getAttribute("position")?.count ?? 0) / 3;
}

const cache = new Map<string, BunkerPartGeometry>();

export function bunkerPartGeometry(
  id: BasePartId,
  tier: SurfaceGeometryTier,
): BunkerPartGeometry {
  const key = `${id}:${tier}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const ctx: BuildContext = {
    tier,
    parts: blankParts(),
    motionParts: blankParts(),
  };
  BUILDERS[id](ctx);
  const layers = (Object.keys(ctx.parts) as SurfaceMaterialRole[])
    .map((role) => mergeLayer(role, ctx.parts[role]))
    .filter((layer): layer is SurfaceGeometryLayer => layer !== null);
  const motionLayers = (Object.keys(ctx.motionParts) as SurfaceMaterialRole[])
    .map((role) => mergeLayer(role, ctx.motionParts[role]))
    .filter((layer): layer is SurfaceGeometryLayer => layer !== null);
  // Bounds are the RENDERED extent: motion layers are authored in
  // anchor space, so translate their boxes by the anchor before
  // unioning with the cell-space static layers.
  const anchor = MOTION_ANCHORS[id];
  const bounds = new Box3();
  const scratch = new Box3();
  for (const layer of layers) {
    if (layer.geometry.boundingBox) bounds.union(layer.geometry.boundingBox);
  }
  for (const layer of motionLayers) {
    if (!layer.geometry.boundingBox) continue;
    scratch.copy(layer.geometry.boundingBox);
    scratch.translate(new Vector3(anchor[0], anchor[1], anchor[2]));
    bounds.union(scratch);
  }
  const model: BunkerPartGeometry = {
    id,
    tier,
    layers,
    motionLayers,
    motionAnchor: MOTION_ANCHORS[id],
    bounds,
    triangleCount: [...layers, ...motionLayers].reduce(
      (sum, layer) => sum + triangleCount(layer),
      0,
    ),
  };
  cache.set(key, model);
  return model;
}

export function clearBunkerPartGeometryCacheForTests(): void {
  for (const model of cache.values()) {
    for (const layer of [...model.layers, ...model.motionLayers]) {
      layer.geometry.dispose();
    }
  }
  cache.clear();
}

export { BASE_PART_IDS };
