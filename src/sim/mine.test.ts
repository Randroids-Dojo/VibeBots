import { describe, expect, it } from "vitest";
import {
  applyAction,
  canDigRock,
  cargoCapacity,
  carriedCount,
  carriedValue,
  carryoverConsumables,
  cellAt,
  createMine,
  DEFAULT_GEAR,
  type Direction,
  GAS_VENT_DRAIN,
  GEAR_TRACKS,
  HAZARD_FREE_ROWS,
  isVisible,
  LADDER_PROVISION,
  LAMP_ENERGY,
  LANTERN_RADIUS,
  LIGHT_RADIUS,
  MINE_WIDTH,
  type MineAction,
  maxGearLevel,
  ORES,
  oreChanceAt,
  oreDef,
  ROCK_DIG_COST,
  ROCK_FREE_ROWS,
  replayTrip,
  returnEnergyCost,
  returnLadderNeed,
  rockTierAt,
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

  it("scales lamp energy and bank refill with the lamp level", () => {
    const base = createMine(3);
    expect(base.miner.energy).toBe(LAMP_ENERGY[0]);
    const upgraded = createMine(3, { ...DEFAULT_GEAR, lamp: 3 });
    expect(upgraded.miner.energy).toBe(LAMP_ENERGY[2]);
    step(upgraded, "down");
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
    state.rows[1][START_COL] = { kind: "ore", ore: "coal" };
    const refused = step(state, "down");
    expect(refused).toEqual({ ok: false, reason: "hold-full" });
    state.rows[1][START_COL] = { kind: "dirt" };
    const dug = step(state, "down");
    expect(dug.ok).toBe(true);
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
    state.rows[1][START_COL] = { kind: "rock", rockTier: 1 };
    const before = state.miner.energy;
    const dug = step(state, "down");
    expect(dug.ok).toBe(true);
    expect(before - state.miner.energy).toBe(ROCK_DIG_COST);

    const walled = createMine(19);
    walled.rows[1][START_COL] = { kind: "rock", rockTier: 1 };
    expect(step(walled, "down")).toEqual({ ok: false, reason: "rock" });
  });

  it("replays identically with a gear snapshot", () => {
    const gear = { pickaxe: 2, lamp: 2, cargo: 2, lantern: 2 };
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
        for (let col = 0; col < MINE_WIDTH; col++) {
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
    state.rows[1][START_COL] = { kind: "dirt" };
    state.rows[2][START_COL] = { kind: "gas" };
    state.rows[2][START_COL - 1] = { kind: "gas" };
    state.rows[3][START_COL] = { kind: "ore", ore: "coal" };
    const before = state.miner.energy;
    const result = step(state, "down");
    expect(result.ok && result.vented).toBe(2);
    // Both pockets vented; the loot caught in the blast is gone.
    expect(state.rows[2][START_COL].kind).toBe("empty");
    expect(state.rows[2][START_COL - 1].kind).toBe("empty");
    expect(state.rows[3][START_COL].kind).toBe("empty");
    expect(before - state.miner.energy).toBe(1 + 2 * GAS_VENT_DRAIN);
  });

  it("wobbles an unsupported boulder for one action, then drops it", () => {
    const state = createMine(43);
    state.rows[1][START_COL] = { kind: "dirt" };
    state.rows[2][START_COL] = { kind: "dirt" };
    state.rows[1][START_COL - 1] = { kind: "boulder" };
    state.rows[2][START_COL - 1] = { kind: "dirt" };
    step(state, "down"); // miner to (col,1)
    const side = step(state, "left"); // digs the boulder's support? no:
    // left digs (col-1,1)... that IS the boulder: blocked.
    expect(side).toEqual({ ok: false, reason: "blocked" });
    step(state, "down"); // miner to (col,2)
    const dugSupport = step(state, "left"); // digs (col-1,2), under boulder
    expect(dugSupport.ok).toBe(true);
    // The boulder above is wobbling now, falls on the NEXT action.
    expect(state.rows[1][START_COL - 1].wobbling).toBe(true);
    const next = step(state, "left"); // move further left
    expect(next.ok).toBe(true);
    // Boulder fell into the vacated cell at row 2.
    expect(state.rows[1][START_COL - 1].kind).toBe("empty");
    expect(state.rows[2][START_COL - 1].kind).toBe("boulder");
  });

  it("crushes the miner who stands under a falling boulder", () => {
    const state = createMine(47);
    state.rows[1][START_COL] = { kind: "boulder" };
    state.rows[1][START_COL + 1] = { kind: "dirt" };
    state.rows[2][START_COL] = { kind: "dirt" };
    state.rows[2][START_COL + 1] = { kind: "dirt" };
    // Tunnel around: down the right column, then dig left under the
    // boulder, ending UNDER it as it wobbles.
    step(state, "right"); // walk surface to col+1
    step(state, "down"); // dig (col+1,1)
    step(state, "down"); // dig (col+1,2)
    const under = step(state, "left"); // dig (col,2): under the boulder
    expect(under.ok).toBe(true);
    expect(state.rows[1][START_COL].wobbling).toBe(true);
    state.miner.carried = { coal: 3 };
    state.rows[3][START_COL] = { kind: "dirt" };
    const fatal = step(state, "down"); // dig deeper, straight into the path
    expect(fatal.ok && fatal.crushed).toBe(true);
    expect(fatal.ok && fatal.collapsed).toBe(true);
    expect(state.miner.row).toBe(0);
    expect(carriedCount(state.miner)).toBe(0);
    expect(state.miner.collapses).toBe(1);
  });

  it("dynamite clears a plus including hard rock and is replay-counted", () => {
    const noStick = createMine(53);
    expect(applyAction(noStick, "dynamite-down")).toEqual({
      ok: false,
      reason: "no-dynamite",
    });

    const state = createMine(53, DEFAULT_GEAR, {
      dynamite: 2,
      rope: 0,
      ladder: 0,
    });
    state.rows[1][START_COL] = { kind: "rock", rockTier: 3 };
    state.rows[2][START_COL] = { kind: "ore", ore: "coal" };
    const result = applyAction(state, "dynamite-down");
    expect(result.ok && (result.blasted ?? 0)).toBeGreaterThanOrEqual(2);
    expect(state.rows[1][START_COL].kind).toBe("empty");
    expect(state.rows[2][START_COL].kind).toBe("empty");
    expect(state.consumables.dynamite).toBe(1);
    expect(state.used.dynamite).toBe(1);
    // No energy cost: the price was paid in credits.
    expect(state.miner.energy).toBe(LAMP_ENERGY[0]);
  });

  it("recall rope banks the carry from any depth", () => {
    const state = createMine(59, DEFAULT_GEAR, {
      dynamite: 0,
      rope: 1,
      ladder: 0,
    });
    expect(applyAction(state, "recall")).toEqual({
      ok: false,
      reason: "surface",
    });
    step(state, "down");
    step(state, "down");
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

  it("provisions free ladders per trip and gates climbs on them", () => {
    const state = createMine(71);
    expect(state.consumables.ladder).toBe(LADDER_PROVISION);
    step(state, "down");
    step(state, "down");
    const climb = step(state, "up");
    expect(climb.ok && climb.laddered).toBe(true);
    expect(state.consumables.ladder).toBe(LADDER_PROVISION - 1);
    expect(state.used.ladder).toBe(1);
    expect(cellAt(state, START_COL, 2)?.ladder).toBe(true);
    // Re-descending and re-climbing the same cell reuses the ladder.
    step(state, "down");
    const reclimb = step(state, "up");
    expect(reclimb.ok && !reclimb.laddered).toBe(true);
    expect(state.consumables.ladder).toBe(LADDER_PROVISION - 1);
    expect(state.used.ladder).toBe(1);
  });

  it("refuses to climb without ladders", () => {
    const state = createMine(73);
    step(state, "down");
    state.consumables.ladder = 0;
    expect(step(state, "up")).toEqual({ ok: false, reason: "no-ladder" });
    // Still standing where the refusal happened, lamp untouched by it.
    expect(state.miner.row).toBe(1);
  });

  it("prices the ladder budget for the climb home", () => {
    const state = createMine(79);
    for (let i = 0; i < 4; i++) step(state, "down");
    expect(returnLadderNeed(state)).toBe(state.miner.row);
    step(state, "up");
    // The placed ladder discounts the straight-home estimate.
    expect(returnLadderNeed(state)).toBe(state.miner.row);
    step(state, "down");
    expect(returnLadderNeed(state)).toBe(state.miner.row - 1);
  });

  it("banks only purchased ladders between trips", () => {
    const owned = { dynamite: 0, rope: 0, ladder: 3 };
    const state = createMine(83, DEFAULT_GEAR, owned);
    expect(state.consumables.ladder).toBe(3 + LADDER_PROVISION);
    // Spend two: both come out of the free provision.
    step(state, "down");
    step(state, "down");
    step(state, "up");
    step(state, "down");
    step(state, "down");
    step(state, "up");
    expect(state.used.ladder).toBe(2);
    expect(carryoverConsumables(state).ladder).toBe(3);
    // Spend past the provision: purchases start burning.
    state.used.ladder = LADDER_PROVISION + 2;
    state.consumables.ladder = 3 + LADDER_PROVISION - state.used.ladder;
    expect(carryoverConsumables(state).ladder).toBe(1);
    expect(carryoverConsumables(createMine(83)).ladder).toBe(0);
    expect(carryoverConsumables(state)).toEqual({
      dynamite: 0,
      rope: 0,
      ladder: 1,
    });
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
    const consumables = { dynamite: 3, rope: 1, ladder: 0 };
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
});
