import { afterAll, describe, expect, it } from "vitest";
import { BASE_PART_IDS } from "@/sim/bunker";
import {
  BUNKER_CELL_HALF,
  BUNKER_PART_MAX_DEPTH,
  bunkerPartGeometry,
  clearBunkerPartGeometryCacheForTests,
} from "./mine-bunker-part-geometry";

afterAll(() => clearBunkerPartGeometryCacheForTests());

/**
 * The parts that seal a room must fill their cell exactly on shared
 * edges, or adjacent cells show gaps (the pre-0.1.210 look: a
 * 0.24-wide wall floating in a 1.0 cell).
 */
const EDGE = BUNKER_CELL_HALF - 0.001;

describe("bunker part geometry", () => {
  for (const tier of ["low", "high"] as const) {
    it(`${tier} tier builds finite cached layers for every part`, () => {
      for (const id of BASE_PART_IDS) {
        const model = bunkerPartGeometry(id, tier);
        expect(model.layers.length).toBeGreaterThan(0);
        for (const layer of [...model.layers, ...model.motionLayers]) {
          const positions = layer.geometry.getAttribute("position");
          expect(positions.count).toBeGreaterThan(0);
          for (let i = 0; i < positions.count; i++) {
            expect(Number.isFinite(positions.getX(i))).toBe(true);
            expect(Number.isFinite(positions.getY(i))).toBe(true);
            expect(Number.isFinite(positions.getZ(i))).toBe(true);
          }
        }
        expect(bunkerPartGeometry(id, tier)).toBe(model);
      }
    });

    it(`${tier} tier keeps parts inside their cell and depth budget`, () => {
      for (const id of BASE_PART_IDS) {
        const { bounds } = bunkerPartGeometry(id, tier);
        expect(bounds.min.x, `${id}:min.x`).toBeGreaterThanOrEqual(-0.501);
        expect(bounds.max.x, `${id}:max.x`).toBeLessThanOrEqual(0.501);
        expect(bounds.min.y, `${id}:min.y`).toBeGreaterThanOrEqual(-0.501);
        expect(bounds.max.y, `${id}:max.y`).toBeLessThanOrEqual(0.501);
        expect(bounds.min.z, `${id}:min.z`).toBeGreaterThanOrEqual(
          -BUNKER_PART_MAX_DEPTH,
        );
        expect(bounds.max.z, `${id}:max.z`).toBeLessThanOrEqual(
          BUNKER_PART_MAX_DEPTH,
        );
      }
    });

    it(`${tier} tier sealing parts tile seamlessly across cells`, () => {
      // Walls and doors fill the whole cell in both axes; floor plates
      // and roof caps fill the width and seat against the cell floor
      // and ceiling respectively.
      for (const id of ["wall-panel", "door-panel"] as const) {
        const { bounds } = bunkerPartGeometry(id, tier);
        expect(bounds.min.x, `${id}:x`).toBeLessThanOrEqual(-EDGE);
        expect(bounds.max.x, `${id}:x`).toBeGreaterThanOrEqual(EDGE);
        expect(bounds.min.y, `${id}:y`).toBeLessThanOrEqual(-EDGE);
        expect(bounds.max.y, `${id}:y`).toBeGreaterThanOrEqual(EDGE);
      }
      for (const id of ["floor-panel", "roof-panel", "floor-spikes"] as const) {
        const { bounds } = bunkerPartGeometry(id, tier);
        expect(bounds.min.x, `${id}:x`).toBeLessThanOrEqual(-EDGE);
        expect(bounds.max.x, `${id}:x`).toBeGreaterThanOrEqual(EDGE);
      }
      expect(
        bunkerPartGeometry("floor-panel", tier).bounds.min.y,
      ).toBeLessThanOrEqual(-EDGE);
      expect(
        bunkerPartGeometry("roof-panel", tier).bounds.max.y,
      ).toBeGreaterThanOrEqual(EDGE);
      expect(
        bunkerPartGeometry("floor-spikes", tier).bounds.min.y,
      ).toBeLessThanOrEqual(-EDGE);
    });

    it(`${tier} tier stays under the per-part triangle budget`, () => {
      for (const id of BASE_PART_IDS) {
        const model = bunkerPartGeometry(id, tier);
        expect(model.triangleCount, `${tier}:${id}`).toBeLessThanOrEqual(
          tier === "low" ? 700 : 1600,
        );
      }
    });
  }

  it("scaling parts carry their moving pieces in motion layers", () => {
    for (const id of ["floor-spikes", "basic-turret"] as const) {
      expect(bunkerPartGeometry(id, "low").motionLayers.length).toBeGreaterThan(
        0,
      );
    }
    for (const id of [
      "wall-panel",
      "floor-panel",
      "roof-panel",
      "door-panel",
    ] as const) {
      expect(bunkerPartGeometry(id, "low").motionLayers).toHaveLength(0);
    }
  });
});
