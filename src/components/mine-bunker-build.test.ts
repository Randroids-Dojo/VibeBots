import { describe, expect, it } from "vitest";
import { createBunker } from "@/sim/bunker";
import { createMine, DEFAULT_GEAR, NO_CONSUMABLES, setCell } from "@/sim/mine";
import {
  advanceBunkerBuildCursor,
  bunkerBuildDirectionFromVector,
  bunkerBuildPath,
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

  it("moves the build cursor diagonally and keeps it inside the claim", () => {
    const footprint = { col: 10, row: 2, width: 4, height: 4 };
    expect(
      advanceBunkerBuildCursor(null, { col: 11, row: 4 }, "up-left", footprint),
    ).toEqual({ col: 10, row: 3 });
    expect(
      advanceBunkerBuildCursor(
        { col: 10, row: 2 },
        { col: 11, row: 4 },
        "up-left",
        footprint,
      ),
    ).toEqual({ col: 10, row: 2 });
  });

  it("finds a scaffold path to a cardinal work cell beside a remote target", () => {
    const mine = createMine(44, DEFAULT_GEAR, NO_CONSUMABLES);
    const bunker = createBunker({ col: -3, row: 1, width: 7, height: 5 });
    for (let row = bunker.footprint.row; row < 5; row += 1) {
      for (
        let col = bunker.footprint.col;
        col < bunker.footprint.col + bunker.footprint.width;
        col += 1
      ) {
        setCell(mine, col, row, { kind: "empty" });
      }
    }
    mine.miner.col = 0;
    mine.miner.row = 4;

    const path = bunkerBuildPath(mine, bunker, { col: -2, row: 1 });
    expect(path).not.toBeNull();
    expect(path?.length).toBeGreaterThan(0);
  });

  it("rejects occupied targets and exposes four reverse-damage stages", () => {
    const mine = createMine(44, DEFAULT_GEAR, NO_CONSUMABLES);
    const bunker = createBunker({ col: -3, row: 1, width: 7, height: 5 });
    const target = { col: bunker.core.col, row: bunker.core.row };
    expect(bunkerBuildPath(mine, bunker, target)).toBeNull();
    expect([1, 2, 3, 4].map(bunkerConstructionProgress)).toEqual([
      0.25, 0.5, 0.75, 1,
    ]);
  });
});
