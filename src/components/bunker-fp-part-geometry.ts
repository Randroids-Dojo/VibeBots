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

/**
 * Thin sub-cell variants (F-117). A thin part fills one face or plane of
 * the cell, not the whole room, so a corner can hold two walls and a room
 * can be capped without filling it. Each panel is built CENTERED in a
 * canonical thin axis: wall and door thin in z (a slab facing the corridor),
 * floor and roof thin in y (a deck). The canvas rotates and offsets the
 * whole group onto the target face (fpSlotRenderTransform), so one geometry
 * serves all of a part's slots. Extents stay within +-0.5 like the full-cell
 * parts, and the slab is 0.08 thick so it reads as a panel, not cardboard.
 */
const FP_SLAB_T = 0.08;
const FP_SLAB_SPAN = 0.94;

/** In-plane rivet spots for the thin panels. Corners ship on both tiers;
 * edge midpoints are the high-tier extras. The z-panel spots sit clear of
 * the rim grooves and raised borders; the y-panel spots pin the deck's
 * painted edge strips. */
const FP_THIN_RIVET_CORNERS: readonly (readonly [number, number])[] = [
  [-0.38, -0.38],
  [-0.38, 0.38],
  [0.38, -0.38],
  [0.38, 0.38],
];
const FP_THIN_RIVET_EDGES_Z: readonly (readonly [number, number])[] = [
  [0, 0.405],
  [0, -0.405],
  [0.405, 0],
  [-0.405, 0],
];
const FP_THIN_RIVET_CORNERS_Y: readonly (readonly [number, number])[] = [
  [-0.4, -0.4],
  [-0.4, 0.4],
  [0.4, -0.4],
  [0.4, 0.4],
];
const FP_THIN_RIVET_EDGES_Y: readonly (readonly [number, number])[] = [
  [0, 0.4],
  [0, -0.4],
  [0.4, 0],
  [-0.4, 0],
];

/** Dark rim groove around a thin slab's four in-plane edges, so a panel
 * reads as framed steel and two coplanar panels share a continuous seam. */
function thinRimZ(ctx: BuildContext): void {
  const e = FP_SLAB_SPAN / 2;
  box(ctx, "composite", [FP_SLAB_SPAN, 0.06, FP_SLAB_T + 0.008], [0, e, 0]);
  box(ctx, "composite", [FP_SLAB_SPAN, 0.06, FP_SLAB_T + 0.008], [0, -e, 0]);
  box(ctx, "composite", [0.06, FP_SLAB_SPAN, FP_SLAB_T + 0.008], [e, 0, 0]);
  box(ctx, "composite", [0.06, FP_SLAB_SPAN, FP_SLAB_T + 0.008], [-e, 0, 0]);
}

function thinRimY(ctx: BuildContext): void {
  const e = FP_SLAB_SPAN / 2;
  box(ctx, "composite", [FP_SLAB_SPAN, FP_SLAB_T + 0.008, 0.06], [0, 0, e]);
  box(ctx, "composite", [FP_SLAB_SPAN, FP_SLAB_T + 0.008, 0.06], [0, 0, -e]);
  box(ctx, "composite", [0.06, FP_SLAB_T + 0.008, FP_SLAB_SPAN], [e, 0, 0]);
  box(ctx, "composite", [0.06, FP_SLAB_T + 0.008, FP_SLAB_SPAN], [-e, 0, 0]);
}

/** Tapered rivet heads proud of both faces of a z-thin panel, narrow end
 * out (the thin cousin of faceRivets), kept within |z| 0.06. */
function thinRivetsZ(
  ctx: BuildContext,
  spots: readonly (readonly [number, number])[],
): void {
  for (const face of [-1, 1] as const) {
    for (const [x, y] of spots) {
      cylinder(
        ctx,
        "frame",
        0.03,
        0.037,
        0.024,
        [x, y, face * 0.048],
        [(face * Math.PI) / 2, 0, 0],
        6,
      );
    }
  }
}

