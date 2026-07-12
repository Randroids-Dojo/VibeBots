import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  Box3,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
} from "three/webgpu";
import type { SurfaceGeometryTier } from "./mine-surface-geometry";

export type SurfaceBackdropRole =
  | "sky"
  | "celestial"
  | "farTerrain"
  | "industry"
  | "nearBerm";

export interface SurfaceBackdropLayer {
  role: SurfaceBackdropRole;
  geometry: BufferGeometry;
  parallax: number;
}

export interface SurfaceBackdropGeometry {
  tier: SurfaceGeometryTier;
  layers: readonly SurfaceBackdropLayer[];
  bounds: Box3;
  triangleCount: number;
}

export const SURFACE_BACKDROP_ROLES: readonly SurfaceBackdropRole[] = [
  "sky",
  "celestial",
  "farTerrain",
  "industry",
  "nearBerm",
] as const;

export const SURFACE_BACKDROP_PARALLAX: Readonly<
  Record<SurfaceBackdropRole, number>
> = {
  sky: 0,
  celestial: 0.01,
  farTerrain: 0.04,
  industry: 0.08,
  nearBerm: 0.12,
};

const BACKDROP_WIDTH = 96;
const cache = new Map<SurfaceGeometryTier, SurfaceBackdropGeometry>();

type Point2 = readonly [number, number];

function colorGeometry(geometry: BufferGeometry, hex: string): BufferGeometry {
  geometry.deleteAttribute("uv");
  const count = geometry.getAttribute("position").count;
  const color = new Color(hex);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  color = "#ffffff",
  rotationZ = 0,
): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.rotateZ(rotationZ);
  geometry.translate(x, y, z);
  return colorGeometry(geometry, color);
}

function polygon(
  points: readonly Point2[],
  z: number,
  color = "#ffffff",
): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  const geometry = new ShapeGeometry(shape);
  geometry.translate(0, 0, z);
  return colorGeometry(geometry, color);
}

function circle(
  radius: number,
  segments: number,
  x: number,
  y: number,
  z: number,
  color: string,
): BufferGeometry {
  const geometry = new CircleGeometry(radius, segments);
  geometry.translate(x, y, z);
  return colorGeometry(geometry, color);
}

function ring(
  innerRadius: number,
  outerRadius: number,
  segments: number,
  x: number,
  y: number,
  z: number,
  scaleY: number,
  rotationZ: number,
  color: string,
): BufferGeometry {
  const geometry = new RingGeometry(innerRadius, outerRadius, segments);
  geometry.scale(1, scaleY, 1);
  geometry.rotateZ(rotationZ);
  geometry.translate(x, y, z);
  return colorGeometry(geometry, color);
}

function beamBetween(
  from: Point2,
  to: Point2,
  thickness: number,
  z: number,
  color = "#ffffff",
): BufferGeometry {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return box(
    Math.hypot(dx, dy),
    thickness,
    0.08,
    (from[0] + to[0]) * 0.5,
    (from[1] + to[1]) * 0.5,
    z,
    color,
    Math.atan2(dy, dx),
  );
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error("surface backdrop geometry did not merge");
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  for (const part of parts) part.dispose();
  return geometry;
}

function buildSky(): BufferGeometry {
  const geometry = new PlaneGeometry(BACKDROP_WIDTH, 34, 1, 4);
  geometry.translate(0, 10.8, -12);
  geometry.deleteAttribute("uv");
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const height = Math.max(0, Math.min(1, (positions.getY(i) + 6.2) / 34));
    const value = 1 - height * 0.56;
    colors[i * 3] = value;
    colors[i * 3 + 1] = value;
    colors[i * 3 + 2] = Math.min(1, value * 1.08);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildCelestial(tier: SurfaceGeometryTier): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const planetX = 6.6;
  const planetY = 8.4;
  parts.push(
    ring(
      4.65,
      5.18,
      tier === "high" ? 48 : 28,
      planetX,
      planetY,
      -10.72,
      0.23,
      -0.16,
      "#c7d0d8",
    ),
    ring(
      5.45,
      5.62,
      tier === "high" ? 48 : 28,
      planetX,
      planetY,
      -10.71,
      0.23,
      -0.16,
      "#798894",
    ),
    circle(
      3.28,
      tier === "high" ? 40 : 24,
      planetX,
      planetY,
      -10.68,
      "#e6ddd0",
    ),
    polygon(
      [
        [planetX - 3.2, planetY - 0.22],
        [planetX - 2.35, planetY - 0.08],
        [planetX - 1.15, planetY - 0.32],
        [planetX, planetY - 0.56],
        [planetX + 1.2, planetY - 0.43],
        [planetX + 2.4, planetY - 0.12],
        [planetX + 3.2, planetY - 0.22],
        [planetX + 2.75, planetY - 1.78],
        [planetX + 1.65, planetY - 2.72],
        [planetX, planetY - 3.25],
        [planetX - 1.65, planetY - 2.72],
        [planetX - 2.75, planetY - 1.78],
      ],
      -10.66,
      "#a8afb6",
    ),
  );
  if (tier === "high") {
    parts.push(
      ring(2.42, 2.52, 40, planetX, planetY, -10.64, 0.35, 0.02, "#ffffff"),
      circle(0.34, 20, -8.1, 11.8, -10.7, "#8a9daa"),
    );
  }
  return merge(parts);
}

