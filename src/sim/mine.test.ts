import { describe, expect, it } from "vitest";
import {
  applyAction,
  BASE_HITS,
  blastRadius,
  canDigRock,
  cargoCapacity,
  carriedCount,
  carriedValue,
  carryoverConsumables,
  cellAt,
  createMine,
  DEFAULT_GEAR,
  type Direction,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  elevatorSegmentPrice,
  elevatorSpeedRows,
  exportDiff,
  FALL_DELAY_ACTIONS,
  findBeacon,
  GAS_VENT_DRAIN,
  GEAR_TRACKS,
  HAZARD_FREE_ROWS,
  isVisible,
  LADDER_RECOVERY_FLOOR,
  LAMP_ENERGY,
  LANTERN_RADIUS,
  LIGHT_RADIUS,
  type MineAction,
  type MineConsumables,
  type MineState,
  type MoveResult,
  maxGearLevel,
  NO_CONSUMABLES,
  ORES,
  oreChanceAt,
  oreDef,
  PLANK_RECOVERY_FLOOR,
  ROCK_DIG_COST,
  ROCK_FREE_ROWS,
  replayTrip,
  returnEnergyCost,
  returnLadderNeed,
  rockTierAt,
  START_COL,
  START_ENERGY,
  STRATA,
  SWING_COST,
  setCell,
  step,
  strataBonusBetween,
  stratumAt,
  WARP_PAD_COL,
  type WorldDiff,
  warpRange,
} from "./mine";

/** Swing at a direction until the block breaks (or the action ends). */
function dig(state: MineState, dir: Direction): MoveResult {
  let res = step(state, dir);
  for (let i = 0; i < 8 && res.ok && res.cracked; i++) res = step(state, dir);
  return res;
}

/** A consumable snapshot with only the named counts set (rest zero). */
function stock(over: Partial<MineConsumables>): MineConsumables {
  return { ...NO_CONSUMABLES, ...over };
}

