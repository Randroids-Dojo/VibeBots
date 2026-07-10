import { afterAll, describe, expect, it } from "vitest";
import {
  clearSurfaceGeometryCacheForTests,
  SURFACE_BUILDING_IDS,
  surfaceBuildingGeometry,
  surfaceVillageGeometry,
} from "./mine-surface-geometry";

afterAll(() => clearSurfaceGeometryCacheForTests());

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