function buildFarTerrain(tier: SurfaceGeometryTier): BufferGeometry {
  const parts: BufferGeometry[] = [
    polygon(
      [
        [-48, -0.18],
        [-48, 1.25],
        [-43, 1.25],
        [-40, 2.2],
        [-36, 2.2],
        [-33, 3.25],
        [-28, 3.25],
        [-24, 2.4],
        [-18, 2.4],
        [-14, 3.65],
        [-8, 3.65],
        [-4, 2.05],
        [2, 2.05],
        [6, 2.92],
        [12, 2.92],
        [17, 1.72],
        [23, 1.72],
        [28, 3.1],
        [34, 3.1],
        [38, 2.2],
        [43, 2.2],
        [48, 1.48],
        [48, -0.18],
      ],
      -8.25,
      "#bec5c8",
    ),
    polygon(
      [
        [-48, -0.18],
        [-48, 0.72],
        [-40, 0.72],
        [-35, 1.52],
        [-29, 1.52],
        [-25, 0.88],
        [-18, 0.88],
        [-13, 1.62],
        [-6, 1.62],
        [-1, 0.8],
        [7, 0.8],
        [12, 1.48],
        [20, 1.48],
        [25, 0.7],
        [32, 0.7],
        [37, 1.42],
        [44, 1.42],
        [48, 0.92],
        [48, -0.18],
      ],
      -8.15,
      "#929b9f",
    ),
  ];
  if (tier === "high") {
    for (const [x, y, width] of [
      [-33, 2.63, 8],
      [-14, 2.96, 9],
      [8, 2.34, 8],
      [29, 2.42, 9],
    ] as const) {
      parts.push(box(width, 0.055, 0.07, x, y, -8.05, "#e4e7e6"));
    }
  }
  return merge(parts);
}

function addBucketExcavator(
  parts: BufferGeometry[],
  tier: SurfaceGeometryTier,
) {
  parts.push(
    ring(
      1.05,
      1.28,
      tier === "high" ? 24 : 16,
      -13.8,
      2.05,
      -5.3,
      1,
      0,
      "#aeb6ba",
    ),
    box(2.35, 0.3, 0.12, -11.7, 1.18, -5.28, "#d2d6d7"),
    beamBetween([-12.95, 1.45], [-8.5, 3.25], 0.18, -5.29),
    beamBetween([-8.5, 3.25], [-5.75, 2.82], 0.14, -5.29),
    box(1.1, 0.5, 0.12, -10.7, 1.62, -5.28, "#8f999e"),
  );
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    parts.push(
      beamBetween(
        [-13.8, 2.05],
        [-13.8 + Math.cos(angle) * 1.02, 2.05 + Math.sin(angle) * 1.02],
        0.055,
        -5.27,
        "#7d888e",
      ),
    );
  }
}

function addGantry(parts: BufferGeometry[], x: number, highDetail: boolean) {
  parts.push(
    beamBetween([x - 1.4, 0.45], [x - 0.9, 3.7], 0.17, -5.28),
    beamBetween([x + 1.4, 0.45], [x + 0.9, 3.7], 0.17, -5.28),
    box(2.4, 0.18, 0.12, x, 3.7, -5.28, "#d6dadb"),
    beamBetween([x - 1.15, 1.2], [x + 1.08, 3.15], 0.08, -5.27),
    beamBetween([x + 1.15, 1.2], [x - 1.08, 3.15], 0.08, -5.27),
  );
  if (highDetail) {
    parts.push(
      box(0.08, 1.7, 0.08, x, 2.72, -5.25, "#78848b"),
      box(0.48, 0.25, 0.12, x, 1.9, -5.23, "#98a3a8"),
    );
  }
}