/** Tapered rivet heads proud of one deck face of a y-thin panel. */
function thinRivetsY(
  ctx: BuildContext,
  face: -1 | 1,
  spots: readonly (readonly [number, number])[],
): void {
  for (const [x, z] of spots) {
    cylinder(
      ctx,
      "frame",
      0.03,
      0.037,
      0.024,
      [x, face * 0.048, z],
      [face === 1 ? 0 : Math.PI, 0, 0],
      6,
    );
  }
}

function buildThinWall(ctx: BuildContext): void {
  // Beveled plate body: chamfered so raking corridor light catches the edge.
  chamferedBox(
    ctx,
    "shell",
    [FP_SLAB_SPAN, FP_SLAB_SPAN, FP_SLAB_T],
    [0, 0, 0],
    0.028,
  );
  thinRimZ(ctx);
  // Recessed inner panel: a dark inset plate behind a raised steel border,
  // the thin cousin of the full wall's patched-steel faces.
  box(ctx, "composite", [0.6, 0.44, 0.084], [0, 0.1, 0]);
  box(ctx, "frame", [0.68, 0.045, 0.094], [0, 0.3425, 0]);
  box(ctx, "frame", [0.68, 0.045, 0.094], [0, -0.1425, 0]);
  box(ctx, "frame", [0.045, 0.53, 0.094], [0.3225, 0.1, 0]);
  box(ctx, "frame", [0.045, 0.53, 0.094], [-0.3225, 0.1, 0]);
  for (const face of [-1, 1] as const) {
    // Horizontal plate seam between the panel zone and the hazard skirt.
    box(ctx, "composite", [0.86, 0.026, 0.012], [0, -0.21, face * 0.0445]);
    // Hazard chevron skirt: three angled stripes along the plate foot.
    for (const x of [-0.22, 0, 0.22]) {
      box(
        ctx,
        "accent",
        [0.26, 0.05, 0.012],
        [x, -0.33, face * 0.0445],
        [0, 0, Math.PI / 4],
      );
    }
  }
  thinRivetsZ(ctx, FP_THIN_RIVET_CORNERS);
  if (ctx.tier !== "high") return;
  thinRivetsZ(ctx, FP_THIN_RIVET_EDGES_Z);
  // Weld lines inside the recessed panel.
  for (const face of [-1, 1] as const) {
    box(ctx, "composite", [0.024, 0.36, 0.008], [-0.15, 0.1, face * 0.043]);
    box(ctx, "composite", [0.024, 0.36, 0.008], [0.15, 0.1, face * 0.043]);
  }
}

function buildThinFloor(ctx: BuildContext): void {
  box(ctx, "shell", [FP_SLAB_SPAN, FP_SLAB_T, FP_SLAB_SPAN], [0, 0, 0]);
  thinRimY(ctx);
  // Dark grate pit under the walkway so the slats read over a void.
  box(ctx, "composite", [0.78, 0.082, 0.6], [0, 0, 0]);
  // Walkway grate proud of the deck: side rails plus slats, denser on high.
  box(ctx, "frame", [0.9, 0.026, 0.065], [0, 0.049, 0.315]);
  box(ctx, "frame", [0.9, 0.026, 0.065], [0, 0.049, -0.315]);
  const slats = ctx.tier === "high" ? FP_GRATE_XS_HIGH : FP_GRATE_XS_LOW;
  for (const x of slats) {
    box(ctx, "frame", [0.055, 0.026, 0.7], [x, 0.049, 0]);
  }
  // Warm painted edge strips on the bare deck outside the rails, pinned by
  // the corner rivets.
  box(ctx, "accent", [0.9, 0.018, 0.06], [0, 0.046, 0.4]);
  box(ctx, "accent", [0.9, 0.018, 0.06], [0, 0.046, -0.4]);
  thinRivetsY(ctx, 1, FP_THIN_RIVET_CORNERS_Y);
  if (ctx.tier !== "high") return;
  // Cross bars lace the grate, plus edge bolts and underside rivets.
  for (const z of [-0.2, 0, 0.2]) {
    box(ctx, "frame", [0.74, 0.02, 0.045], [0, 0.044, z]);
  }
  thinRivetsY(ctx, 1, FP_THIN_RIVET_EDGES_Y);
  thinRivetsY(ctx, -1, FP_THIN_RIVET_CORNERS_Y);
}

