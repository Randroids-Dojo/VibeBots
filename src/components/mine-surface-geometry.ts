import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  mergeGeometries,
  toCreasedNormals,
} from "three/addons/utils/BufferGeometryUtils.js";
import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three/webgpu";

export type SurfaceBuildingId =
  | "workshop"
  | "elevator"
  | "buyer"
  | "headframe"
  | "supply"
  | "upgrades"
  | "warp"
  | "battles";

export type SurfaceGeometryTier = "low" | "high";

export type SurfaceMaterialRole =
  | "shell"
  | "frame"
  | "composite"
  | "accent"
  | "emissive";

export const SURFACE_BUILDING_IDS: readonly SurfaceBuildingId[] = [
  "workshop",
  "elevator",
  "buyer",
  "headframe",
  "supply",
  "upgrades",
  "warp",
  "battles",
] as const;

export const SURFACE_PALETTE = {
  voidGraphite: "#111821",
  armoredShell: "#26313B",
  brushedTitanium: "#98A6B3",
  safetyOrange: "#F28B30",
  energyCyan: "#5EE7DF",
  warmWorkLight: "#FFD08A",
} as const;

export const SURFACE_CAMP_WIDTH = 60;

export interface SurfaceGeometryLayer {
  role: SurfaceMaterialRole;
  geometry: BufferGeometry;
}

export interface SurfaceDoorwayClearance {
  width: number;
  height: number;
  depth: number;
}

export interface SurfaceBuildingGeometry {
  id: SurfaceBuildingId;
  tier: SurfaceGeometryTier;
  layers: readonly SurfaceGeometryLayer[];
  motionLayers: readonly SurfaceGeometryLayer[];
  bounds: Box3;
  triangleCount: number;
  doorway: SurfaceDoorwayClearance;
}

type LayerParts = Record<SurfaceMaterialRole, BufferGeometry[]>;

interface BuildContext {
  tier: SurfaceGeometryTier;
  parts: LayerParts;
  motionParts: LayerParts;
}

const cache = new Map<string, SurfaceBuildingGeometry>();
let infrastructureCache: readonly SurfaceGeometryLayer[] | null = null;
const villageCache = new Map<
  SurfaceGeometryTier,
  readonly SurfaceGeometryLayer[]
>();
const unitY = new Vector3(0, 1, 0);
const midpoint = new Vector3();
const direction = new Vector3();
const beamQuaternion = new Quaternion();

function blankParts(): LayerParts {
  return {
    shell: [],
    frame: [],
    composite: [],
    accent: [],
    emissive: [],
  };
}

function transform(
  geometry: BufferGeometry,
  position: readonly [number, number, number],
  rotationEuler: readonly [number, number, number] = [0, 0, 0],
): BufferGeometry {
  geometry.rotateX(rotationEuler[0]);
  geometry.rotateY(rotationEuler[1]);
  geometry.rotateZ(rotationEuler[2]);
  geometry.translate(position[0], position[1], position[2]);
  return geometry;
}

function box(
  ctx: BuildContext,
  role: SurfaceMaterialRole,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  rotationEuler: readonly [number, number, number] = [0, 0, 0],
): void {
  ctx.parts[role].push(
    transform(
      new BoxGeometry(size[0], size[1], size[2]),
      position,
      rotationEuler,
    ),
  );
}

function chamferedBox(
  ctx: BuildContext,
  role: SurfaceMaterialRole,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  radius = 0.045,
  rotationEuler: readonly [number, number, number] = [0, 0, 0],
): void {
  ctx.parts[role].push(
    transform(
      new RoundedBoxGeometry(
        size[0],
        size[1],
        size[2],
        ctx.tier === "high" ? 2 : 1,
        radius,
      ),
      position,
      rotationEuler,
    ),
  );
}

function cylinder(
  ctx: BuildContext,
  role: SurfaceMaterialRole,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: readonly [number, number, number],
  rotationEuler: readonly [number, number, number] = [0, 0, 0],
  segments = 10,
): void {
  ctx.parts[role].push(
    transform(
      new CylinderGeometry(radiusTop, radiusBottom, height, segments),
      position,
      rotationEuler,
    ),
  );
}