function buildIndustry(tier: SurfaceGeometryTier): BufferGeometry {
  const parts: BufferGeometry[] = [];
  addBucketExcavator(parts, tier);
  addGantry(parts, 10.8, tier === "high");
  parts.push(
    beamBetween([-5.8, 2.8], [0.8, 1.28], 0.16, -5.28),
    beamBetween([0.8, 1.28], [6.6, 2.16], 0.16, -5.28),
    box(1.35, 0.52, 0.12, 3.6, 1.48, -5.27, "#8c969b"),
    box(0.22, 2.7, 0.12, 17.8, 1.85, -5.28, "#9ba5aa"),
    box(1.18, 0.15, 0.1, 17.8, 3.22, -5.27, "#c8cdcf"),
  );
  for (const x of [-3.6, -0.4, 3.2, 6.2]) {
    parts.push(beamBetween([x, 0.42], [x + 0.55, 1.64], 0.08, -5.27));
  }
  if (tier === "high") {
    for (const x of [-7.4, -3.4, 0.6, 4.6]) {
      parts.push(box(0.055, 1.2, 0.065, x, 2.55, -5.24, "#e1e4e4"));
    }
    parts.push(
      beamBetween([15.2, 0.5], [18.9, 2.1], 0.09, -5.26),
      beamBetween([18.9, 2.1], [22.2, 1.56], 0.09, -5.26),
      box(0.08, 1.6, 0.08, 22.2, 2.36, -5.25, "#b8c0c3"),
    );
  }
  return merge(parts);
}

function buildNearBerm(tier: SurfaceGeometryTier): BufferGeometry {
  const parts: BufferGeometry[] = [
    polygon(
      [
        [-48, -0.16],
        [-48, 0.26],
        [-42, 0.26],
        [-39, 0.52],
        [-34, 0.52],
        [-31, 0.3],
        [-24, 0.3],
        [-20, 0.62],
        [-15, 0.62],
        [-11, 0.28],
        [-4, 0.28],
        [0, 0.5],
        [5, 0.5],
        [9, 0.25],
        [16, 0.25],
        [20, 0.58],
        [26, 0.58],
        [30, 0.3],
        [37, 0.3],
        [41, 0.55],
        [48, 0.55],
        [48, -0.16],
      ],
      -2.7,
      "#8f989b",
    ),
    box(BACKDROP_WIDTH, 0.08, 0.08, 0, 0.08, -2.62, "#c9cecf"),
  ];
  if (tier === "high") {
    for (const x of [-38, -28, -18, 14, 24, 34]) {
      parts.push(
        box(0.08, 0.62, 0.08, x, 0.44, -2.58, "#c7ccce"),
        box(0.26, 0.06, 0.08, x, 0.75, -2.58, "#dde0e0"),
      );
    }
  }
  return merge(parts);
}

function triangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute("position").count) / 3;
}

export function surfaceBackdropGeometry(
  tier: SurfaceGeometryTier,
): SurfaceBackdropGeometry {
  const hit = cache.get(tier);
  if (hit) return hit;
  const geometries: Record<SurfaceBackdropRole, BufferGeometry> = {
    sky: buildSky(),
    celestial: buildCelestial(tier),
    farTerrain: buildFarTerrain(tier),
    industry: buildIndustry(tier),
    nearBerm: buildNearBerm(tier),
  };
  const layers = SURFACE_BACKDROP_ROLES.map((role) => ({
    role,
    geometry: geometries[role],
    parallax: SURFACE_BACKDROP_PARALLAX[role],
  }));
  const bounds = new Box3();
  let triangles = 0;
  for (const layer of layers) {
    bounds.union(layer.geometry.boundingBox ?? new Box3());
    triangles += triangleCount(layer.geometry);
  }
  const result = { tier, layers, bounds, triangleCount: triangles } as const;
  cache.set(tier, result);
  return result;
}

/**
 * Backdrop groups follow the camera while retaining a small relative offset.
 * Reduced motion uses factor zero, which keeps the composition locked to the
 * viewport rather than leaving a world-space backdrop behind as the miner walks.
 */
export function surfaceBackdropLayerX(
  cameraX: number,
  parallax: number,
  reducedMotion: boolean,
): number {
  return cameraX * (1 - (reducedMotion ? 0 : parallax));
}

export function clearSurfaceBackdropCacheForTests(): void {
  cache.clear();
}