function buildThinRoof(ctx: BuildContext): void {
  box(ctx, "shell", [FP_SLAB_SPAN, FP_SLAB_T, FP_SLAB_SPAN], [0, 0, 0]);
  thinRimY(ctx);
  // Work lamp proud of the underside: dark surround, steel housing, end
  // brackets, and the emissive panel hanging lowest so the warm glow reads
  // from below.
  box(ctx, "composite", [0.5, 0.02, 0.34], [0, -0.045, 0]);
  box(ctx, "frame", [0.44, 0.03, 0.28], [0, -0.052, 0]);
  box(ctx, "emissive", [0.34, 0.024, 0.2], [0, -0.066, 0]);
  box(ctx, "frame", [0.05, 0.05, 0.3], [0.225, -0.048, 0]);
  box(ctx, "frame", [0.05, 0.05, 0.3], [-0.225, -0.048, 0]);
  // Warm trim flanking the lamp, and a conduit feeding it from the rim.
  box(ctx, "accent", [0.44, 0.016, 0.035], [0, -0.046, 0.19]);
  box(ctx, "accent", [0.44, 0.016, 0.035], [0, -0.046, -0.19]);
  cylinder(
    ctx,
    "frame",
    0.022,
    0.022,
    0.3,
    [0.2, -0.048, 0.31],
    [Math.PI / 2, 0, 0],
    8,
  );
  // Vent ridge on the top face.
  box(ctx, "composite", [0.62, 0.024, 0.28], [0, 0.048, 0]);
  const fins = ctx.tier === "high" ? FP_FIN_XS_HIGH : FP_FIN_XS_LOW;
  for (const x of fins) {
    box(ctx, "frame", [0.05, 0.022, 0.3], [x, 0.058, 0]);
  }
  thinRivetsY(ctx, -1, FP_THIN_RIVET_CORNERS_Y);
  if (ctx.tier !== "high") return;
  // Conduit clamps, extra underside rivets, and top-face corner rivets.
  box(ctx, "frame", [0.06, 0.05, 0.05], [0.2, -0.048, 0.24]);
  box(ctx, "frame", [0.06, 0.05, 0.05], [0.2, -0.048, 0.4]);
  thinRivetsY(ctx, -1, FP_THIN_RIVET_EDGES_Y);
  thinRivetsY(ctx, 1, FP_THIN_RIVET_CORNERS_Y);
}