function torus(
  ctx: BuildContext,
  role: SurfaceMaterialRole,
  radius: number,
  tube: number,
  position: readonly [number, number, number],
  rotationEuler: readonly [number, number, number] = [0, 0, 0],
  radialSegments = 6,
  tubularSegments = 16,
): void {
  ctx.parts[role].push(
    transform(
      new TorusGeometry(radius, tube, radialSegments, tubularSegments),
      position,
      rotationEuler,
    ),
  );
}

function beam(
  ctx: BuildContext,
  role: SurfaceMaterialRole,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  thickness = 0.08,
): void {
  midpoint.set(
    (from[0] + to[0]) * 0.5,
    (from[1] + to[1]) * 0.5,
    (from[2] + to[2]) * 0.5,
  );
  direction.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const length = direction.length();
  direction.normalize();
  const geometry = new BoxGeometry(thickness, length, thickness);
  beamQuaternion.setFromUnitVectors(unitY, direction);
  geometry.applyQuaternion(beamQuaternion);
  geometry.translate(midpoint.x, midpoint.y, midpoint.z);
  ctx.parts[role].push(geometry);
}

function panelSeams(
  ctx: BuildContext,
  width: number,
  y: number,
  z: number,
  count: number,
): void {
  if (ctx.tier !== "high") return;
  for (let i = 1; i < count; i++) {
    const x = -width * 0.5 + (width * i) / count;
    box(ctx, "frame", [0.018, 0.52, 0.018], [x, y, z]);
  }
}

function boltRow(
  ctx: BuildContext,
  width: number,
  y: number,
  z: number,
  count: number,
): void {
  if (ctx.tier !== "high") return;
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : -width * 0.5 + (width * i) / (count - 1);
    cylinder(
      ctx,
      "frame",
      0.025,
      0.025,
      0.025,
      [x, y, z],
      [Math.PI / 2, 0, 0],
      6,
    );
  }
}

function threshold(ctx: BuildContext, width = 0.72, z = 0.78): void {
  box(ctx, "frame", [width + 0.18, 0.08, 0.42], [0, 1.12, z]);
  box(ctx, "emissive", [width, 0.024, 0.28], [0, 1.165, z + 0.02]);
}

function warmDoor(
  ctx: BuildContext,
  width: number,
  height: number,
  z: number,
  x = 0,
): void {
  box(ctx, "composite", [width, height, 0.07], [x, 1.14 + height * 0.5, z]);
  box(
    ctx,
    "emissive",
    [width * 0.78, 0.06, 0.018],
    [x, 1.23 + height * 0.82, z + 0.046],
  );
}

function roofRails(
  ctx: BuildContext,
  width: number,
  y: number,
  depth: number,
): void {
  box(ctx, "frame", [width, 0.09, 0.09], [0, y, depth]);
  box(ctx, "frame", [width, 0.09, 0.09], [0, y, -depth]);
  if (ctx.tier === "high") {
    box(ctx, "frame", [0.08, 0.08, depth * 2], [-width * 0.36, y + 0.04, 0]);
    box(ctx, "frame", [0.08, 0.08, depth * 2], [width * 0.36, y + 0.04, 0]);
  }
}

function addGearSymbol(
  ctx: BuildContext,
  x: number,
  y: number,
  z: number,
): void {
  torus(ctx, "accent", 0.14, 0.038, [x, y, z], [Math.PI / 2, 0, 0], 5, 12);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6;
    box(
      ctx,
      "accent",
      [0.055, 0.12, 0.035],
      [x + Math.cos(a) * 0.18, y + Math.sin(a) * 0.18, z],
      [0, 0, a],
    );
  }
}

