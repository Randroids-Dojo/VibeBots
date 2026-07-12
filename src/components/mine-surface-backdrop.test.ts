import { afterAll, describe, expect, it } from "vitest";
import {
  clearSurfaceBackdropCacheForTests,
  SURFACE_BACKDROP_PARALLAX,
  SURFACE_BACKDROP_ROLES,
  surfaceBackdropGeometry,
  surfaceBackdropLayerX,
} from "./mine-surface-backdrop";
import {
  applySurfaceBackdropGrade,
  resetSurfaceBackdropGradeForTests,
  surfaceBackdropMaterial,
} from "./mine-surface-backdrop-materials";
import { daylightGradeFor } from "./time-of-day";

afterAll(() => {
  clearSurfaceBackdropCacheForTests();
  resetSurfaceBackdropGradeForTests();
});

describe("off-world surface backdrop", () => {
  for (const tier of ["low", "high"] as const) {
    it(`${tier} tier has finite merged layers and valid bounds`, () => {
      const backdrop = surfaceBackdropGeometry(tier);
      expect(backdrop.layers.map((layer) => layer.role)).toEqual(
        SURFACE_BACKDROP_ROLES,
      );
      expect(backdrop.bounds.isEmpty()).toBe(false);
      for (const layer of backdrop.layers) {
        const positions = layer.geometry.getAttribute("position");
        const normals = layer.geometry.getAttribute("normal");
        const colors = layer.geometry.getAttribute("color");
        expect(positions.count).toBeGreaterThan(0);
        expect(normals.count).toBe(positions.count);
        expect(colors.count).toBe(positions.count);
        for (let i = 0; i < positions.count; i++) {
          expect(Number.isFinite(positions.getX(i))).toBe(true);
          expect(Number.isFinite(positions.getY(i))).toBe(true);
          expect(Number.isFinite(positions.getZ(i))).toBe(true);
          expect(Number.isFinite(normals.getX(i))).toBe(true);
          expect(Number.isFinite(normals.getY(i))).toBe(true);
          expect(Number.isFinite(normals.getZ(i))).toBe(true);
          expect(Number.isFinite(colors.getX(i))).toBe(true);
          expect(Number.isFinite(colors.getY(i))).toBe(true);
          expect(Number.isFinite(colors.getZ(i))).toBe(true);
        }
        expect(layer.geometry.boundingBox?.isEmpty()).toBe(false);
        expect(layer.geometry.boundingSphere?.radius).toBeGreaterThan(0);
      }
    });
  }

  it("reuses one cached bundle per quality tier", () => {
    const first = surfaceBackdropGeometry("high");
    const second = surfaceBackdropGeometry("high");
    expect(second).toBe(first);
    expect(second.layers[0].geometry).toBe(first.layers[0].geometry);
  });

  it("stays within backdrop triangle budgets", () => {
    expect(surfaceBackdropGeometry("low").triangleCount).toBe(568);
    expect(surfaceBackdropGeometry("high").triangleCount).toBe(1_080);
  });

  it("overscans the viewport while keeping the landmark composition focused", () => {
    const layers = surfaceBackdropGeometry("high").layers;
    const boundsFor = (role: (typeof SURFACE_BACKDROP_ROLES)[number]) =>
      layers.find((layer) => layer.role === role)?.geometry.boundingBox;
    for (const role of ["sky", "farTerrain", "nearBerm"] as const) {
      const bounds = boundsFor(role);
      expect(
        (bounds?.max.x ?? 0) - (bounds?.min.x ?? 0),
      ).toBeGreaterThanOrEqual(90);
    }
    const industry = boundsFor("industry");
    expect(
      (industry?.max.x ?? 0) - (industry?.min.x ?? 0),
    ).toBeGreaterThanOrEqual(35);
    const celestial = boundsFor("celestial");
    expect(
      (celestial?.max.x ?? 0) - (celestial?.min.x ?? 0),
    ).toBeGreaterThanOrEqual(10);
  });

  it("moves depth layers at restrained ordered parallax ratios", () => {
    const cameraX = 100;
    const relative = SURFACE_BACKDROP_ROLES.map((role) =>
      Math.abs(
        surfaceBackdropLayerX(cameraX, SURFACE_BACKDROP_PARALLAX[role], false) -
          cameraX,
      ),
    );
    expect(relative).toEqual([0, 1, 4, 8, 12]);
  });

  it("locks every backdrop layer to the viewport for reduced motion", () => {
    for (const role of SURFACE_BACKDROP_ROLES) {
      expect(
        surfaceBackdropLayerX(-73, SURFACE_BACKDROP_PARALLAX[role], true),
      ).toBe(-73);
    }
  });

  it("grades the planet and landscape across day and night without new materials", () => {
    const celestial = surfaceBackdropMaterial("celestial");
    const far = surfaceBackdropMaterial("farTerrain");
    applySurfaceBackdropGrade(daylightGradeFor(13));
    const dayPlanet = celestial.color.getHex();
    const dayTerrain = far.color.getHex();
    const dayOpacity = celestial.opacity;
    applySurfaceBackdropGrade(daylightGradeFor(0));
    expect(celestial).toBe(surfaceBackdropMaterial("celestial"));
    expect(far).toBe(surfaceBackdropMaterial("farTerrain"));
    expect(celestial.color.getHex()).not.toBe(dayPlanet);
    expect(far.color.getHex()).not.toBe(dayTerrain);
    expect(celestial.opacity).toBeGreaterThan(dayOpacity);
  });
});
