import { describe, expect, it } from "vitest";
import {
  cellJointMaterial,
  dirtBlockMaterial,
  metalBlockMaterial,
} from "./mine-block-materials";

describe("mine block seam lighting", () => {
  it("keeps naturally lit dirt and metal materials cached", () => {
    expect(dirtBlockMaterial("#6f4937", false)).toBe(
      dirtBlockMaterial("#6f4937", false),
    );
    expect(metalBlockMaterial("#6d7785", false)).toBe(
      metalBlockMaterial("#6d7785", false),
    );
  });

  it("keeps the soil-colored joint material cached separately", () => {
    expect(cellJointMaterial("#6f4937")).toBe(cellJointMaterial("#6f4937"));
    expect(cellJointMaterial("#6f4937")).not.toBe(
      dirtBlockMaterial("#6f4937", false),
    );
  });
});