function addCrossedToolSymbol(
  ctx: BuildContext,
  y: number,
  z: number,
  role: SurfaceMaterialRole = "accent",
): void {
  box(ctx, role, [0.055, 0.42, 0.035], [0, y, z], [0, 0, 0.68]);
  box(ctx, role, [0.055, 0.42, 0.035], [0, y, z + 0.004], [0, 0, -0.68]);
  box(ctx, role, [0.16, 0.055, 0.04], [-0.13, y + 0.15, z], [0, 0, 0.68]);
  box(ctx, role, [0.16, 0.055, 0.04], [0.13, y + 0.15, z], [0, 0, -0.68]);
}

function buildWorkshop(ctx: BuildContext): SurfaceDoorwayClearance {
  chamferedBox(ctx, "shell", [1.74, 1.18, 0.92], [0, 1.72, 0], 0.065);
  box(ctx, "frame", [1.95, 0.16, 1.05], [0, 2.39, 0]);
  for (const x of [-0.78, 0.78]) {
    box(ctx, "frame", [0.16, 1.34, 0.15], [x, 1.76, 0.46]);
    beam(ctx, "frame", [x, 2.34, 0.48], [x * 0.68, 2.58, 0.48], 0.11);
  }
  warmDoor(ctx, 1.08, 0.88, 0.49);
  box(ctx, "emissive", [0.86, 0.035, 0.025], [0, 1.45, 0.545]);
  box(ctx, "emissive", [0.86, 0.035, 0.025], [0, 1.72, 0.545]);
  roofRails(ctx, 1.45, 2.51, 0.36);
  box(ctx, "accent", [0.62, 0.09, 0.09], [0, 2.45, 0.52]);
  addGearSymbol(ctx, -0.58, 2.03, 0.515);
  if (ctx.tier === "high") {
    for (const x of [-0.58, 0, 0.58]) {
      box(ctx, "composite", [0.23, 0.19, 0.08], [x, 1.28, 0.55]);
    }
    panelSeams(ctx, 1.5, 1.92, 0.485, 5);
    boltRow(ctx, 1.5, 2.28, 0.53, 7);
  }
  threshold(ctx, 0.96);
  return { width: 1.02, height: 0.82, depth: 0.44 };
}

function buildElevator(ctx: BuildContext): SurfaceDoorwayClearance {
  chamferedBox(ctx, "shell", [1.36, 0.86, 0.82], [0, 1.52, 0], 0.055);
  warmDoor(ctx, 0.48, 0.62, 0.44, 0.25);
  for (const x of [-0.52, 0.52]) {
    beam(ctx, "frame", [x, 1.16, 0.28], [x * 0.62, 3.34, 0.2], 0.12);
    beam(ctx, "frame", [x, 1.16, -0.28], [x * 0.62, 3.34, -0.2], 0.12);
  }
  for (const y of [1.72, 2.26, 2.8]) {
    beam(ctx, "frame", [-0.46, y - 0.22, 0.31], [0.46, y + 0.22, 0.31], 0.065);
    beam(ctx, "frame", [0.46, y - 0.22, 0.31], [-0.46, y + 0.22, 0.31], 0.065);
  }
  box(ctx, "frame", [0.9, 0.12, 0.58], [0, 3.34, 0]);
  torus(
    ctx,
    "accent",
    0.28,
    0.055,
    [0, 3.55, 0.02],
    [Math.PI / 2, 0, 0],
    6,
    ctx.tier === "high" ? 20 : 12,
  );
  cylinder(
    ctx,
    "frame",
    0.08,
    0.08,
    0.52,
    [0, 3.55, 0],
    [Math.PI / 2, 0, 0],
    8,
  );
  cylinder(
    ctx,
    "composite",
    0.2,
    0.2,
    0.55,
    [0, 2.07, 0.04],
    [Math.PI / 2, 0, 0],
    ctx.tier === "high" ? 14 : 8,
  );
  box(ctx, "composite", [0.035, 1.46, 0.035], [0, 2.75, 0.2]);
  box(ctx, "emissive", [0.08, 0.08, 0.08], [0, 3.82, 0]);
  if (ctx.tier === "high") {
    boltRow(ctx, 1.05, 1.99, 0.46, 6);
    box(ctx, "accent", [0.16, 0.4, 0.045], [-0.38, 1.62, 0.46], [0, 0, 0.62]);
    box(ctx, "accent", [0.16, 0.4, 0.045], [-0.38, 1.62, 0.46], [0, 0, -0.62]);
  }
  threshold(ctx, 0.72);
  return { width: 0.44, height: 0.58, depth: 0.38 };
}

