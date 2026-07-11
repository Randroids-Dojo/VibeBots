import { describe, expect, it } from "vitest";
import {
  MINE_VISIBILITY_VEIL,
  updateMineVisibilityVeil,
} from "./mine-visibility-material";

describe("mine visibility veil", () => {
  it("is one transparent foreground material with no depth seams", () => {
    expect(MINE_VISIBILITY_VEIL.transparent).toBe(true);
    expect(MINE_VISIBILITY_VEIL.depthTest).toBe(false);
    expect(MINE_VISIBILITY_VEIL.depthWrite).toBe(false);
    expect(MINE_VISIBILITY_VEIL.opacityNode).toBeTruthy();
  });

  it("updates its uniforms in place", () => {
    const opacityNode = MINE_VISIBILITY_VEIL.opacityNode;
    updateMineVisibilityVeil(4, -3, 5, 0.6);
    expect(MINE_VISIBILITY_VEIL.opacityNode).toBe(opacityNode);
  });
});
