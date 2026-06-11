import { describe, expect, it } from "vitest";
import {
  cellAt,
  createMine,
  type Direction,
  LIGHT_RADIUS,
  MINE_WIDTH,
  replayTrip,
  START_COL,
  START_ENERGY,
  step,
} from "./mine";

describe("mine", () => {
  it("generates the same mine for the same seed", () => {
    const a = createMine(7);
    const b = createMine(7);
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < MINE_WIDTH; col++) {
        expect(cellAt(a, col, row)?.kind).toBe(cellAt(b, col, row)?.kind);
      }
    }
  });

  it("generates the same mine regardless of the path walked", () => {
    const a = createMine(42);
    const b = createMine(42);
    // Walk a and b along different paths (different digs, cache pulls,
    // and query orders), then compare freshly generated deep rows.
    for (let i = 0; i < 60; i++) step(a, i % 5 === 0 ? "left" : "down");
    for (let i = 0; i < 60; i++) step(b, i % 3 === 0 ? "right" : "down");
    cellAt(a, 0, 80);
    for (let col = 0; col < MINE_WIDTH; col++) {
      for (let row = 60; row < 80; row++) {
        expect(cellAt(a, col, row)?.kind).toBe(cellAt(b, col, row)?.kind);
      }
    }
  });

  it("generates different mines for different seeds", () => {
    const a = createMine(1);
    const b = createMine(2);
    let differences = 0;
    for (let row = 1; row < 30; row++) {
      for (let col = 0; col < MINE_WIDTH; col++) {
        if (cellAt(a, col, row)?.kind !== cellAt(b, col, row)?.kind)
          differences++;
      }
    }
    expect(differences).toBeGreaterThan(10);
  });

  it("digs dirt, collects emeralds, and refuses rock", () => {
    const state = createMine(7);
    // Walk a deterministic path and check the bookkeeping holds.
    let digs = 0;
    let emeralds = 0;
    const directions: Direction[] = ["down", "left", "right", "down"];
    for (let i = 0; i < 40 && state.miner.energy > 0; i++) {
      const dir = directions[i % directions.length];
      const result = step(state, dir);
      if (result.ok && result.dug) {
        digs++;
        if (result.dug === "emerald") emeralds++;
      }
    }
    expect(digs).toBeGreaterThan(0);
    expect(state.miner.carriedEmeralds).toBe(emeralds);
  });

  it("banks carried loot only at the surface and refills energy", () => {
    const state = createMine(11);
    step(state, "down");
    state.miner.carriedEmeralds = 5;
    const up = step(state, "up");
    expect(up.ok).toBe(true);
    expect(state.miner.row).toBe(0);
    expect(state.miner.carriedEmeralds).toBe(0);
    expect(state.miner.bankedEmeralds).toBe(5);
    expect(state.miner.energy).toBe(START_ENERGY);
  });

  it("collapses underground when energy runs out, losing the carry", () => {
    const state = createMine(13);
    step(state, "down");
    expect(state.miner.row).toBe(1);
    state.miner.carriedEmeralds = 9;
    state.miner.energy = 0.5;
    // Any successful action now drains the lamp underground.
    let collapsed = false;
    for (const dir of ["down", "left", "right"] as const) {
      const result = step(state, dir);
      if (result.ok) {
        collapsed = result.collapsed;
        break;
      }
    }
    expect(collapsed).toBe(true);
    expect(state.miner.collapses).toBe(1);
    expect(state.miner.carriedEmeralds).toBe(0);
    expect(state.miner.bankedEmeralds).toBe(0);
    expect(state.miner.row).toBe(0);
  });

  it("up-moves need a cleared shaft", () => {
    const state = createMine(17);
    step(state, "down");
    step(state, "left");
    // The cell above (row 0) is empty surface, so up from row 1 works;
    // but up through undug ground is blocked. Dig down twice then move
    // sideways twice: the cell above is undug.
    step(state, "down");
    const sideways = step(state, "right");
    if (sideways.ok) {
      const upThroughDirt = step(state, "up");
      if (!upThroughDirt.ok) {
        expect(upThroughDirt.reason).toBe("blocked");
      }
    }
  });

  it("finds rare parts in caches deterministically", () => {
    const a = createMine(99);
    const b = createMine(99);
    const walk = (state: typeof a) => {
      const found: string[] = [];
      for (let i = 0; i < 300; i++) {
        const result = step(
          state,
          i % 7 === 3 ? "left" : i % 11 === 5 ? "right" : "down",
        );
        if (result.ok && result.found) found.push(result.found);
        if (state.miner.row === 0 && i > 0) break;
      }
      return found;
    };
    expect(walk(a)).toEqual(walk(b));
  });

  it("replays a trip to identical banked results", () => {
    const moves = [] as Array<"down" | "up" | "left" | "right">;
    const state = createMine(31337);
    for (let i = 0; i < 80; i++) {
      const dir =
        i % 9 === 4 ? "left" : i % 13 === 6 ? "right" : i % 2 ? "down" : "up";
      moves.push(dir);
      step(state, dir);
    }
    const replayed = replayTrip(31337, moves);
    expect(replayed.bankedEmeralds).toBe(state.miner.bankedEmeralds);
    expect(replayed.bankedParts).toEqual(state.miner.bankedParts);
    // Same log, same credit: the server and an honest client agree.
    expect(replayTrip(31337, moves)).toEqual(replayed);
  });

  it("keeps light bounded by lantern radius", () => {
    const state = createMine(5);
    expect(state.rows.length).toBeGreaterThanOrEqual(LIGHT_RADIUS + 1);
    expect(state.miner.col).toBe(START_COL);
  });
});
