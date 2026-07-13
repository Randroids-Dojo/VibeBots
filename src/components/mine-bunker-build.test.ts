import { describe, expect, it } from "vitest";
import {
  bunkerBuildDirectionFromVector,
  bunkerBuildTarget,
  bunkerConstructionProgress,
} from "./mine-bunker-build";

describe("directional bunker construction", () => {
  it("maps a pointer vector into all eight build directions", () => {
    expect(bunkerBuildDirectionFromVector(1, 0)).toBe("right");
    expect(bunkerBuildDirectionFromVector(1, 1)).toBe("down-right");
    expect(bunkerBuildDirectionFromVector(0, 1)).toBe("down");
    expect(bunkerBuildDirectionFromVector(-1, 1)).toBe("down-left");
    expect(bunkerBuildDirectionFromVector(-1, 0)).toBe("left");
    expect(bunkerBuildDirectionFromVector(-1, -1)).toBe("up-left");
    expect(bunkerBuildDirectionFromVector(0, -1)).toBe("up");
    expect(bunkerBuildDirectionFromVector(1, -1)).toBe("up-right");
  });

  it("targets any surrounding cell and stays inside the claim", () => {
    const footprint = { col: 10, row: 2, width: 4, height: 4 };
    expect(
      bunkerBuildTarget({ col: 11, row: 4 }, "up-left", footprint),
    ).toEqual({ col: 10, row: 3 });
    expect(
      bunkerBuildTarget({ col: 10, row: 2 }, "up-left", footprint),
    ).toBeNull();
  });

  it("exposes four reverse-damage stages", () => {
    expect([1, 2, 3, 4].map(bunkerConstructionProgress)).toEqual([
      0.25, 0.5, 0.75, 1,
    ]);
  });
});
