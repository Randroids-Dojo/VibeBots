import type { BufferGeometry } from "three";
import { afterAll, describe, expect, it } from "vitest";
import {
  clearSurfaceGeometryCacheForTests,
  SURFACE_BUILDING_IDS,
  SURFACE_BUILDING_LAYOUT,
  surfaceBuildingGeometry,
  surfaceVillageGeometry,
} from "./mine-surface-geometry";

afterAll(() => clearSurfaceGeometryCacheForTests());

/**
 * The miner walks the surface at world z 0.2 with its body spanning
 * roughly z -0.07..0.39 and y -0.44 (soles) to 0.36 (hard hat), and the
 * jump jets hover it one full row up (hat around y 1.36). Any village
 * solid inside that vertical band must stay behind the walk plane or
 * the miner clips through it (the 0.1.205 headframe legs and stall
 * doormats regression).
 */
const WALK_BAND_MIN_Y = -0.42;
const WALK_BAND_MAX_Y = 1.45;
const WALK_PLANE_CLEARANCE_Z = -0.1;

function maxWalkBandZ(
  geometry: BufferGeometry,
  offsetY = 0,
  offsetZ = 0,
): number {
  const positions = geometry.getAttribute("position");
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i) + offsetY;
    if (y < WALK_BAND_MIN_Y || y > WALK_BAND_MAX_Y) continue;
    max = Math.max(max, positions.getZ(i) + offsetZ);
  }
  return max;
}

describe("industrial surface geometry", () => {
  for (const tier of ["low", "high"] as const) {
    it(`${tier} tier has finite geometry, normals, and bounds`, () => {
      for (const id of SURFACE_BUILDING_IDS) {
        const model = surfaceBuildingGeometry(id, tier);
        const layers = [...model.layers, ...model.motionLayers];
        expect(layers.length).toBeGreaterThan(0);
        for (const layer of layers) {
          const positions = layer.geometry.getAttribute("position");
          const normals = layer.geometry.getAttribute("normal");
          expect(positions?.count).toBeGreaterThan(0);
          expect(normals?.count).toBe(positions?.count);
          for (let i = 0; i < positions.count; i++) {
            expect(Number.isFinite(positions.getX(i))).toBe(true);
            expect(Number.isFinite(positions.getY(i))).toBe(true);
            expect(Number.isFinite(positions.getZ(i))).toBe(true);
            expect(Number.isFinite(normals.getX(i))).toBe(true);
            expect(Number.isFinite(normals.getY(i))).toBe(true);
            expect(Number.isFinite(normals.getZ(i))).toBe(true);
          }
          expect(layer.geometry.boundingBox?.isEmpty()).toBe(false);
          expect(layer.geometry.boundingSphere?.radius).toBeGreaterThan(0);
        }
        expect(model.bounds.isEmpty()).toBe(false);
        expect(Number.isFinite(model.bounds.min.x)).toBe(true);
        expect(Number.isFinite(model.bounds.max.y)).toBe(true);
      }
    });
  }

  it("reuses the same cached geometry bundle", () => {
    const first = surfaceBuildingGeometry("workshop", "high");
    const second = surfaceBuildingGeometry("workshop", "high");
    expect(second).toBe(first);
    expect(second.layers[0]?.geometry).toBe(first.layers[0]?.geometry);
  });

  it("batches the complete static settlement into five cached role draws", () => {
    for (const tier of ["low", "high"] as const) {
      const first = surfaceVillageGeometry(tier);
      const second = surfaceVillageGeometry(tier);
      expect(second).toBe(first);
      expect(first.map((layer) => layer.role)).toEqual([
        "shell",
        "frame",
        "composite",
        "accent",
        "emissive",
      ]);
      expect(
        first
          .find((layer) => layer.role === "accent")
          ?.geometry.getAttribute("color"),
      ).toBeTruthy();
      expect(
        first
          .find((layer) => layer.role === "emissive")
          ?.geometry.getAttribute("color"),
      ).toBeTruthy();
    }
  });

  it("stays under per-building and settlement triangle limits", () => {
    const totals = { low: 0, high: 0 };
    for (const tier of ["low", "high"] as const) {
      for (const id of SURFACE_BUILDING_IDS) {
        const model = surfaceBuildingGeometry(id, tier);
        expect(model.triangleCount, `${tier}:${id}`).toBeLessThanOrEqual(
          tier === "low" ? 2_200 : 5_500,
        );
        totals[tier] += model.triangleCount;
      }
    }
    expect(totals.low).toBeLessThanOrEqual(15_000);
    expect(totals.high).toBeLessThanOrEqual(36_000);
  });

  it("keeps every entrance legible and clear at the existing columns", () => {
    for (const tier of ["low", "high"] as const) {
      for (const id of SURFACE_BUILDING_IDS) {
        const model = surfaceBuildingGeometry(id, tier);
        expect(
          model.doorway.width,
          `${tier}:${id}:width`,
        ).toBeGreaterThanOrEqual(0.38);
        expect(
          model.doorway.height,
          `${tier}:${id}:height`,
        ).toBeGreaterThanOrEqual(0.3);
        expect(
          model.doorway.depth,
          `${tier}:${id}:depth`,
        ).toBeGreaterThanOrEqual(0.38);
        expect(model.bounds.min.x).toBeGreaterThanOrEqual(-1.101);
        expect(model.bounds.max.x).toBeLessThanOrEqual(1.101);
      }
    }
  });

  it("keeps every solid behind the miner's walk plane", () => {
    for (const tier of ["low", "high"] as const) {
      for (const id of SURFACE_BUILDING_IDS) {
        const model = surfaceBuildingGeometry(id, tier);
        const [, offsetY, offsetZ] = SURFACE_BUILDING_LAYOUT[id];
        for (const layer of [...model.layers, ...model.motionLayers]) {
          expect(
            maxWalkBandZ(layer.geometry, offsetY, offsetZ),
            `${tier}:${id}:${layer.role}`,
          ).toBeLessThanOrEqual(WALK_PLANE_CLEARANCE_Z);
        }
      }
      // The merged settlement (buildings, service deck, lamp posts) is
      // already in world coordinates.
      for (const layer of surfaceVillageGeometry(tier)) {
        expect(
          maxWalkBandZ(layer.geometry),
          `village:${tier}:${layer.role}`,
        ).toBeLessThanOrEqual(WALK_PLANE_CLEARANCE_Z);
      }
    }
  });

  it("adds tertiary detail without changing the silhouette envelope", () => {
    for (const id of SURFACE_BUILDING_IDS) {
      const low = surfaceBuildingGeometry(id, "low");
      const high = surfaceBuildingGeometry(id, "high");
      expect(high.triangleCount).toBeGreaterThanOrEqual(low.triangleCount);
      expect(high.bounds.min.x).toBeCloseTo(low.bounds.min.x, 5);
      expect(high.bounds.max.x).toBeCloseTo(low.bounds.max.x, 5);
      expect(high.bounds.max.y).toBeCloseTo(low.bounds.max.y, 5);
    }
  });
});