function buildHardware(ctx: BuildContext): SurfaceDoorwayClearance {
  chamferedBox(ctx, "shell", [1.62, 1.22, 0.92], [0, 1.72, 0], 0.065);
  box(ctx, "frame", [1.82, 0.16, 1.04], [0, 2.4, 0]);
  for (const x of [-0.68, 0.68]) {
    box(ctx, "frame", [0.18, 1.18, 0.18], [x, 1.7, 0.48]);
    box(ctx, "composite", [0.22, 0.32, 0.12], [x, 1.34, 0.56]);
    if (ctx.tier === "high") {
      box(ctx, "accent", [0.12, 0.018, 0.13], [x, 1.42, 0.63]);
    }
  }
  warmDoor(ctx, 0.54, 0.7, 0.49);
  box(ctx, "shell", [1.2, 0.36, 0.22], [0, 2.54, 0.37]);
  box(ctx, "accent", [0.11, 0.46, 0.045], [0.03, 2.55, 0.5], [0, 0, -0.45]);
  box(ctx, "accent", [0.26, 0.1, 0.045], [-0.04, 2.67, 0.5], [0, 0, -0.45]);
  box(ctx, "accent", [0.25, 0.1, 0.045], [0.1, 2.42, 0.5], [0, 0, -0.45]);
  panelSeams(ctx, 1.35, 1.82, 0.485, 4);
  boltRow(ctx, 1.42, 2.3, 0.54, 7);
  threshold(ctx, 0.78);
  return { width: 0.5, height: 0.66, depth: 0.42 };
}

function buildHeadframe(ctx: BuildContext): SurfaceDoorwayClearance {
  for (const x of [-0.62, 0.62]) {
    beam(ctx, "frame", [x, 1.1, 0.28], [x * 0.5, 2.85, 0.12], 0.13);
    beam(ctx, "frame", [x, 1.1, -0.28], [x * 0.5, 2.85, -0.12], 0.13);
  }
  beam(ctx, "frame", [-0.55, 1.42, 0.31], [0.5, 2.35, 0.22], 0.07);
  beam(ctx, "frame", [0.55, 1.42, 0.31], [-0.5, 2.35, 0.22], 0.07);
  chamferedBox(ctx, "shell", [0.98, 0.42, 0.7], [0, 1.32, 0], 0.045);
  warmDoor(ctx, 0.38, 0.32, 0.38);
  box(ctx, "frame", [0.92, 0.14, 0.54], [0, 2.85, 0]);
  torus(
    ctx,
    "accent",
    0.29,
    0.062,
    [0, 3.08, 0.04],
    [Math.PI / 2, 0, 0],
    6,
    ctx.tier === "high" ? 18 : 12,
  );
  cylinder(
    ctx,
    "frame",
    0.075,
    0.075,
    0.5,
    [0, 3.08, 0],
    [Math.PI / 2, 0, 0],
    8,
  );
  box(ctx, "composite", [0.03, 1.54, 0.03], [0, 2.18, 0.18]);
  for (const x of [-0.47, 0.47]) {
    box(ctx, "emissive", [0.07, 0.07, 0.07], [x, 2.98, 0.24]);
  }
  if (ctx.tier === "high") {
    boltRow(ctx, 0.76, 2.72, 0.3, 5);
  }
  return { width: 0.78, height: 0.7, depth: 0.52 };
}