describe("mine", () => {
  it("soaks swings before breaking and tracks crack hp (REQ-013)", () => {
    const state = createMine(137);
    // Dirt at pickaxe 1 takes 4 swings; the first three crack in place.
    for (let hit = 1; hit <= 3; hit++) {
      const res = step(state, "down");
      expect(res.ok && res.cracked?.remaining).toBe(4 - hit);
      expect(state.miner.row).toBe(0);
    }
    expect(state.miner.energy).toBeCloseTo(START_ENERGY - 0.75, 5);
    const broke = step(state, "down");
    expect(broke.ok && broke.dug !== null).toBe(true);
    expect(state.miner.row).toBe(1);
    // Block totals match the old single-swing economy (dirt/ore = 1.0,
    // so depth 1 always costs exactly 1 energy at pickaxe 1)...
    if (broke.ok && broke.dug === "dirt") {
      expect(state.miner.energy).toBeCloseTo(START_ENERGY - 1, 5);
    }
    // ...and a better pickaxe needs fewer swings.
    const strong = createMine(137, { ...DEFAULT_GEAR, pickaxe: 3 });
    const first = step(strong, "down");
    expect(first.ok && (first.cracked?.remaining ?? 0)).toBeLessThanOrEqual(2);
  });

  it("generates the same mine for the same seed", () => {
    const a = createMine(42);
    const b = createMine(42);
    for (let row = 0; row < 40; row++) {
      for (let col = -6; col <= 6; col++) {
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
    for (let col = -6; col <= 6; col++) {
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
      for (let col = -6; col <= 6; col++) {
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
        for (let col = -6; col <= 6; col++) {
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
        for (let col = -6; col <= 6; col++) {
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
    expect(stratumAt(500).name).toBe("Core Approach");
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
    const owned = stock({ ladder: 8 });
    const state = createMine(11, DEFAULT_GEAR, owned);
    dig(state, "down");
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
    dig(state, "down");
    expect(state.miner.row).toBe(1);
    state.miner.carried = { emerald: 2 };
    state.miner.energy = 0.2;
    // Any successful swing now drains the lamp underground.
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
    const owned = stock({ ladder: 8 });
    const state = createMine(17, DEFAULT_GEAR, owned);
    dig(state, "down");
    dig(state, "left");
    dig(state, "down");
    const sideways = dig(state, "right");
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
    for (let i = 0; i < 6; i++) dig(state, "down");
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

  it("persists the carved world across trips via the diff (REQ-026)", () => {
    const trip1: MineAction[] = ["down", "down", "down", "down", "up", "up"];
    const owned = stock({ ladder: 8 });
    const state = createMine(211, DEFAULT_GEAR, owned);
    for (const a of trip1) applyAction(state, a);
    // The dug shaft and its ladders are in the diff...
    const diff = exportDiff(state);
    expect(diff.length).toBeGreaterThan(0);
    // ...and a fresh trip over the diff resumes the same world: the
    // shaft is still dug, the ladder still planted, but the trip state
    // (energy, stock, log) is fresh.
    const next = createMine(211, DEFAULT_GEAR, NO_CONSUMABLES, diff);
    expect(cellAt(next, START_COL, 1)?.kind).toBe("empty");
    expect(cellAt(next, START_COL, 1)?.ladder).toBe(true);
    expect(next.miner.energy).toBe(START_ENERGY);
    // Trips no longer ship free ladders: stock starts at the carried value.
    expect(next.consumables.ladder).toBe(0);
    // Server-side replay parity holds trip over trip: replaying trip 2
    // on trip 1's checkpoint matches the live client.
    const trip2: MineAction[] = ["down", "left", "left", "left", "abandon"];
    for (const a of trip2) applyAction(next, a);
    const replayed = replayTrip(211, trip2, DEFAULT_GEAR, NO_CONSUMABLES, diff);
    expect(replayed.maxDepth).toBe(next.miner.maxDepth);
    expect(replayed.diff).toEqual(exportDiff(next));
  });

  it("digs into negative columns: the mine is endless (REQ-027)", () => {
    const state = createMine(223);
    // March left along the surface and dig down well past the old edge.
    for (let i = 0; i < 12; i++) step(state, "left");
    expect(state.miner.col).toBe(-12);
    const before = state.miner.energy;
    dig(state, "down");
    expect(state.miner.row).toBe(1);
    expect(before).toBe(START_ENERGY);
    // Generation is deterministic out there too (compare pristine
    // rows below the one this test dug).
    const twin = createMine(223);
    for (let r = 2; r < 20; r++) {
      expect(cellAt(twin, -12, r)?.kind).toBe(cellAt(state, -12, r)?.kind);
    }
  });

  it("rides the elevator down and up along bought rail (REQ-028)", () => {
    const norail = createMine(229);
    expect(applyAction(norail, "ride-down")).toEqual({
      ok: false,
      reason: "no-elevator",
    });

    const rail = ELEVATOR_SEGMENT_ROWS;
    const gear = { ...DEFAULT_GEAR, elevator: rail };
    const state = createMine(229, gear);
    // Riding from anywhere but the tower column is refused.
    expect(applyAction(state, "ride-down")).toEqual({
      ok: false,
      reason: "blocked",
    });
    // Walk to the tower; rides are free and bore the rail span as they go.
    while (state.miner.col > ELEVATOR_COL) step(state, "left");
    const energyAtTower = state.miner.energy;
    // A ride covers the car's speed in rows (base car = 2), not the whole
    // rail: it is no longer instant.
    const carRows = elevatorSpeedRows(gear);
    expect(carRows).toBe(2);
    const ride = applyAction(state, "ride-down");
    expect(ride.ok).toBe(true);
    expect(state.miner.row).toBe(carRows);
    expect(state.miner.col).toBe(ELEVATOR_COL);
    expect(state.miner.energy).toBe(energyAtTower);
    for (let r = 1; r <= carRows; r++) {
      expect(cellAt(state, ELEVATOR_COL, r)?.kind).toBe("empty");
    }
    // Keep riding to the bottom; it stops there and never overshoots.
    let guard = 0;
    while (state.miner.row < rail && guard++ < 50)
      applyAction(state, "ride-down");
    expect(state.miner.row).toBe(rail);
    expect(applyAction(state, "ride-down")).toEqual({
      ok: false,
      reason: "blocked",
    });
    for (let r = 1; r <= rail; r++) {
      expect(cellAt(state, ELEVATOR_COL, r)?.kind).toBe("empty");
    }
    // Ride back up: free, banks only when the car lands at the surface.
    state.miner.carried = { coal: 2 };
    applyAction(state, "ride-up");
    expect(state.miner.row).toBeGreaterThan(0);
    expect(state.miner.bankedCredits).toBe(0);
    guard = 0;
    while (state.miner.row > 0 && guard++ < 50) applyAction(state, "ride-up");
    expect(state.miner.row).toBe(0);
    expect(state.miner.bankedCredits).toBe(2);
    // Off-rail ride-up is refused.
    step(state, "right");
    expect(applyAction(state, "ride-up")).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  it("replays elevator trips identically", () => {
    const gear = { ...DEFAULT_GEAR, elevator: ELEVATOR_SEGMENT_ROWS };
    const actions: MineAction[] = [
      ...Array.from({ length: 5 }, () => "left" as const),
      "ride-down",
      "down",
      "ride-up",
    ];
    const state = createMine(233, gear);
    for (const a of actions) applyAction(state, a);
    const replayed = replayTrip(233, actions, gear);
    expect(replayed.maxDepth).toBe(state.miner.maxDepth);
    expect(replayed.diff).toEqual(exportDiff(state));
    expect(replayTrip(233, actions, gear)).toEqual(replayed);
  });

  it("prices rail segments superlinearly", () => {
    expect(elevatorSegmentPrice(1)).toBe(40);
    expect(elevatorSegmentPrice(2)).toBe(100);
    expect(elevatorSegmentPrice(3)).toBe(250);
    expect(elevatorSegmentPrice(4)).toBeGreaterThan(600);
  });

  it("plants one beacon and warps within coil range (REQ-029)", () => {
    const cons = { ...NO_CONSUMABLES, beacon: 2 };
    const state = createMine(241, DEFAULT_GEAR, cons);
    expect(applyAction(state, "place-beacon")).toEqual({
      ok: false,
      reason: "surface",
    });
    expect(applyAction(state, "warp-down")).toEqual({
      ok: false,
      reason: "no-beacon",
    });
    dig(state, "down");
    dig(state, "down");
    const planted = applyAction(state, "place-beacon");
    expect(planted.ok).toBe(true);
    expect(state.used.beacon).toBe(1);
    expect(findBeacon(state)).toEqual({ col: START_COL, row: 2 });
    // Warp home banks from the beacon cell; warp down returns to it.
    state.miner.carried = { coal: 1 };
    expect(applyAction(state, "warp-home").ok).toBe(true);
    expect(state.miner.row).toBe(0);
    expect(state.miner.col).toBe(WARP_PAD_COL);
    expect(state.miner.bankedCredits).toBe(1);
    expect(applyAction(state, "warp-down").ok).toBe(true);
    expect(state.miner.row).toBe(2);
    // Replanting moves the single beacon.
    dig(state, "down");
    expect(applyAction(state, "place-beacon").ok).toBe(true);
    expect(findBeacon(state)).toEqual({ col: START_COL, row: 3 });
    expect(state.consumables.beacon).toBe(0);
    expect(applyAction(state, "place-beacon")).toEqual({
      ok: false,
      reason: "no-beacon",
    });
  });

  it("refuses warps past the coil range until upgraded", () => {
    const cons = { ...NO_CONSUMABLES, beacon: 1 };
    const state = createMine(251, DEFAULT_GEAR, cons);
    dig(state, "down");
    const beaconCell = findBeacon(state);
    expect(beaconCell).toBeNull();
    applyAction(state, "place-beacon");
    // Fake depth beyond range by moving the beacon record deep.
    const planted = findBeacon(state);
    expect(planted).not.toBeNull();
    if (planted) {
      setCell(state, planted.col, planted.row, { kind: "empty" });
      setCell(state, planted.col, 100, { kind: "empty", beacon: true });
    }
    expect(applyAction(state, "warp-home")).toEqual({
      ok: false,
      reason: "out-of-range",
    });
    const coil = createMine(251, { ...DEFAULT_GEAR, warpcoil: 3 }, cons);
    expect(warpRange(coil.gear)).toBe(400);
  });

  it("replays beacon trips identically", () => {
    const cons = { ...NO_CONSUMABLES, beacon: 1 };
    const actions: MineAction[] = [
      "down",
      "down",
      "down",
      "down",
      "down",
      "down",
      "place-beacon",
      "warp-home",
    ];
    const state = createMine(257, DEFAULT_GEAR, cons);
    for (const a of actions) applyAction(state, a);
    const replayed = replayTrip(257, actions, DEFAULT_GEAR, cons);
    expect(replayed.used.beacon).toBe(state.used.beacon);
    expect(replayed.diff).toEqual(exportDiff(state));
    expect(replayTrip(257, actions, DEFAULT_GEAR, cons)).toEqual(replayed);
  });

  it("escalates the deep: strata, magma, tier-4 rock, richer caches (REQ-030)", () => {
    // Strata extend past the Magma Verge with growing bonuses.
    expect(stratumAt(70).name).toBe("Ashfall Galleries");
    expect(stratumAt(90).name).toBe("The Black Seam");
    expect(stratumAt(120).name).toBe("Echo Vaults");
    expect(stratumAt(200).name).toBe("Core Approach");
    expect(strataBonusBetween(48, 140)).toBe(500 + 1000 + 1800 + 3000);
    // Rock tier 4 gates on pickaxe 5.
    expect(rockTierAt(95)).toBe(4);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 4 }, 4)).toBe(false);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 5 }, 4)).toBe(true);
    expect(maxGearLevel("pickaxe")).toBe(5);
    // Magma vents like gas at triple burn.
    const state = createMine(263);
    setCell(state, START_COL, 1, { kind: "dirt" });
    setCell(state, START_COL, 2, { kind: "magma" });
    const before = state.miner.energy;
    const result = dig(state, "down");
    expect(result.ok && result.vented).toBe(3);
    expect(before - state.miner.energy).toBeCloseTo(1 + 3 * GAS_VENT_DRAIN, 5);
    // Deep caches roll the richer table deterministically.
    const deep = createMine(269);
    setCell(deep, START_COL, 1, { kind: "part-cache" });
    const found = dig(deep, "down");
    expect(found.ok && typeof found.found).toBe("string");
  });

  it("starts pristine at the village shaft", () => {
    const state = createMine(5);
    // Nothing is overridden until the player digs; generation is pure.
    expect(state.cells.size).toBe(0);
    expect(state.miner.col).toBe(START_COL);
    expect(cellAt(state, 0, LIGHT_RADIUS + 1)?.kind).toBeDefined();
  });

  it("scales lamp energy and bank refill with the lamp level", () => {
    const base = createMine(3);
    expect(base.miner.energy).toBe(LAMP_ENERGY[0]);
    const owned = stock({ ladder: 8 });
    const upgraded = createMine(3, { ...DEFAULT_GEAR, lamp: 3 }, owned);
    expect(upgraded.miner.energy).toBe(LAMP_ENERGY[2]);
    dig(upgraded, "down");
    step(upgraded, "up");
    expect(upgraded.miner.energy).toBe(LAMP_ENERGY[2]);
  });

  it("extends visibility with the lantern level", () => {
    const base = createMine(3);
    const lit = createMine(3, { ...DEFAULT_GEAR, lantern: 3 });
    const deepRow = LANTERN_RADIUS[2];
    expect(isVisible(base, deepRow)).toBe(false);
    expect(isVisible(lit, deepRow)).toBe(true);
  });

  it("refuses ore with a full hold but still digs dirt", () => {
    const state = createMine(19);
    state.miner.carried = { coal: cargoCapacity(state.gear) };
    setCell(state, START_COL, 1, { kind: "ore", ore: "coal" });
    const refused = step(state, "down");
    expect(refused).toEqual({ ok: false, reason: "hold-full" });
    setCell(state, START_COL, 1, { kind: "dirt" });
    const dug = dig(state, "down");
    expect(dug.ok && dug.dug).toBe("dirt");
  });

  it("tiers rock by depth and gates it on the pickaxe level", () => {
    expect(rockTierAt(5)).toBe(1);
    expect(rockTierAt(30)).toBe(2);
    expect(rockTierAt(60)).toBe(3);
    expect(canDigRock(DEFAULT_GEAR, 1)).toBe(false);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 2 }, 1)).toBe(true);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 2 }, 2)).toBe(false);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 4 }, 3)).toBe(true);

    const state = createMine(19, { ...DEFAULT_GEAR, pickaxe: 2 });
    setCell(state, START_COL, 1, { kind: "rock", rockTier: 1 });
    const before = state.miner.energy;
    const dug = dig(state, "down");
    expect(dug.ok && dug.dug).toBe("rock");
    // Pickaxe 2 cuts tier-1 rock in 4 swings of the rock swing cost.
    expect(before - state.miner.energy).toBeCloseTo(
      (BASE_HITS.rock - 1) * SWING_COST.rock,
      5,
    );
    void ROCK_DIG_COST;

    const walled = createMine(19);
    setCell(walled, START_COL, 1, { kind: "rock", rockTier: 1 });
    expect(step(walled, "down")).toEqual({ ok: false, reason: "rock" });
  });

  it("replays identically with a gear snapshot", () => {
    const gear = {
      pickaxe: 2,
      lamp: 2,
      cargo: 2,
      lantern: 2,
      elevator: 0,
      warpcoil: 1,
    };
    // A push-your-luck descent: mostly down with lateral sweeps. The
    // bigger lamp digs further before the collapse, so the snapshot
    // genuinely changes the trip.
    const moves: Direction[] = [];
    for (let i = 0; i < 150; i++) {
      moves.push(i % 7 === 3 ? "left" : i % 11 === 5 ? "right" : "down");
    }
    const state = createMine(777, gear);
    for (const dir of moves) step(state, dir);
    const replayed = replayTrip(777, moves, gear);
    expect(replayed.bankedCredits).toBe(state.miner.bankedCredits);
    expect(replayed.maxDepth).toBe(state.miner.maxDepth);
    // A different gear snapshot is a different trip.
    const otherGear = replayTrip(777, moves);
    expect(otherGear.maxDepth).not.toBe(replayed.maxDepth);
  });

  it("keeps hazards out of the top rows", () => {
    for (const seed of [5, 1234, 999999]) {
      const state = createMine(seed);
      for (let row = 1; row <= HAZARD_FREE_ROWS; row++) {
        for (let col = -6; col <= 6; col++) {
          const kind = cellAt(state, col, row)?.kind;
          expect(kind).not.toBe("gas");
          expect(kind).not.toBe("boulder");
        }
      }
    }
  });

  it("vents gas when digging next to it, chaining through pockets", () => {
    const state = createMine(41);
    // Hand-build the scenario: dig down to row 1, gas at row 2 below,
    // another gas in its blast plus to chain.
    setCell(state, START_COL, 1, { kind: "dirt" });
    setCell(state, START_COL, 2, { kind: "gas" });
    setCell(state, START_COL - 1, 2, { kind: "gas" });
    setCell(state, START_COL, 3, { kind: "ore", ore: "coal" });
    const before = state.miner.energy;
    const result = dig(state, "down");
    expect(result.ok && result.vented).toBe(2);
    // Both pockets vented; the loot caught in the blast is gone.
    expect(cellAt(state, START_COL, 2)?.kind).toBe("empty");
    expect(cellAt(state, START_COL - 1, 2)?.kind).toBe("empty");
    expect(cellAt(state, START_COL, 3)?.kind).toBe("empty");
    expect(before - state.miner.energy).toBeCloseTo(1 + 2 * GAS_VENT_DRAIN, 5);
  });

  it("teeters an undermined boulder, then drops it after two moves", () => {
    // Fast pickaxe so the dirt support breaks in a single swing and the
    // action count after the undermining dig is exact.
    const state = createMine(43, { ...DEFAULT_GEAR, pickaxe: 4 });
    const c = START_COL;
    state.miner.row = 6;
    state.miner.col = c;
    setCell(state, c, 6, { kind: "empty" }); // miner stands here
    setCell(state, c + 1, 6, { kind: "dirt" }); // the boulder's support
    setCell(state, c + 1, 5, { kind: "boulder" });
    setCell(state, c + 1, 7, { kind: "dirt" }); // floor: the boulder rests at row 6
    // An empty corridor to step clear along, each cell floored so the
    // walk needs no planks.
    for (let dc = 2; dc <= 4; dc++) {
      setCell(state, c + dc, 6, { kind: "empty" });
      setCell(state, c + dc, 7, { kind: "dirt" });
    }
    // Dig out the support: the boulder above starts its countdown.
    const dug = dig(state, "right");
    expect(dug.ok).toBe(true);
    expect(state.miner.col).toBe(c + 1);
    expect(cellAt(state, c + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS);
    // Step clear; the countdown ticks one per action with no early drop.
    expect(step(state, "right").ok).toBe(true); // -> c+2
    expect(cellAt(state, c + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS - 1);
    expect(cellAt(state, c + 1, 5)?.kind).toBe("boulder"); // still perched
    expect(step(state, "right").ok).toBe(true); // -> c+3: the countdown hits zero
    // The boulder fell into the vacated support cell and rests there.
    expect(cellAt(state, c + 1, 5)?.kind).toBe("empty");
    expect(cellAt(state, c + 1, 6)?.kind).toBe("boulder");
  });

  it("drops an undermined rock onto a lingering miner, crushing them", () => {
    // Default pickaxe: dirt takes four swings, so chipping a wall keeps
    // the miner in place under the rock while its countdown runs out.
    const state = createMine(47);
    const c = START_COL;
    state.miner.row = 6;
    state.miner.col = c;
    setCell(state, c, 6, { kind: "empty" });
    setCell(state, c + 1, 6, { kind: "dirt" }); // the rock's support
    setCell(state, c + 1, 5, { kind: "rock", rockTier: 1 });
    setCell(state, c + 1, 7, { kind: "dirt" }); // chip-in-place wall below
    state.miner.carried = { coal: 3 };
    const dug = dig(state, "right"); // undermine: miner ends at (c+1,6)
    expect(dug.ok).toBe(true);
    expect(state.miner.col).toBe(c + 1);
    expect(cellAt(state, c + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS);
    // Chip the floor in place; each swing ticks the countdown.
    expect(step(state, "down").ok).toBe(true); // fallIn -> 1
    const fatal = step(state, "down"); // fallIn -> 0: the rock drops on the miner
    expect(fatal.ok && fatal.crushed).toBe(true);
    expect(fatal.ok && fatal.collapsed).toBe(true);
    expect(state.miner.row).toBe(0);
    expect(carriedCount(state.miner)).toBe(0);
    expect(state.miner.collapses).toBe(1);
  });

  it("never drops rock in the hazard-free top rows", () => {
    const state = createMine(103, { ...DEFAULT_GEAR, pickaxe: 4 });
    const c = START_COL;
    // A rock at the deepest hazard-free row, sitting on dirt one below.
    state.miner.row = HAZARD_FREE_ROWS + 1;
    state.miner.col = c;
    setCell(state, c, HAZARD_FREE_ROWS + 1, { kind: "empty" });
    setCell(state, c + 1, HAZARD_FREE_ROWS + 1, { kind: "dirt" }); // support
    setCell(state, c + 1, HAZARD_FREE_ROWS, { kind: "rock", rockTier: 1 });
    setCell(state, c + 1, HAZARD_FREE_ROWS + 2, { kind: "dirt" }); // floor
    const dug = dig(state, "right"); // undermine the gentle-top rock
    expect(dug.ok).toBe(true);
    // Inside the gentle top the rock never starts a countdown, so it
    // never falls: the first lesson stays safe.
    expect(cellAt(state, c + 1, HAZARD_FREE_ROWS)?.fallIn).toBeUndefined();
    expect(cellAt(state, c + 1, HAZARD_FREE_ROWS)?.kind).toBe("rock");
  });

  it("drops an undermined rock deterministically across a replay", () => {
    const seed = 777;
    const gear = { ...DEFAULT_GEAR, pickaxe: 4 };
    const c = START_COL;
    // Initial world: an empty descent shaft and a rock perched on dirt
    // that the trip will undermine and drop, with a floored escape corridor.
    const diff: WorldDiff = [
      [c, 1, { kind: "empty" }],
      [c, 2, { kind: "empty" }],
      [c, 3, { kind: "empty" }],
      [c, 4, { kind: "empty" }],
      [c, 5, { kind: "empty" }],
      [c, 6, { kind: "empty" }],
      [c + 1, 5, { kind: "rock", rockTier: 1 }],
      [c + 1, 6, { kind: "dirt" }],
      [c + 1, 7, { kind: "dirt" }],
      [c + 2, 6, { kind: "empty" }],
      [c + 2, 7, { kind: "dirt" }],
      [c + 3, 6, { kind: "empty" }],
      [c + 3, 7, { kind: "dirt" }],
    ];
    const actions: MineAction[] = [
      "down",
      "down",
      "down",
      "down",
      "down",
      "down", // descend the shaft to row 6
      "right", // undermine the rock (one swing)
      "right", // step clear; countdown ticks
      "right", // countdown hits zero: the rock drops behind the miner
    ];
    const live = createMine(seed, gear, NO_CONSUMABLES, diff);
    for (const action of actions) applyAction(live, action);
    // The rock left its perch and rests in the vacated support cell.
    expect(cellAt(live, c + 1, 5)?.kind).toBe("empty");
    expect(cellAt(live, c + 1, 6)?.kind).toBe("rock");
    expect(cellAt(live, c + 1, 6)?.rockTier).toBe(1);
    expect(cellAt(live, c + 1, 6)?.fallen).toBe(true);
    // The server replay of the same log lands on the identical world.
    const replayed = replayTrip(seed, actions, gear, NO_CONSUMABLES, diff);
    expect(replayed.diff).toEqual(exportDiff(live));
  });

  it("plants dynamite, then explodes once the miner moves clear", () => {
    const noStick = createMine(53);
    expect(applyAction(noStick, "dynamite-down")).toEqual({
      ok: false,
      reason: "no-dynamite",
    });

    const state = createMine(53, DEFAULT_GEAR, {
      dynamite: 2,
      rope: 0,
      ladder: 0,
      plank: 0,
      beacon: 0,
    });
    setCell(state, START_COL, 1, { kind: "rock", rockTier: 3 });
    setCell(state, START_COL, 2, { kind: "ore", ore: "coal" });
    const planted = applyAction(state, "dynamite-down");
    expect(planted.ok && planted.dynamitePlanted).toEqual({
      col: START_COL,
      row: 1,
    });
    expect(planted.ok && (planted.blasted ?? 0)).toBe(0);
    expect(state.pendingDynamite).toEqual({ col: START_COL, row: 1 });
    expect(cellAt(state, START_COL, 1)?.kind).toBe("rock");

    const result = applyAction(state, "left");
    expect(result.ok && (result.blasted ?? 0)).toBeGreaterThanOrEqual(2);
    expect(result.ok && result.exploded).toEqual({ col: START_COL, row: 1 });
    expect(cellAt(state, START_COL, 1)?.kind).toBe("empty");
    expect(cellAt(state, START_COL, 2)?.kind).toBe("empty");
    expect(state.pendingDynamite).toBeUndefined();
    expect(state.consumables.dynamite).toBe(1);
    expect(state.used.dynamite).toBe(1);
    // The surface step resets the lamp at the top after the charge pops.
    expect(state.miner.energy).toBe(LAMP_ENERGY[0]);

    const replayed = replayTrip(
      53,
      ["dynamite-down", "left"],
      DEFAULT_GEAR,
      stock({ dynamite: 2 }),
    );
    expect(replayed.diff).toEqual(exportDiff(state));
  });

  it("recall rope banks the carry from any depth", () => {
    const state = createMine(59, DEFAULT_GEAR, {
      dynamite: 0,
      rope: 1,
      ladder: 0,
      plank: 0,
      beacon: 0,
    });
    expect(applyAction(state, "recall")).toEqual({
      ok: false,
      reason: "surface",
    });
    dig(state, "down");
    dig(state, "down");
    state.miner.carried = { silver: 3 };
    const result = applyAction(state, "recall");
    expect(result.ok && result.recalled).toBe(true);
    expect(state.miner.row).toBe(0);
    expect(state.miner.bankedCredits).toBe(24);
    expect(state.used.rope).toBe(1);
    expect(applyAction(state, "recall")).toEqual({
      ok: false,
      reason: "surface",
    });
  });

  it("gates climbs on owned ladders and plants them", () => {
    const owned = stock({ ladder: 8 });
    const state = createMine(71, DEFAULT_GEAR, owned);
    // Trips no longer ship free ladders: the stock is what was bought.
    expect(state.consumables.ladder).toBe(8);
    dig(state, "down");
    dig(state, "down");
    const climb = step(state, "up");
    expect(climb.ok && climb.laddered).toBe(true);
    expect(state.consumables.ladder).toBe(7);
    expect(state.used.ladder).toBe(1);
    expect(cellAt(state, START_COL, 2)?.ladder).toBe(true);
    // Re-descending and re-climbing the same cell reuses the ladder.
    step(state, "down");
    const reclimb = step(state, "up");
    expect(reclimb.ok && !reclimb.laddered).toBe(true);
    expect(state.consumables.ladder).toBe(7);
    expect(state.used.ladder).toBe(1);
  });

  it("refills ladders and planks up to the floor on death", () => {
    const owned = stock({ ladder: 2, plank: 1 });
    const state = createMine(91, DEFAULT_GEAR, owned);
    expect(state.consumables.ladder).toBe(2);
    expect(state.consumables.plank).toBe(1);
    // Drop below ground, then swing with a dead lamp: a death (not a
    // chosen bail), so the recovery floor tops the stock back up.
    dig(state, "down");
    state.miner.energy = 0;
    const death = step(state, "down");
    expect(death.ok && death.collapsed && !death.abandoned).toBe(true);
    expect(state.miner.row).toBe(0);
    expect(state.consumables.ladder).toBe(LADDER_RECOVERY_FLOOR);
    expect(state.consumables.plank).toBe(PLANK_RECOVERY_FLOOR);
    // The free top-up is recorded so cash-out forgives it (not charged).
    expect(state.granted.ladder).toBe(LADDER_RECOVERY_FLOOR - 2);
    expect(state.granted.plank).toBe(PLANK_RECOVERY_FLOOR - 1);
    // Unspent free rungs do not bank: only the purchased stock survives.
    expect(carryoverConsumables(state).ladder).toBe(2);
    expect(carryoverConsumables(state).plank).toBe(1);
  });

  it("grants no free stock when the miner gives up", () => {
    const owned = stock({ ladder: 2, plank: 1 });
    const state = createMine(93, DEFAULT_GEAR, owned);
    dig(state, "down");
    const ab = applyAction(state, "abandon");
    expect(ab.ok && ab.abandoned).toBe(true);
    // Abandoning is a chosen bail: stock and grants stay put.
    expect(state.consumables.ladder).toBe(2);
    expect(state.consumables.plank).toBe(1);
    expect(state.granted.ladder).toBe(0);
    expect(state.granted.plank).toBe(0);
  });

  it("refuses to climb without ladders", () => {
    const state = createMine(73);
    dig(state, "down");
    state.consumables.ladder = 0;
    expect(step(state, "up")).toEqual({ ok: false, reason: "no-ladder" });
    // Still standing where the refusal happened, lamp untouched by it.
    expect(state.miner.row).toBe(1);
  });

  it("prices the ladder budget for the climb home", () => {
    const owned = stock({ ladder: 8 });
    const state = createMine(79, DEFAULT_GEAR, owned);
    for (let i = 0; i < 4; i++) dig(state, "down");
    expect(returnLadderNeed(state)).toBe(state.miner.row);
    step(state, "up");
    // The placed ladder discounts the straight-home estimate.
    expect(returnLadderNeed(state)).toBe(state.miner.row);
    step(state, "down");
    expect(returnLadderNeed(state)).toBe(state.miner.row - 1);
  });

  it("banks only purchased ladders between trips", () => {
    const owned = stock({ ladder: 3 });
    const state = createMine(83, DEFAULT_GEAR, owned);
    // No free provision at the start: the stock is what was bought.
    expect(state.consumables.ladder).toBe(3);
    // Spend two purchased ladders climbing out and back.
    dig(state, "down");
    dig(state, "down");
    step(state, "up");
    step(state, "down");
    dig(state, "down");
    step(state, "up");
    expect(state.used.ladder).toBe(2);
    // Nothing was granted (no death), so the leftover purchased stock banks.
    expect(carryoverConsumables(state).ladder).toBe(1);
    expect(carryoverConsumables(createMine(83)).ladder).toBe(0);
    expect(carryoverConsumables(state)).toEqual({
      dynamite: 0,
      rope: 0,
      ladder: 1,
      plank: 0,
      beacon: 0,
    });
  });

  /**
   * Blast a true gap under the shaft mouth: dynamite-down plants the
   * charge at (4,1), the surface step left creates the gap and clears
   * (4,1), (4,2), (3,1), (5,1), leaving (4,2) an empty void with no
   * ladder in it. Rows 1-2 are rock- and hazard-free, so only a rare
   * part-cache could survive the blast; the emptiness asserts guard
   * against picking such a seed.
   */
  function blastGap(seed: number) {
    const state = createMine(seed, DEFAULT_GEAR, {
      dynamite: 1,
      rope: 0,
      ladder: 0,
      plank: 4,
      beacon: 0,
    });
    expect(applyAction(state, "dynamite-down").ok).toBe(true);
    const blast = applyAction(state, "left");
    expect(blast.ok && blast.exploded).toEqual({ col: START_COL, row: 1 });
    expect(cellAt(state, START_COL, 1)?.kind).toBe("empty");
    expect(cellAt(state, START_COL, 2)?.kind).toBe("empty");
    expect(cellAt(state, START_COL - 1, 1)?.kind).toBe("empty");
    step(state, "down");
    return state;
  }

  it("bridges lateral gaps with planks and reuses them", () => {
    // Standing at (3,1) after the blast, stepping right into (4,1)
    // crosses the void at (4,2): no ladder anywhere, so a plank goes in.
    const state = blastGap(101);
    expect(state.used.plank).toBe(0);
    const cross = step(state, "right");
    expect(cross.ok && cross.planked).toBe(true);
    expect(state.consumables.plank).toBe(PLANK_RECOVERY_FLOOR - 1);
    expect(state.used.plank).toBe(1);
    expect(cellAt(state, START_COL, 1)?.plank).toBe(true);
    // Re-crossing the planked cell is free.
    step(state, "left");
    const recross = step(state, "right");
    expect(recross.ok && !recross.planked).toBe(true);
    expect(state.used.plank).toBe(1);
  });

  it("refuses the gap step without planks, costing nothing", () => {
    const state = blastGap(103);
    state.consumables.plank = 0;
    const energy = state.miner.energy;
    expect(step(state, "right")).toEqual({ ok: false, reason: "no-plank" });
    expect(state.miner.col).toBe(START_COL - 1);
    expect(state.miner.energy).toBe(energy);
  });

  it("never spends planks where ladders already support the step", () => {
    // Dig two deep and climb out: ladders planted at (4,2) and (4,1).
    const owned = stock({ ladder: 8, plank: 4 });
    const state = createMine(131, DEFAULT_GEAR, owned);
    dig(state, "down");
    dig(state, "down");
    step(state, "up");
    step(state, "up");
    expect(state.used.ladder).toBe(2);
    // Tunnel down beside the shaft, then step back into it: the target
    // cell holds a ladder and the cell below tops out underfoot. No
    // plank either way (the reported bug burned one here).
    dig(state, "left");
    dig(state, "down");
    const cross = step(state, "right");
    expect(cross.ok && !cross.planked).toBe(true);
    expect(state.used.plank).toBe(0);
    expect(state.consumables.plank).toBe(4);
    // And stepping out again over the ladder top stays free.
    const back = step(state, "left");
    expect(back.ok).toBe(true);
    expect(state.used.plank).toBe(0);
  });

  it("keeps the surface walk row plank-free over open shafts", () => {
    const state = createMine(107);
    step(state, "down");
    step(state, "up");
    step(state, "left");
    // Crossing the shaft mouth on the surface row is boardwalked.
    const cross = step(state, "right");
    expect(cross.ok && !cross.planked).toBe(true);
    expect(state.used.plank).toBe(0);
  });

  it("abandons the trip from anywhere, forfeiting the carry", () => {
    const state = createMine(113);
    expect(applyAction(state, "abandon")).toEqual({
      ok: false,
      reason: "surface",
    });
    dig(state, "down");
    dig(state, "down");
    state.miner.carried = { silver: 2 };
    const result = applyAction(state, "abandon");
    expect(result.ok && result.abandoned && result.collapsed).toBe(true);
    expect(result.ok && result.lost?.value).toBe(16);
    expect(state.miner.row).toBe(0);
    expect(carriedCount(state.miner)).toBe(0);
    expect(state.miner.bankedCredits).toBe(0);
    expect(state.miner.collapses).toBe(1);
    expect(state.miner.energy).toBe(START_ENERGY);
  });

  it("replays abandon trips identically", () => {
    const actions: MineAction[] = ["down", "down", "abandon", "down"];
    const state = createMine(127);
    for (const action of actions) applyAction(state, action);
    const replayed = replayTrip(127, actions);
    expect(replayed.bankedCredits).toBe(state.miner.bankedCredits);
    expect(replayed.maxDepth).toBe(state.miner.maxDepth);
    expect(replayTrip(127, actions)).toEqual(replayed);
  });

  it("replays an action-driven death and its recovery grant", () => {
    // Free death-rungs only stay free if the server agrees on the grant.
    // Drive a real death from the action log alone (dig straight down with
    // a top pickaxe so nothing blocks, until the lamp burns out below).
    const owned = stock({ ladder: 3 });
    const gear = { ...DEFAULT_GEAR, pickaxe: 5 };
    const live = createMine(4, gear, owned);
    const actions: MineAction[] = [];
    let collapsed = false;
    for (let i = 0; i < 2000 && !collapsed; i++) {
      const r = step(live, "down");
      if (!r.ok) break;
      actions.push("down");
      collapsed = r.collapsed ?? false;
    }
    expect(collapsed).toBe(true);
    expect(live.miner.collapses).toBe(1);
    // The death topped the ladder stock up to the floor (owned 3 -> 8).
    expect(live.granted.ladder).toBe(LADDER_RECOVERY_FLOOR - 3);
    expect(live.used.ladder).toBe(0);
    // The server replay reproduces the death and the exact free grant, so
    // cash-out forgives (used - granted) deterministically.
    const replayed = replayTrip(4, actions, gear, owned);
    expect(replayed.granted).toEqual(live.granted);
    expect(replayed.used).toEqual(live.used);
  });

  it("replays plank trips identically", () => {
    const actions: MineAction[] = [
      "dynamite-down",
      "left",
      "down",
      "right",
      "left",
      "right",
    ];
    const consumables = {
      dynamite: 1,
      rope: 0,
      ladder: 0,
      plank: 4,
      beacon: 0,
    };
    const state = createMine(109, DEFAULT_GEAR, consumables);
    for (const action of actions) applyAction(state, action);
    const replayed = replayTrip(109, actions, DEFAULT_GEAR, consumables);
    expect(replayed.used.plank).toBe(state.used.plank);
    expect(replayed.used.plank).toBe(1);
    expect(replayTrip(109, actions, DEFAULT_GEAR, consumables)).toEqual(
      replayed,
    );
  });

  it("replays ladder trips identically", () => {
    const actions: MineAction[] = [];
    const state = createMine(89);
    for (let i = 0; i < 120; i++) {
      const action: MineAction =
        i % 11 === 5 ? "left" : i % 3 === 1 ? "up" : "down";
      actions.push(action);
      applyAction(state, action);
    }
    const replayed = replayTrip(89, actions);
    expect(replayed.bankedCredits).toBe(state.miner.bankedCredits);
    expect(replayed.used.ladder).toBe(state.used.ladder);
    expect(replayTrip(89, actions)).toEqual(replayed);
  });

  it("replays consumable trips identically with used counts", () => {
    const consumables = {
      dynamite: 3,
      rope: 1,
      ladder: 0,
      plank: 0,
      beacon: 0,
    };
    const actions: MineAction[] = [];
    const state = createMine(61, DEFAULT_GEAR, consumables);
    for (let i = 0; i < 60; i++) {
      const action: MineAction =
        i === 20
          ? "dynamite-down"
          : i === 50
            ? "recall"
            : i % 7 === 3
              ? "left"
              : "down";
      const result = applyAction(state, action);
      if (result.ok) actions.push(action);
    }
    const replayed = replayTrip(61, actions, DEFAULT_GEAR, consumables);
    expect(replayed.bankedCredits).toBe(state.miner.bankedCredits);
    expect(replayed.used).toEqual(state.used);
    expect(replayTrip(61, actions, DEFAULT_GEAR, consumables)).toEqual(
      replayed,
    );
  });

  it("prices gear tracks superlinearly", () => {
    for (const trackDef of GEAR_TRACKS) {
      for (let i = 1; i < trackDef.prices.length; i++) {
        expect(trackDef.prices[i] / trackDef.prices[i - 1]).toBeGreaterThan(2);
      }
      expect(maxGearLevel(trackDef.track)).toBe(trackDef.prices.length + 1);
    }
  });

  it("maps the blast gear level to the diamond radius", () => {
    expect(blastRadius({ ...DEFAULT_GEAR, blast: 1 })).toBe(1);
    expect(blastRadius({ ...DEFAULT_GEAR, blast: 3 })).toBe(3);
    // A gear snapshot that predates the track reads as radius 1.
    const legacy: Partial<typeof DEFAULT_GEAR> = { ...DEFAULT_GEAR };
    legacy.blast = undefined;
    expect(blastRadius(legacy as typeof DEFAULT_GEAR)).toBe(1);
  });

  it("widens the dynamite blast with the blast gear", () => {
    // Same seed and dig path, only the blast gear differs: the wider
    // charge clears strictly more solid cells from the same spot.
    const cons = stock({ dynamite: 1 });
    const small = createMine(401, { ...DEFAULT_GEAR, blast: 1 }, cons);
    const big = createMine(401, { ...DEFAULT_GEAR, blast: 3 }, cons);
    for (const s of [small, big]) {
      for (let i = 0; i < 3; i++) dig(s, "down");
      setCell(s, START_COL - 1, 3, { kind: "empty" });
      setCell(s, START_COL - 1, 4, { kind: "dirt" });
    }
    expect(applyAction(small, "dynamite-down").ok).toBe(true);
    expect(applyAction(big, "dynamite-down").ok).toBe(true);
    const a = applyAction(small, "left");
    const b = applyAction(big, "left");
    expect(a.ok && a.exploded && b.ok && b.exploded).toBeTruthy();
    expect(b.ok && (b.blasted ?? 0)).toBeGreaterThan(
      a.ok ? (a.blasted ?? 0) : 0,
    );
  });

  it("accelerates the elevator car with the speed gear", () => {
    // Base car is a little faster than stairs (2 rows vs 1 per dig); each
    // level picks up more rows per ride.
    expect(elevatorSpeedRows({ ...DEFAULT_GEAR, elevatorSpeed: 1 })).toBe(2);
    expect(elevatorSpeedRows({ ...DEFAULT_GEAR, elevatorSpeed: 2 })).toBe(4);
    expect(elevatorSpeedRows({ ...DEFAULT_GEAR, elevatorSpeed: 3 })).toBe(7);
    // A gear snapshot that predates the track reads as the base car.
    const legacy: Partial<typeof DEFAULT_GEAR> = { ...DEFAULT_GEAR };
    legacy.elevatorSpeed = undefined;
    expect(elevatorSpeedRows(legacy as typeof DEFAULT_GEAR)).toBe(2);
    // It strictly accelerates across the whole track.
    let prev = 0;
    for (let lvl = 1; lvl <= maxGearLevel("elevatorSpeed"); lvl++) {
      const rows = elevatorSpeedRows({ ...DEFAULT_GEAR, elevatorSpeed: lvl });
      expect(rows).toBeGreaterThan(prev);
      prev = rows;
    }
    // A faster car reaches a deep rail in fewer rides.
    const rail = 40;
    const ridesToBottom = (speed: number) => {
      const s = createMine(251, {
        ...DEFAULT_GEAR,
        elevator: rail,
        elevatorSpeed: speed,
      });
      while (s.miner.col > ELEVATOR_COL) step(s, "left");
      let rides = 0;
      let guard = 0;
      while (s.miner.row < rail && guard++ < 100) {
        if (applyAction(s, "ride-down").ok) rides++;
      }
      expect(s.miner.row).toBe(rail);
      return rides;
    };
    expect(ridesToBottom(5)).toBeLessThan(ridesToBottom(1));
  });
});
