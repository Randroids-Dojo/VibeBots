import { describe, expect, it } from "vitest";
import {
  carryoverConsumables,
  returnLadderNeed,
  settleUnsupportedDrops,
  settleUnsupportedLadders,
} from "./supports";
import { cellAt, createMine, setCell } from "./world";

describe("mine support helpers", () => {
  it("settles unsupported ore and bags into supported landing cells", () => {
    const state = createMine(42);
    state.miner.lostCargo = { col: 0, row: 1, value: 7, parts: ["claw"] };
    setCell(state, 0, 1, {
      kind: "empty",
      drop: { coal: 2 },
      bag: { ores: { copper: 1 }, salvageCredits: 5, parts: ["claw"] },
    });
    setCell(state, 0, 2, { kind: "empty" });
    setCell(state, 0, 3, { kind: "dirt" });

    settleUnsupportedDrops(state);

    expect(cellAt(state, 0, 1)?.drop).toBeUndefined();
    expect(cellAt(state, 0, 1)?.bag).toBeUndefined();
    expect(cellAt(state, 0, 2)?.drop).toEqual({ coal: 2 });
    expect(cellAt(state, 0, 2)?.bag).toEqual({
      ores: { copper: 1 },
      salvageCredits: 5,
      parts: ["claw"],
    });
    expect(state.miner.lostCargo).toEqual({
      col: 0,
      row: 2,
      value: 7,
      parts: ["claw"],
    });
  });

  it("settles ladders above removed support from bottom to top", () => {
    const state = createMine(42);
    setCell(state, 0, 1, { kind: "empty", ladder: true });
    setCell(state, 0, 2, { kind: "empty", ladder: true });
    setCell(state, 0, 3, { kind: "empty" });
    setCell(state, 0, 4, { kind: "dirt" });

    expect(settleUnsupportedLadders(state, [{ col: 0, row: 3 }])).toEqual([
      { from: { col: 0, row: 2 }, to: { col: 0, row: 3 } },
      { from: { col: 0, row: 1 }, to: { col: 0, row: 2 } },
    ]);
    expect(cellAt(state, 0, 1)?.ladder).toBeUndefined();
    expect(cellAt(state, 0, 2)?.ladder).toBe(true);
    expect(cellAt(state, 0, 3)?.ladder).toBe(true);
  });

  it("counts missing ladders on the current return shaft", () => {
    const state = createMine(42);
    state.miner.row = 3;
    setCell(state, 0, 1, { kind: "empty", ladder: true });
    setCell(state, 0, 2, { kind: "empty" });
    setCell(state, 0, 3, { kind: "empty" });

    expect(returnLadderNeed(state)).toBe(2);
  });

  it("strips unspent free recovery supports from carryover stock", () => {
    const state = createMine(42);
    state.consumables = {
      dynamite: 1,
      rope: 2,
      ladder: 10,
      plank: 6,
      beacon: 3,
    };
    state.granted = { dynamite: 0, rope: 0, ladder: 8, plank: 4, beacon: 0 };
    state.used = { dynamite: 0, rope: 0, ladder: 3, plank: 2, beacon: 0 };

    expect(carryoverConsumables(state)).toEqual({
      dynamite: 1,
      rope: 2,
      ladder: 5,
      plank: 4,
      beacon: 3,
    });
  });
});
