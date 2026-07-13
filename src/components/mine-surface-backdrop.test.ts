import { afterAll, describe, expect, it } from "vitest";
import {
  clearSurfaceBackdropCacheForTests,
  SURFACE_BACKDROP_ROLES,
  SURFACE_BACKDROP_SCROLL_SCALE,
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
    for (const role of ["sky", "farTerrain"] as const) {
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
    const nearBerm = boundsFor("nearBerm");
    expect(
      (nearBerm?.max.x ?? 0) - (nearBerm?.min.x ?? 0),
    ).toBeGreaterThanOrEqual(160);
  });

  it("uses a monotonic linear depth stack with a fixed celestial plane", () => {
    expect(
      SURFACE_BACKDROP_ROLES.map((role) => SURFACE_BACKDROP_SCROLL_SCALE[role]),
    ).toEqual([0, 0, 0.08, 0.18, 0.32]);
    const cameraX = 10;
    const screenTravel = SURFACE_BACKDROP_ROLES.map(
      (role) =>
        surfaceBackdropLayerX(
          cameraX,
          SURFACE_BACKDROP_SCROLL_SCALE[role],
          false,
        ) - cameraX,
    );
    expect(screenTravel[0]).toBe(0);
    expect(screenTravel[1]).toBe(0);
    expect(screenTravel[2]).toBeCloseTo(-0.8);
    expect(screenTravel[3]).toBeCloseTo(-1.8);
    expect(screenTravel[4]).toBeCloseTo(-3.2);
  });

  it("never moves the planet before, during, or after a damped camera step", () => {
    for (const cameraX of [16, 16.08, 16.3, 16.62, 16.86, 17, 17]) {
      const planetX = surfaceBackdropLayerX(
        cameraX,
        SURFACE_BACKDROP_SCROLL_SCALE.celestial,
        false,
      );
      expect(planetX - cameraX).toBe(0);
      const skyX = surfaceBackdropLayerX(
        cameraX,
        SURFACE_BACKDROP_SCROLL_SCALE.sky,
        false,
      );
      expect(skyX - cameraX).toBe(0);
    }
  });

  it("uses the same linear response at the village and distant biomes", () => {
    for (const role of ["farTerrain", "industry", "nearBerm"] as const) {
      const scale = SURFACE_BACKDROP_SCROLL_SCALE[role];
      for (const cameraX of [-150, -10, 10, 150]) {
        const screenTravel =
          surfaceBackdropLayerX(cameraX, scale, false) - cameraX;
        expect(screenTravel).toBeCloseTo(-cameraX * scale);
      }
    }
  });

  it("locks every backdrop layer to the viewport for reduced motion", () => {
    for (const role of SURFACE_BACKDROP_ROLES) {
      expect(
        surfaceBackdropLayerX(-73, SURFACE_BACKDROP_SCROLL_SCALE[role], true),
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