function buildSupply(ctx: BuildContext): SurfaceDoorwayClearance {
  chamferedBox(ctx, "shell", [1.62, 1.0, 0.9], [0, 1.6, 0], 0.06);
  box(ctx, "composite", [1.12, 0.58, 0.07], [0, 1.56, 0.48]);
  box(ctx, "frame", [1.18, 0.12, 0.3], [0, 1.27, 0.61]);
  box(ctx, "accent", [1.5, 0.07, 0.56], [0, 2.17, 0.55], [0.42, 0, 0]);
  for (const x of [-0.66, 0.66]) {
    box(ctx, "frame", [0.08, 0.82, 0.08], [x, 1.54, 0.65]);
  }
  for (const x of [-0.92, 0.92]) {
    cylinder(
      ctx,
      "composite",
      0.14,
      0.16,
      0.4,
      [x, 1.31, 0.18],
      [0, 0, 0],
      ctx.tier === "high" ? 12 : 8,
    );
    box(ctx, "accent", [0.31, 0.055, 0.31], [x, 1.38, 0.18]);
  }
  box(ctx, "emissive", [0.58, 0.055, 0.018], [0, 1.78, 0.525]);
  if (ctx.tier === "high") {
    for (const x of [-0.34, 0, 0.34]) {
      box(ctx, "frame", [0.24, 0.18, 0.15], [x, 1.39, 0.58]);
    }
    panelSeams(ctx, 1.38, 1.66, -0.46, 5);
  }
  threshold(ctx, 1.02);
  return { width: 1.04, height: 0.54, depth: 0.48 };
}

function buildUpgrades(ctx: BuildContext): SurfaceDoorwayClearance {
  chamferedBox(ctx, "shell", [1.44, 1.12, 0.92], [0, 1.66, 0], 0.06);
  box(ctx, "frame", [1.62, 0.14, 1.02], [0, 2.3, 0]);
  warmDoor(ctx, 0.46, 0.66, 0.49, 0.38);
  box(ctx, "emissive", [0.48, 0.42, 0.035], [-0.3, 1.72, 0.52]);
  box(ctx, "frame", [0.58, 0.06, 0.05], [-0.3, 1.95, 0.55]);
  for (const x of [-0.53, 0.53]) {
    box(ctx, "frame", [0.12, 1.02, 0.14], [x, 1.66, 0.5]);
  }
  cylinder(
    ctx,
    "composite",
    0.15,
    0.18,
    0.92,
    [-0.38, 2.72, -0.06],
    [0, 0, 0],
    ctx.tier === "high" ? 12 : 8,
  );
  box(ctx, "frame", [0.4, 0.1, 0.38], [-0.38, 3.18, -0.06]);
  box(ctx, "accent", [0.08, 1.15, 0.08], [0.58, 2.48, 0]);
  box(ctx, "accent", [0.42, 0.08, 0.08], [0.43, 2.84, 0], [0, 0, -0.5]);
  addCrossedToolSymbol(ctx, 2.14, 0.53, "accent");
  if (ctx.tier === "high") {
    for (const y of [2.44, 2.66, 2.88]) {
      torus(
        ctx,
        "frame",
        0.18,
        0.025,
        [-0.38, y, -0.06],
        [Math.PI / 2, 0, 0],
        4,
        10,
      );
    }
    boltRow(ctx, 1.22, 2.2, 0.53, 6);
  }
  threshold(ctx, 0.74);
  return { width: 0.42, height: 0.62, depth: 0.42 };
}

