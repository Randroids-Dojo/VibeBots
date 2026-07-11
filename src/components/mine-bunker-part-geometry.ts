import { Box3 } from "three/webgpu";
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

function buildWall(ctx: BuildContext): void {
  // Full-bleed armored bulkhead: the slab spans the whole cell so
  // stacked and adjacent walls read as one continuous wall.
  box(ctx, "shell", [1, 1, 0.16], [0, 0, 0]);
  box(ctx, "composite", [0.72, 0.72, 0.05], [0, 0, 0.09]);
  // Half-width border rails: the neighbor's half completes the joint.
  box(ctx, "frame", [1, 0.07, 0.05], [0, 0.465, 0.09]);
  box(ctx, "frame", [1, 0.07, 0.05], [0, -0.465, 0.09]);
  box(ctx, "frame", [0.07, 1, 0.05], [0.465, 0, 0.09]);
  box(ctx, "frame", [0.07, 1, 0.05], [-0.465, 0, 0.09]);
  box(ctx, "accent", [0.2, 0.2, 0.03], [-0.16, 0, 0.115], [0, 0, Math.PI / 4]);
  box(ctx, "emissive", [0.035, 0.56, 0.02], [0.26, 0, 0.12]);
  boltRow(ctx, 0.6, 0.38, 0.125, 3);
  boltRow(ctx, 0.6, -0.38, 0.125, 3);
}

function buildFloor(ctx: BuildContext): void {
  // Deck plate: full cell width, seated on the cell floor, so a row of
  // floor cells forms one continuous walkable deck.
  box(ctx, "shell", [1, 0.3, 0.3], [0, -0.35, 0]);
  box(ctx, "frame", [1, 0.05, 0.05], [0, -0.215, 0.1]);
  box(ctx, "frame", [1, 0.05, 0.05], [0, -0.215, -0.1]);
  box(ctx, "accent", [1, 0.055, 0.02], [0, -0.26, 0.16]);
  if (ctx.tier === "high") {
    for (const x of [-0.3, 0, 0.3]) {
      box(ctx, "frame", [0.05, 0.045, 0.22], [x, -0.21, 0]);
    }
  }
}

function buildRoof(ctx: BuildContext): void {
  // Armored ceiling cap: full cell width against the cell top, so a
  // roof row reads as one continuous overhead deck.
  box(ctx, "shell", [1, 0.3, 0.3], [0, 0.35, 0]);
  box(ctx, "frame", [1, 0.06, 0.05], [0, 0.185, 0.12]);
  box(ctx, "accent", [0.3, 0.09, 0.2], [0, 0.42, 0.03]);
  box(ctx, "emissive", [0.84, 0.025, 0.02], [0, 0.225, 0.14]);
  if (ctx.tier === "high") {
    for (const x of [-0.28, 0.28]) {
      box(ctx, "frame", [0.08, 0.12, 0.26], [x, 0.3, 0]);
    }
  }
}

function buildDoor(ctx: BuildContext): void {
  // Pressure hatch: the frame ring fills the cell edges (it seals like
  // a wall), the leaf sits recessed with a lit threshold.
  box(ctx, "shell", [1, 0.18, 0.2], [0, 0.41, 0]);
  box(ctx, "shell", [1, 0.18, 0.2], [0, -0.41, 0]);
  box(ctx, "shell", [0.18, 1, 0.2], [0.41, 0, 0]);
  box(ctx, "shell", [0.18, 1, 0.2], [-0.41, 0, 0]);
  box(ctx, "composite", [0.66, 0.66, 0.06], [0, 0, -0.02]);
  chamferedBox(ctx, "accent", [0.48, 0.48, 0.05], [0, 0, 0.03], 0.04);
  box(ctx, "frame", [0.05, 0.2, 0.04], [0.17, 0, 0.06]);
  box(ctx, "emissive", [0.66, 0.035, 0.02], [0, -0.3, 0.06]);
  box(ctx, "emissive", [0.4, 0.035, 0.02], [0, 0.3, 0.06]);
  boltRow(ctx, 0.8, 0.41, 0.11, 4);
  boltRow(ctx, 0.8, -0.41, 0.11, 4);
}

const SPIKE_XS_LOW = [-0.33, -0.11, 0.11, 0.33] as const;
const SPIKE_XS_HIGH = [-0.4, -0.2, 0, 0.2, 0.4] as const;

function buildSpikes(ctx: BuildContext): void {
  // Low anchor plate tiles flush with neighboring floor plates; the
  // spikes themselves are the durability-scaled motion assembly.
  box(ctx, "shell", [1, 0.12, 0.3], [0, -0.44, 0]);
  box(ctx, "accent", [0.42, 0.045, 0.02], [-0.22, -0.385, 0.16]);
  box(ctx, "accent", [0.42, 0.045, 0.02], [0.22, -0.385, 0.16]);
  const motion: BuildContext = { ...ctx, parts: ctx.motionParts };
  const xs = ctx.tier === "high" ? SPIKE_XS_HIGH : SPIKE_XS_LOW;
  for (const x of xs) {
    cylinder(motion, "frame", 0, 0.07, 0.42, [x, 0.21, 0], [0, 0, 0], 6);
  }
}

function buildTurret(ctx: BuildContext): void {
  // Pedestal stays put; the sensor head and barrel wilt with damage.
  box(ctx, "shell", [0.8, 0.16, 0.3], [0, -0.42, 0]);
  box(ctx, "frame", [0.5, 0.1, 0.24], [0, -0.31, 0]);
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
  const bounds = new Box3();
  for (const layer of [...layers, ...motionLayers]) {
    if (layer.geometry.boundingBox) bounds.union(layer.geometry.boundingBox);
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
