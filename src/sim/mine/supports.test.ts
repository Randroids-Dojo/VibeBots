import { describe, expect, it } from "vitest";
import { DEFAULT_GEAR, ELEVATOR_COL } from "./gear";
import {
  carryoverConsumables,
  RETURN_HOME_VISIT_CAP,
  returnHomeEstimate,
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
    expect(returnHomeEstimate(state)).toMatchObject({
      reachable: true,
      laddersNeeded: 2,
      steps: 3,
      energyCost: 1.5,
      capped: false,
    });
  });

  it("uses a nearby complete ladder shaft for the return estimate", () => {
    const state = createMine(43);
    state.miner.col = 1;
    state.miner.row = 3;
    setCell(state, 1, 3, { kind: "empty" });
    setCell(state, 1, 4, { kind: "dirt" });
    for (let row = 1; row <= 3; row++) {
      setCell(state, 0, row, { kind: "empty", ladder: true });
    }
    setCell(state, 0, 4, { kind: "dirt" });

    expect(returnHomeEstimate(state)).toMatchObject({
      reachable: true,
      laddersNeeded: 0,
      steps: 4,
      capped: false,
    });
    expect(returnLadderNeed(state)).toBe(0);
  });

  it("chooses fewer ladders before fewer steps", () => {
    const state = createMine(44);
    state.miner.col = 0;
    state.miner.row = 3;
    setCell(state, 0, 1, { kind: "empty" });
    setCell(state, 0, 2, { kind: "empty" });
    setCell(state, 0, 3, { kind: "empty" });
    setCell(state, 0, 4, { kind: "dirt" });
    for (let row = 1; row <= 3; row++) {
      setCell(state, 1, row, { kind: "empty", ladder: true });
    }
    setCell(state, 1, 4, { kind: "dirt" });

    expect(returnHomeEstimate(state)).toMatchObject({
      reachable: true,
      laddersNeeded: 0,
      steps: 4,
    });
  });

  it("blocks new ladder placement while estimating an elevator rail climb", () => {
    const state = createMine(45, { ...DEFAULT_GEAR, elevator: 12 });
    state.miner.col = ELEVATOR_COL;
    state.miner.row = 1;
    setCell(state, ELEVATOR_COL, 1, { kind: "empty" });

    expect(returnHomeEstimate(state)).toMatchObject({
      reachable: false,
      capped: false,
    });

    setCell(state, ELEVATOR_COL, 1, { kind: "empty", ladder: true });

    expect(returnHomeEstimate(state)).toMatchObject({
      reachable: true,
      laddersNeeded: 0,
      steps: 1,
    });
  });

  it("reports blocked return routes without inventing a ladder count", () => {
    const state = createMine(46);
    state.miner.row = 2;
    setCell(state, 0, 2, { kind: "empty" });
    setCell(state, 0, 3, { kind: "dirt" });

    expect(returnHomeEstimate(state)).toMatchObject({
      reachable: false,
      laddersNeeded: 0,
      steps: 0,
      capped: false,
    });
  });

  it("caps wide sparse return searches", () => {
    const state = createMine(47);
    state.miner.col = 0;
    state.miner.row = 70;
    for (let row = 2; row <= 70; row++) {
      for (let col = 0; col <= 70; col++) {
        setCell(state, col, row, { kind: "empty", plank: true });
      }
    }

    const estimate = returnHomeEstimate(state);

    expect(estimate).toMatchObject({
      reachable: false,
      laddersNeeded: 0,
      steps: 0,
      visited: RETURN_HOME_VISIT_CAP,
      capped: true,
    });
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