function buildWarp(ctx: BuildContext): SurfaceDoorwayClearance {
  cylinder(
    ctx,
    "shell",
    0.9,
    1.02,
    0.18,
    [0, 1.16, 0],
    [0, 0, 0],
    ctx.tier === "high" ? 16 : 10,
  );
  const ringCtx: BuildContext = {
    tier: ctx.tier,
    parts: ctx.motionParts,
    motionParts: blankParts(),
  };
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    const x = Math.cos(a) * 0.63;
    const y = 2.02 + Math.sin(a) * 0.63;
    box(
      ringCtx,
      "frame",
      [0.34, 0.13, 0.15],
      [x, y, 0],
      [0, 0, a + Math.PI / 2],
    );
    box(
      ringCtx,
      "emissive",
      [0.23, 0.035, 0.17],
      [x, y, 0.1],
      [0, 0, a + Math.PI / 2],
    );
  }
  for (const x of [-0.92, 0.92]) {
    chamferedBox(ctx, "shell", [0.25, 0.86, 0.3], [x, 1.58, 0], 0.035);
    box(ctx, "frame", [0.34, 0.11, 0.38], [x, 2.03, 0]);
    box(ctx, "emissive", [0.08, 0.32, 0.025], [x, 1.63, 0.165]);
  }
  chamferedBox(
    ctx,
    "shell",
    [0.34, 0.42, 0.3],
    [0.54, 1.36, 0.42],
    0.035,
    [0, 0, -0.14],
  );
  box(ctx, "emissive", [0.22, 0.09, 0.025], [0.54, 1.47, 0.59], [0, 0, -0.14]);
  box(ctx, "accent", [0.18, 0.34, 0.055], [0, 2.02, 0.05], [0, 0, Math.PI / 4]);
  if (ctx.tier === "high") {
    boltRow(ctx, 1.36, 1.18, 0.54, 7);
    for (const x of [-0.92, 0.92]) {
      box(ctx, "accent", [0.29, 0.045, 0.32], [x, 1.36, 0]);
    }
  }
  threshold(ctx, 0.82);
  return { width: 0.84, height: 1.14, depth: 0.5 };
}

function buildBattles(ctx: BuildContext): SurfaceDoorwayClearance {
  chamferedBox(ctx, "shell", [1.78, 1.24, 0.94], [0, 1.73, 0], 0.07);
  for (const x of [-0.76, 0.76]) {
    beam(ctx, "frame", [x, 1.12, 0.5], [x * 0.78, 2.45, 0.5], 0.18);
    beam(ctx, "frame", [x, 1.38, 0.52], [x * 0.62, 2.28, 0.52], 0.09);
  }
  box(ctx, "frame", [1.7, 0.18, 1.04], [0, 2.43, 0]);
  warmDoor(ctx, 0.68, 0.82, 0.5);
  box(ctx, "emissive", [0.58, 0.72, 0.018], [0, 1.62, 0.55]);
  box(ctx, "composite", [0.76, 0.18, 0.12], [0, 2.14, 0.55]);
  addCrossedToolSymbol(ctx, 2.38, 0.56, "accent");
  for (const x of [-0.62, 0.62]) {
    box(ctx, "accent", [0.08, 0.42, 0.04], [x, 1.9, 0.56]);
  }
  panelSeams(ctx, 1.5, 1.78, -0.48, 5);
  boltRow(ctx, 1.5, 2.31, 0.56, 7);
  threshold(ctx, 0.88);
  return { width: 0.64, height: 0.76, depth: 0.46 };
}

const builders: Record<
  SurfaceBuildingId,
  (ctx: BuildContext) => SurfaceDoorwayClearance
> = {
  workshop: buildWorkshop,
  elevator: buildElevator,
  buyer: buildHardware,
  headframe: buildHeadframe,
  supply: buildSupply,
  upgrades: buildUpgrades,
  warp: buildWarp,
  battles: buildBattles,
};

function triangleCount(geometry: BufferGeometry): number {
  return geometry.index
    ? geometry.index.count / 3
    : (geometry.getAttribute("position")?.count ?? 0) / 3;
}

