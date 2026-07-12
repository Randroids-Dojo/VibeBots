import { describe, expect, it } from "vitest";
import {
  blockEdgeOcclusion,
  dirtBlockMaterial,
  metalBlockMaterial,
} from "./mine-block-materials";

describe("mine block seam lighting", () => {
  it("builds a grazing-angle occlusion node for beveled sidewalls", () => {
    expect(blockEdgeOcclusion()).toBeTruthy();
  });

  it("keeps edge-occluded dirt and metal materials cached", () => {
    expect(dirtBlockMaterial("#6f4937", false)).toBe(
      dirtBlockMaterial("#6f4937", false),
    );
    expect(metalBlockMaterial("#6d7785", false)).toBe(
      metalBlockMaterial("#6d7785", false),
    );
  });
});