function buildThinDoor(ctx: BuildContext): void {
  // Hatch frame in the wall slab's footprint: sill, lintel, and jambs.
  box(ctx, "shell", [FP_SLAB_SPAN, 0.2, FP_SLAB_T], [0, -0.37, 0]);
  box(ctx, "shell", [FP_SLAB_SPAN, 0.24, FP_SLAB_T], [0, 0.35, 0]);
  box(ctx, "shell", [0.17, FP_SLAB_SPAN, FP_SLAB_T], [-0.385, 0, 0]);
  box(ctx, "shell", [0.17, FP_SLAB_SPAN, FP_SLAB_T], [0.385, 0, 0]);
  thinRimZ(ctx);
  // Raised steel border seating the leaf, plus hinge knuckles on the left.
  box(ctx, "frame", [0.72, 0.05, 0.096], [0, 0.255, 0]);
  box(ctx, "frame", [0.72, 0.05, 0.096], [0, -0.295, 0]);
  box(ctx, "frame", [0.05, 0.6, 0.096], [-0.335, -0.02, 0]);
  box(ctx, "frame", [0.05, 0.6, 0.096], [0.335, -0.02, 0]);
  box(ctx, "frame", [0.05, 0.11, 0.112], [-0.315, 0.12, 0]);
  box(ctx, "frame", [0.05, 0.11, 0.112], [-0.315, -0.16, 0]);
  thinRivetsZ(ctx, FP_THIN_RIVET_CORNERS);
  // Twin ready lights on the lintel, both corridor faces.
  for (const face of [-1, 1] as const) {
    box(ctx, "emissive", [0.1, 0.04, 0.014], [-0.19, 0.315, face * 0.0445]);
    box(ctx, "emissive", [0.1, 0.04, 0.014], [0.19, 0.315, face * 0.0445]);
  }
  if (ctx.tier === "high") {
    thinRivetsZ(ctx, FP_THIN_RIVET_EDGES_Z);
    // Dark bezels behind the ready lights.
    for (const face of [-1, 1] as const) {
      box(ctx, "composite", [0.13, 0.06, 0.01], [-0.19, 0.315, face * 0.0435]);
      box(ctx, "composite", [0.13, 0.06, 0.01], [0.19, 0.315, face * 0.0435]);
    }
  }
  // THE LEAF: the door's single dedicated "accent" layer (chamfered slab,
  // spin wheel, spokes, hazard chevron together), future-swingable as one.
  chamferedBox(ctx, "accent", [0.6, 0.52, 0.1], [0, -0.02, 0], 0.035);
  const wheelSegments = ctx.tier === "high" ? 12 : 8;
  for (const face of [-1, 1] as const) {
    cylinder(
      ctx,
      "accent",
      0.105,
      0.105,
      0.02,
      [0, 0.03, face * 0.053],
      [Math.PI / 2, 0, 0],
      wheelSegments,
    );
    cylinder(
      ctx,
      "accent",
      0.034,
      0.04,
      0.028,
      [0, 0.03, face * 0.058],
      [(face * Math.PI) / 2, 0, 0],
      6,
    );
    box(ctx, "accent", [0.2, 0.024, 0.012], [0, 0.03, face * 0.059]);
    box(ctx, "accent", [0.024, 0.2, 0.012], [0, 0.03, face * 0.059]);
    if (ctx.tier === "high") {
      box(
        ctx,
        "accent",
        [0.2, 0.024, 0.012],
        [0, 0.03, face * 0.059],
        [0, 0, Math.PI / 4],
      );
      box(
        ctx,
        "accent",
        [0.2, 0.024, 0.012],
        [0, 0.03, face * 0.059],
        [0, 0, -Math.PI / 4],
      );
    }
    // Hazard chevron on the leaf foot (accent, so it swings with the leaf).
    box(
      ctx,
      "accent",
      [0.15, 0.034, 0.012],
      [-0.05, -0.2, face * 0.053],
      [0, 0, Math.PI / 4],
    );
    box(
      ctx,
      "accent",
      [0.15, 0.034, 0.012],
      [0.05, -0.2, face * 0.053],
      [0, 0, -Math.PI / 4],
    );
  }
}

const FP_THIN_BUILDERS: Partial<
  Record<BasePartId, (ctx: BuildContext) => void>
> = {
  "wall-panel": buildThinWall,
  "floor-panel": buildThinFloor,
  "roof-panel": buildThinRoof,
  "door-panel": buildThinDoor,
};

const FP_ZERO_ANCHOR = [0, 0, 0] as const;

const cache = new Map<string, BunkerPartGeometry>();

export function bunkerPartFpGeometry(
  id: BasePartId,
  tier: SurfaceGeometryTier,
  thin = false,
): BunkerPartGeometry {
  // A thin sub-cell panel (F-117), built centered in its canonical axis; the
  // caller rotates and offsets the group onto the target face. Parts with no
  // thin builder (turret, spikes) fall through to their full model.
  const builder = thin ? FP_THIN_BUILDERS[id] : FP_BUILDERS[id];
  // Spikes and the turret reuse the 2D cache's exact objects: same
  // geometry, same durability-wilt motion assembly.
  if (!builder) return bunkerPartGeometry(id, tier);
  const key = `${id}:${tier}:${thin ? "thin" : "full"}`;
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
