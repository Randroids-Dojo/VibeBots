import { describe, expect, it } from "vitest";
import { MINE_BOTTOM_ROW } from "./consumables";
import { DEFAULT_GEAR } from "./gear";
import {
  cellAt,
  createMine,
  exportDiff,
  generatedCell,
  refundRailSupportsInDiff,
  setCell,
} from "./world";

describe("mine world module", () => {
  it("generates deterministic pristine cells from seed and coordinates", () => {
    const a = createMine(42);
    const b = createMine(42);

    for (let row = 0; row < 24; row++) {
      for (let col = -3; col <= 3; col++) {
        expect(cellAt(a, col, row)).toEqual(cellAt(b, col, row));
      }
    }
  });

  it("keeps the row 1000 hard floor outside the mutable diff", () => {
    const state = createMine(42, DEFAULT_GEAR);

    expect(generatedCell(42, 0, MINE_BOTTOM_ROW)).toEqual({ kind: "metal" });
    setCell(state, 0, MINE_BOTTOM_ROW, { kind: "empty" });
    expect(cellAt(state, 0, MINE_BOTTOM_ROW)).toEqual({ kind: "metal" });
    expect(exportDiff(state)).toEqual([]);
  });

  it("refunds traversal supports covered by new elevator rail", () => {
    const result = refundRailSupportsInDiff(
      [
        [-5, 1, { kind: "empty", ladder: true }],
        [-5, 2, { kind: "empty", plank: true }],
        [-5, 3, { kind: "empty", ladder: true }],
      ],
      0,
      2,
    );

    expect(result.refunded).toEqual({ ladder: 1, plank: 1 });
    expect(result.diff).toEqual([
      [-5, 1, { kind: "empty" }],
      [-5, 2, { kind: "empty" }],
      [-5, 3, { kind: "empty", ladder: true }],
    ]);
  });
});
