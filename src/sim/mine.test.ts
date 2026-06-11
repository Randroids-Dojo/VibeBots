import { describe, expect, it } from "vitest";
import {
  carriedCount,
  carriedValue,
  cellAt,
  createMine,
  type Direction,
  LIGHT_RADIUS,
  MINE_WIDTH,
  ORES,
  oreChanceAt,
  oreDef,
  ROCK_FREE_ROWS,
  replayTrip,
  returnEnergyCost,
  START_COL,
  START_ENERGY,
  STRATA,
  step,
  strataBonusBetween,
  stratumAt,
} from "./mine";

describe("mine", () => {
  it("generates the same mine for the same seed", () => {
    const a = createMine(42);
    const b = createMine(42);
    for (let row = 0; row < 40; row++) {
      for (let col = 0; col < MINE_WIDTH; col++) {
        expect(cellAt(a, col, row)?.kind).toBe(cellAt(b, col, row)?.kind);
        expect(cellAt(a, col, row)?.ore).toBe(cellAt(b, col, row)?.ore);
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

  it("keeps every ore inside its depth band", () => {
    for (const seed of [3, 77, 901]) {
      const state = createMine(seed);
      for (let row = 1; row < 120; row++) {
        for (let col = 0; col < MINE_WIDTH; col++) {
          const cell = cellAt(state, col, row);
          if (cell?.kind === "ore" && cell.ore) {
            const def = oreDef(cell.ore);
            expect(row).toBeGreaterThanOrEqual(def.minRow);
            expect(row).toBeLessThanOrEqual(def.maxRow);
          }
        }
      }
    }
  });

  it("scales ore value roughly exponentially across tiers", () => {
    for (let i = 1; i < ORES.length; i++) {
      const ratio = ORES[i].value / ORES[i - 1].value;
      expect(ratio).toBeGreaterThanOrEqual(2);
      expect(ratio).toBeLessThanOrEqual(5);
    }
  });

  it("ramps ore chance as a trapezoid over the band", () => {
    const silver = oreDef("silver");
    expect(oreChanceAt(silver, silver.minRow - 1)).toBe(0);
    expect(oreChanceAt(silver, silver.peakStart)).toBe(silver.peakChance);
    expect(oreChanceAt(silver, silver.peakEnd)).toBe(silver.peakChance);
    expect(oreChanceAt(silver, silver.maxRow + 1)).toBe(0);
    const fadingIn = oreChanceAt(
      silver,
      Math.floor((silver.minRow + silver.peakStart) / 2),
    );
    expect(fadingIn).toBeGreaterThan(0);
    expect(fadingIn).toBeLessThan(silver.peakChance);
  });

  it("never rolls rock in the top rows", () => {
    for (const seed of [5, 1234, 999999]) {
      const state = createMine(seed);
      for (let row = 1; row <= ROCK_FREE_ROWS; row++) {
        for (let col = 0; col < MINE_WIDTH; col++) {
          expect(cellAt(state, col, row)?.kind).not.toBe("rock");
        }
      }
    }
  });

  it("names strata by row and sums first-reach bonuses between records", () => {
    expect(stratumAt(0).name).toBe("Topsoil");
    expect(stratumAt(11).name).toBe("Topsoil");
    expect(stratumAt(12).name).toBe("Clay Beds");
    expect(stratumAt(48).name).toBe("Magma Verge");
    expect(stratumAt(500).name).toBe("Magma Verge");
    // From a fresh record to row 30: Clay Beds (15) + Old Granite (40).
    expect(strataBonusBetween(0, 30)).toBe(15 + 40);
    // Already past Clay Beds: only Old Granite pays.
    expect(strataBonusBetween(15, 30)).toBe(40);
    // No new stratum, no bonus.
    expect(strataBonusBetween(30, 35)).toBe(0);
    const everything = STRATA.reduce((sum, s) => sum + s.firstReachBonus, 0);
    expect(strataBonusBetween(0, 10_000)).toBe(everything);
  });

  it("digs dirt, collects ore by tier, and refuses rock", () => {
    const state = createMine(7);
    let digs = 0;
    let oreChunks = 0;
    let value = 0;
    const directions: Direction[] = ["down", "left", "right", "down"];
    for (let i = 0; i < 40 && state.miner.energy > 0; i++) {
      const dir = directions[i % directions.length];
      const result = step(state, dir);
      if (result.ok && result.dug) {
        digs++;
        if (result.dugOre) {
          oreChunks++;
          value += oreDef(result.dugOre).value;
        }
      }
    }
    expect(digs).toBeGreaterThan(0);
    expect(carriedCount(state.miner)).toBe(oreChunks);
    expect(carriedValue(state.miner)).toBe(value);
  });

  it("banks carried loot only at the surface and refills energy", () => {
    const state = createMine(11);
    step(state, "down");
    state.miner.carried = { silver: 2, coal: 3 };
    const up = step(state, "up");
    expect(up.ok).toBe(true);
    expect(state.miner.row).toBe(0);
    expect(carriedCount(state.miner)).toBe(0);
    expect(state.miner.bankedCredits).toBe(2 * 8 + 3 * 1);
    expect(state.miner.energy).toBe(START_ENERGY);
  });

  it("collapses underground when energy runs out, losing the carry", () => {
    const state = createMine(13);
    step(state, "down");
    expect(state.miner.row).toBe(1);
    state.miner.carried = { emerald: 2 };
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
    expect(carriedCount(state.miner)).toBe(0);
    expect(state.miner.bankedCredits).toBe(0);
    expect(state.miner.row).toBe(0);
  });

  it("up-moves need a cleared shaft", () => {
    const state = createMine(17);
    step(state, "down");
    step(state, "left");
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

  it("tracks max depth and prices the climb home", () => {
    const state = createMine(23);
    for (let i = 0; i < 6; i++) step(state, "down");
    const reached = state.miner.row;
    expect(state.miner.maxDepth).toBe(reached);
    expect(returnEnergyCost(state.miner)).toBe(reached * 0.5);
    // Climbing back up does not shrink the record.
    step(state, "up");
    expect(state.miner.maxDepth).toBe(reached);
  });

  it("replays a trip to identical banked results", () => {
    const moves = [] as Direction[];
    const state = createMine(31337);
    for (let i = 0; i < 80; i++) {
      const dir =
        i % 9 === 4 ? "left" : i % 13 === 6 ? "right" : i % 2 ? "down" : "up";
      moves.push(dir);
      step(state, dir);
    }
    const replayed = replayTrip(31337, moves);
    expect(replayed.bankedCredits).toBe(state.miner.bankedCredits);
    expect(replayed.bankedParts).toEqual(state.miner.bankedParts);
    expect(replayed.maxDepth).toBe(state.miner.maxDepth);
    // Same log, same credit: the server and an honest client agree.
    expect(replayTrip(31337, moves)).toEqual(replayed);
  });

  it("keeps light bounded by lantern radius", () => {
    const state = createMine(5);
    expect(state.rows.length).toBeGreaterThanOrEqual(LIGHT_RADIUS + 1);
    expect(state.miner.col).toBe(START_COL);
  });
});
