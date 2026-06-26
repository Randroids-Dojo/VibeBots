import { describe, expect, it } from "vitest";
import type { DroppedBag } from "./cells";
import { BAG_STACK_LIMIT } from "./consumables";
import {
  carriedStackCount,
  dropBagAt,
  dropOreToSurface,
  fillHold,
  pickupAtMiner,
} from "./inventory";
import { cellAt, createMine, setCell } from "./world";

describe("mine inventory helpers", () => {
  it("fills the hold by ore stack slots and returns overflow", () => {
    const state = createMine(42);

    expect(fillHold(state, { coal: 30 })).toEqual({
      taken: 4 * BAG_STACK_LIMIT,
      dropped: 10,
      leftover: { coal: 10 },
    });
    expect(state.miner.carried.coal).toBe(20);
    expect(carriedStackCount(state.miner)).toBe(4);
  });

  it("counts partial stacks independently by ore type", () => {
    const state = createMine(42);
    state.miner.carried = { coal: 6, copper: 1 };

    expect(carriedStackCount(state.miner)).toBe(3);
  });

  it("merges dropped bags at the same cell", () => {
    const state = createMine(42);
    const first: DroppedBag = {
      ores: { coal: 1 },
      salvageCredits: 2,
      parts: ["left-arm"],
    };
    const second: DroppedBag = {
      ores: { copper: 3 },
      salvageCredits: 5,
      parts: ["right-arm"],
    };

    dropBagAt(state, { col: 0, row: 1 }, first);
    dropBagAt(state, { col: 0, row: 1 }, second);

    expect(cellAt(state, 0, 1)?.bag).toEqual({
      ores: { coal: 1, copper: 3 },
      salvageCredits: 7,
      parts: ["left-arm", "right-arm"],
    });
  });

  it("drops ore through empty space until the landing cell is supported", () => {
    const state = createMine(42);
    setCell(state, 0, 1, { kind: "empty" });
    setCell(state, 0, 2, { kind: "empty" });
    setCell(state, 0, 3, { kind: "dirt" });

    expect(dropOreToSurface(state, 0, 1, { coal: 2 })).toBe(2);

    expect(cellAt(state, 0, 1)?.drop).toBeUndefined();
    expect(cellAt(state, 0, 2)?.drop).toEqual({ coal: 2 });
  });

  it("picks immediate floor drops before deferred manual drops", () => {
    const state = createMine(42);
    state.miner.row = 1;
    state.miner.carried.coal = 18;
    setCell(state, 0, 1, {
      kind: "empty",
      drop: { coal: 4, copper: 3 },
      dropDeferred: { coal: 4 },
    });

    expect(pickupAtMiner(state)).toEqual({
      pickedUp: 2,
      pickedUpBag: undefined,
    });

    expect(state.miner.carried).toEqual({ coal: 20 });
    expect(cellAt(state, 0, 1)?.drop).toEqual({ coal: 2, copper: 3 });
    expect(cellAt(state, 0, 1)?.dropDeferred).toEqual({ coal: 2 });
  });

  it("recovers dropped bag value, parts, and lost-cargo markers on pickup", () => {
    const state = createMine(42);
    state.miner.row = 1;
    state.miner.lostCargo = { col: 0, row: 1, value: 11, parts: ["drill"] };
    setCell(state, 0, 1, {
      kind: "empty",
      bag: { ores: { coal: 2 }, salvageCredits: 7, parts: ["drill"] },
    });

    expect(pickupAtMiner(state)).toEqual({
      pickedUp: 2,
      pickedUpBag: { value: 9, parts: 1 },
    });
    expect(state.miner.carried).toEqual({ coal: 2 });
    expect(state.miner.carriedSalvageCredits).toBe(7);
    expect(state.miner.carriedParts).toEqual(["drill"]);
    expect(state.miner.lostCargo).toBeUndefined();
    expect(cellAt(state, 0, 1)?.bag).toBeUndefined();
  });
});
