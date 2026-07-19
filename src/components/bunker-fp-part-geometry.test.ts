import { afterAll, describe, expect, it } from "vitest";
import { BASE_PART_IDS } from "@/sim/bunker";
import {
  bunkerPartFpGeometry,
  clearBunkerFpPartGeometryCacheForTests,
} from "./bunker-fp-part-geometry";
import {
  bunkerPartGeometry,
  clearBunkerPartGeometryCacheForTests,
} from "./mine-bunker-part-geometry";

afterAll(() => {
  clearBunkerFpPartGeometryCacheForTests();
  clearBunkerPartGeometryCacheForTests();
});

const FULL_CELL_IDS = [
  "wall-panel",
  "floor-panel",
  "roof-panel",
  "door-panel",
] as const;

/** Thin sub-cell variants and the axis each is thin on (F-117). */
const THIN_SPECS = [
  { id: "wall-panel", thinAxis: "z" },
  { id: "door-panel", thinAxis: "z" },
  { id: "floor-panel", thinAxis: "y" },
  { id: "roof-panel", thinAxis: "y" },
] as const;

/** Sealing edges must reach the cell boundary so neighbors tile. */
const EDGE = 0.5 - 0.001;
/** Nothing may poke past its own cell (plus float slack). */
const LIMIT = 0.5 + 0.001;

describe("bunker fp part geometry", () => {
  for (const tier of ["low", "high"] as const) {
    it(`${tier} tier keeps every fp part under the triangle cap`, () => {
      const cap = tier === "low" ? 1200 : 2400;
      for (const id of BASE_PART_IDS) {
        const model = bunkerPartFpGeometry(id, tier);
        expect(model.triangleCount, `${tier}:${id}`).toBeLessThanOrEqual(cap);
        expect(model.triangleCount, `${tier}:${id}`).toBeGreaterThan(0);
      }
    });

    it(`${tier} tier full-cell parts stay inside +-0.5 on every axis`, () => {
      for (const id of FULL_CELL_IDS) {
        const { bounds } = bunkerPartFpGeometry(id, tier);
        expect(bounds.min.x, `${id}:min.x`).toBeGreaterThanOrEqual(-LIMIT);
        expect(bounds.max.x, `${id}:max.x`).toBeLessThanOrEqual(LIMIT);
        expect(bounds.min.y, `${id}:min.y`).toBeGreaterThanOrEqual(-LIMIT);
        expect(bounds.max.y, `${id}:max.y`).toBeLessThanOrEqual(LIMIT);
        expect(bounds.min.z, `${id}:min.z`).toBeGreaterThanOrEqual(-LIMIT);
        expect(bounds.max.z, `${id}:max.z`).toBeLessThanOrEqual(LIMIT);
      }
    });

    it(`${tier} tier full-cell parts seal their cell on every axis`, () => {
      for (const id of FULL_CELL_IDS) {
        const { bounds } = bunkerPartFpGeometry(id, tier);
        expect(bounds.min.x, `${id}:x`).toBeLessThanOrEqual(-EDGE);
        expect(bounds.max.x, `${id}:x`).toBeGreaterThanOrEqual(EDGE);
        expect(bounds.min.y, `${id}:y`).toBeLessThanOrEqual(-EDGE);
        expect(bounds.max.y, `${id}:y`).toBeGreaterThanOrEqual(EDGE);
        expect(bounds.min.z, `${id}:z`).toBeLessThanOrEqual(-EDGE);
        expect(bounds.max.z, `${id}:z`).toBeGreaterThanOrEqual(EDGE);
      }
    });

    it(`${tier} tier caches one model per part`, () => {
      for (const id of BASE_PART_IDS) {
        expect(bunkerPartFpGeometry(id, tier)).toBe(
          bunkerPartFpGeometry(id, tier),
        );
      }
    });

    it(`${tier} tier reuses the 2D cache objects for spikes and turret`, () => {
      for (const id of ["floor-spikes", "basic-turret"] as const) {
        expect(bunkerPartFpGeometry(id, tier)).toBe(
          bunkerPartGeometry(id, tier),
        );
      }
    });

    it(`${tier} tier merges the door leaf into one dedicated layer`, () => {
      const door = bunkerPartFpGeometry("door-panel", tier);
      const accentLayers = door.layers.filter(
        (layer) => layer.role === "accent",
      );
      expect(accentLayers).toHaveLength(1);
    });

    it(`${tier} tier builds finite geometry for the full-cell parts`, () => {
      for (const id of FULL_CELL_IDS) {
        const model = bunkerPartFpGeometry(id, tier);
        expect(model.layers.length).toBeGreaterThan(0);
        expect(model.motionLayers).toHaveLength(0);
        for (const layer of model.layers) {
          const positions = layer.geometry.getAttribute("position");
          expect(positions.count).toBeGreaterThan(0);
          for (let i = 0; i < positions.count; i++) {
            expect(Number.isFinite(positions.getX(i))).toBe(true);
            expect(Number.isFinite(positions.getY(i))).toBe(true);
            expect(Number.isFinite(positions.getZ(i))).toBe(true);
          }
        }
      }
    });

    // Thin sub-cell panels (F-117): a slab on one face/plane, built centered
    // in a canonical axis (wall/door thin in z, floor/roof thin in y).
    it(`${tier} tier thin panels are a slab within +-0.5, thin on one axis`, () => {
      for (const { id, thinAxis } of THIN_SPECS) {
        const { bounds } = bunkerPartFpGeometry(id, tier, true);
        for (const axis of ["x", "y", "z"] as const) {
          expect(bounds.min[axis], `${id}:min.${axis}`).toBeGreaterThanOrEqual(
            -LIMIT,
          );
          expect(bounds.max[axis], `${id}:max.${axis}`).toBeLessThanOrEqual(
            LIMIT,
          );
        }
        const extent = {
          x: bounds.max.x - bounds.min.x,
          y: bounds.max.y - bounds.min.y,
          z: bounds.max.z - bounds.min.z,
        };
        // Thin on its own axis, spanning the cell on the other two.
        expect(extent[thinAxis], `${id}:thin`).toBeLessThan(0.3);
        for (const axis of ["x", "y", "z"] as const) {
          if (axis === thinAxis) continue;
          expect(extent[axis], `${id}:span.${axis}`).toBeGreaterThan(0.8);
        }
      }
    });

    it(`${tier} tier thin panels stay under the triangle cap and are finite`, () => {
      const cap = tier === "low" ? 1200 : 2400;
      for (const { id } of THIN_SPECS) {
        const model = bunkerPartFpGeometry(id, tier, true);
        expect(model.triangleCount, `${tier}:${id}`).toBeGreaterThan(0);
        expect(model.triangleCount, `${tier}:${id}`).toBeLessThanOrEqual(cap);
        expect(model.motionLayers).toHaveLength(0);
        for (const layer of model.layers) {
          const positions = layer.geometry.getAttribute("position");
          for (let i = 0; i < positions.count; i++) {
            expect(Number.isFinite(positions.getX(i))).toBe(true);
            expect(Number.isFinite(positions.getY(i))).toBe(true);
            expect(Number.isFinite(positions.getZ(i))).toBe(true);
          }
        }
      }
    });

    it(`${tier} tier caches the thin variant apart from the full-cell one`, () => {
      for (const { id } of THIN_SPECS) {
        const thin = bunkerPartFpGeometry(id, tier, true);
        expect(thin).toBe(bunkerPartFpGeometry(id, tier, true));
        expect(thin).not.toBe(bunkerPartFpGeometry(id, tier, false));
      }
    });
  }
});