function mergeLayer(
  role: SurfaceMaterialRole,
  geometries: BufferGeometry[],
): SurfaceGeometryLayer | null {
  if (geometries.length === 0) return null;
  const normalized = geometries.map((source) => {
    const geometry = source.index ? source.toNonIndexed() : source;
    for (const attribute of Object.keys(geometry.attributes)) {
      if (
        attribute !== "position" &&
        attribute !== "normal" &&
        attribute !== "color"
      ) {
        geometry.deleteAttribute(attribute);
      }
    }
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    if (geometry !== source) source.dispose();
    return geometry;
  });
  const merged = mergeGeometries(normalized, false);
  if (!merged) throw new Error(`Unable to merge surface ${role} geometry`);
  for (const geometry of normalized) geometry.dispose();
  const creased = toCreasedNormals(merged, Math.PI / 3);
  if (creased !== merged) merged.dispose();
  creased.computeBoundingBox();
  creased.computeBoundingSphere();
  creased.name = `surface:${role}`;
  return { role, geometry: creased };
}

export function surfaceBuildingGeometry(
  id: SurfaceBuildingId,
  tier: SurfaceGeometryTier,
): SurfaceBuildingGeometry {
  const key = `${id}:${tier}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const ctx: BuildContext = {
    tier,
    parts: blankParts(),
    motionParts: blankParts(),
  };
  const doorway = builders[id](ctx);
  const layers = (Object.keys(ctx.parts) as SurfaceMaterialRole[])
    .map((role) => mergeLayer(role, ctx.parts[role]))
    .filter((layer): layer is SurfaceGeometryLayer => layer !== null);
  const motionLayers = (Object.keys(ctx.motionParts) as SurfaceMaterialRole[])
    .map((role) => mergeLayer(role, ctx.motionParts[role]))
    .filter((layer): layer is SurfaceGeometryLayer => layer !== null);
  const bounds = new Box3();
  for (const layer of [...layers, ...motionLayers]) {
    const layerBounds = layer.geometry.boundingBox;
    if (layerBounds) bounds.union(layerBounds);
  }
  const triangleCountTotal = [...layers, ...motionLayers].reduce(
    (sum, layer) => sum + triangleCount(layer.geometry),
    0,
  );
  const result: SurfaceBuildingGeometry = {
    id,
    tier,
    layers,
    motionLayers,
    bounds,
    triangleCount: triangleCountTotal,
    doorway,
  };
  cache.set(key, result);
  return result;
}

export function surfaceVillageInfrastructureGeometry(): readonly SurfaceGeometryLayer[] {
  if (infrastructureCache) return infrastructureCache;
  const ctx: BuildContext = {
    tier: "low",
    parts: blankParts(),
    motionParts: blankParts(),
  };
  for (let col = -7; col <= 8; col++) {
    if (col === 0) continue;
    box(ctx, "frame", [0.9, 0.08, 0.72], [col, 1.08, 0.82]);
    box(ctx, "composite", [0.035, 0.018, 0.66], [col + 0.45, 1.13, 0.82]);
    box(ctx, "emissive", [0.82, 0.022, 0.035], [col, 1.135, 1.14]);
  }
  for (const x of [-7, -5, -3, 0, 2, 4, 6, 8]) {
    box(ctx, "emissive", [0.18, 0.045, 0.18], [x, 1.15, 0.82]);
  }
  infrastructureCache = (Object.keys(ctx.parts) as SurfaceMaterialRole[])
    .map((role) => mergeLayer(role, ctx.parts[role]))
    .filter((layer): layer is SurfaceGeometryLayer => layer !== null);
  return infrastructureCache;
}

const SURFACE_BUILDING_LAYOUT: Record<
  SurfaceBuildingId,
  readonly [number, number, number]
> = {
  workshop: [-7, -1.5, -0.85],
  elevator: [-5, -1.5, -0.85],
  buyer: [-3, -1.5, -0.85],
  headframe: [0, -1.5, 0],
  supply: [2, -1.5, -0.85],
  upgrades: [4, -1.5, -0.85],
  warp: [6, -1.5, -0.85],
  battles: [8, -1.5, -0.85],
};

export const SURFACE_WARP_POSITION = SURFACE_BUILDING_LAYOUT.warp;

const SURFACE_BUILDING_ACCENTS: Record<SurfaceBuildingId, string> = {
  workshop: "#9AD0FF",
  elevator: "#9AA7FF",
  buyer: "#F5C542",
  headframe: SURFACE_PALETTE.safetyOrange,
  supply: "#FF9F43",
  upgrades: "#54E0C7",
  warp: "#E08AFF",
  battles: "#FF8F6B",
};

const SURFACE_BUILDING_EMISSIVES: Record<SurfaceBuildingId, string> = {
  workshop: SURFACE_PALETTE.energyCyan,
  elevator: SURFACE_PALETTE.warmWorkLight,
  buyer: SURFACE_PALETTE.warmWorkLight,
  headframe: SURFACE_PALETTE.warmWorkLight,
  supply: SURFACE_PALETTE.warmWorkLight,
  upgrades: SURFACE_PALETTE.energyCyan,
  warp: SURFACE_PALETTE.energyCyan,
  battles: "#FF4E42",
};

function addVertexColor(geometry: BufferGeometry, hex: string): void {
  const count = geometry.getAttribute("position").count;
  const color = new Color(hex);
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const offset = i * 3;
    values[offset] = color.r;
    values[offset + 1] = color.g;
    values[offset + 2] = color.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(values, 3));
}

function villagePart(
  geometry: BufferGeometry,
  position: readonly [number, number, number],
  color?: string,
): BufferGeometry {
  const part = geometry.clone();
  part.translate(position[0], position[1], position[2]);
  if (color) addVertexColor(part, color);
  return part;
}

/**
 * Whole-settlement batch. Building-level bundles stay available for unit
 * contracts and isolated review, while production merges their shared
 * roles across the row so richer silhouettes do not become richer draws.
 */
export function surfaceVillageGeometry(
  tier: SurfaceGeometryTier,
): readonly SurfaceGeometryLayer[] {
  const existing = villageCache.get(tier);
  if (existing) return existing;
  const parts = blankParts();

  for (const id of SURFACE_BUILDING_IDS) {
    const position = SURFACE_BUILDING_LAYOUT[id];
    const model = surfaceBuildingGeometry(id, tier);
    for (const layer of model.layers) {
      const color =
        layer.role === "accent"
          ? SURFACE_BUILDING_ACCENTS[id]
          : layer.role === "emissive"
            ? SURFACE_BUILDING_EMISSIVES[id]
            : undefined;
      parts[layer.role].push(villagePart(layer.geometry, position, color));
    }
  }

  for (const layer of surfaceVillageInfrastructureGeometry()) {
    parts[layer.role].push(
      villagePart(
        layer.geometry,
        [0, -1.5, -0.85],
        layer.role === "emissive" ? SURFACE_PALETTE.energyCyan : undefined,
      ),
    );
  }

  parts.composite.push(
    transform(new BoxGeometry(SURFACE_CAMP_WIDTH, 0.07, 0.9), [0, -0.47, -0.3]),
  );
  for (const x of [-1.3, 1.3]) {
    parts.frame.push(
      transform(new BoxGeometry(0.07, 0.95, 0.07), [x, -0.05, 0.3]),
    );
    const lamp = transform(new CylinderGeometry(0.09, 0.12, 0.18, 6), [
      x,
      0.45,
      0.3,
    ]);
    addVertexColor(lamp, SURFACE_PALETTE.warmWorkLight);
    parts.emissive.push(lamp);
  }

  const layers = (Object.keys(parts) as SurfaceMaterialRole[])
    .map((role) => mergeLayer(role, parts[role]))
    .filter((layer): layer is SurfaceGeometryLayer => layer !== null);
  villageCache.set(tier, layers);
  return layers;
}

export function clearSurfaceGeometryCacheForTests(): void {
  for (const model of cache.values()) {
    for (const layer of [...model.layers, ...model.motionLayers]) {
      layer.geometry.dispose();
    }
  }
  cache.clear();
  if (infrastructureCache) {
    for (const layer of infrastructureCache) layer.geometry.dispose();
    infrastructureCache = null;
  }
  for (const layers of villageCache.values()) {
    for (const layer of layers) layer.geometry.dispose();
  }
  villageCache.clear();
}
