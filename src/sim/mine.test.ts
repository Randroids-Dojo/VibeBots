import { describe, expect, it } from "vitest";
import {
  activatePortalAction,
  applyAction,
  BAG_STACK_LIMIT,
  BASE_HITS,
  BATTERY_CHARGE,
  biomeAt,
  blastRadius,
  canDigRock,
  canJump,
  canPlacePlank,
  cargoCapacity,
  carriedCount,
  carriedStackCount,
  carriedValue,
  carryoverConsumables,
  cellAt,
  collectAction,
  collectablePlacements,
  countActiveBiomePortalsInDiff,
  countPlacedBeaconsInDiff,
  createMine,
  DEFAULT_GEAR,
  type Direction,
  dropOreAction,
  dynamiteBlastCells,
  dynamitePreviewCells,
  dynamiteTier,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  elevatorSegmentPrice,
  elevatorSpeedRows,
  exportDiff,
  FALL_DELAY_ACTIONS,
  FALLING_ROCK_MIN_HITS,
  findBeacon,
  findBeacons,
  findPortalBeacons,
  GAS_VENT_DRAIN,
  GEAR_TRACKS,
  gearTrackDef,
  gearUpgradeRequirements,
  HAZARD_FREE_ROWS,
  isVisible,
  LADDER_RECOVERY_FLOOR,
  LANTERN_RADIUS,
  LIGHT_RADIUS,
  lanternDistance,
  lightRadius,
  MINE_BALANCE_MAX_ROW,
  MINE_BOTTOM_ROW,
  type MineAction,
  type MineConsumables,
  type MineGear,
  type MineState,
  MOVE_COST,
  type MoveResult,
  maxGearLevel,
  NO_CONSUMABLES,
  normalizeBeaconLabel,
  normalizeGear,
  ORE_SWING_COST_STEP,
  ORE_TRACE_SHARE,
  ORES,
  type OreId,
  oreCellValueAt,
  oreChanceAt,
  oreDef,
  oreIdsForBiome,
  oreReserveAt,
  oreSwingCostFor,
  oreSwingYield,
  oreUnitsAt,
  PICKAXE_SWING_COST_STEP,
  PLANK_RECOVERY_FLOOR,
  portalWarpAction,
  ROCK_DIG_COST,
  ROCK_FREE_ROWS,
  recallRopeRange,
  refundRailSupportsInDiff,
  renameBeaconAction,
  replayTrip,
  returnEnergyCost,
  returnLadderNeed,
  rockTierAt,
  START_COL,
  START_ENERGY,
  STRATA,
  SWING_COST,
  safeFallRows,
  setCell,
  step,
  stratumAt,
  supportSalvageValue,
  swingCostFor,
  WARP_PAD_COL,
  type WorldDiff,
  warpRange,
} from "./mine";

/** Swing at a direction until the block breaks (or the action ends). */
function dig(state: MineState, dir: Direction): MoveResult {
  let res = step(state, dir);
  for (let i = 0; i < 40 && res.ok && res.cracked; i++) res = step(state, dir);
  return res;
}

/** A consumable snapshot with only the named counts set (rest zero). */
function stock(over: Partial<MineConsumables>): MineConsumables {
  return { ...NO_CONSUMABLES, ...over };
}

function expectedOreYield(
  seed: number,
  gear: Pick<MineGear, "pickaxe">,
  ore: OreId,
  row: number,
  col: number,
): number {
  let remaining = oreReserveAt(ore, row);
  let total = 0;
  while (remaining > 0) {
    const units = oreSwingYield(seed, gear, ore, row, col, remaining);
    total += units;
    remaining -= Math.max(1, units);
  }
  return total;
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
    // Dirt block totals still match the old single-swing economy, so
    // depth 1 costs exactly 1 energy at pickaxe 1.
    if (broke.ok && broke.dug === "dirt") {
      expect(state.miner.energy).toBeCloseTo(START_ENERGY - 1, 5);
    }
    // A better pickaxe needs fewer swings.
    const strong = createMine(137, { ...DEFAULT_GEAR, pickaxe: 3 });
    const strongEnergy = strong.miner.energy;
    const first = step(strong, "down");
    expect(first.ok && (first.cracked?.remaining ?? 0)).toBeLessThanOrEqual(2);
    expect(strongEnergy - strong.miner.energy).toBeCloseTo(
      SWING_COST.dirt + 2 * PICKAXE_SWING_COST_STEP,
      5,
    );
    expect(swingCostFor("dirt", { ...DEFAULT_GEAR, pickaxe: 3 })).toBeCloseTo(
      SWING_COST.dirt + 2 * PICKAXE_SWING_COST_STEP,
      5,
    );
    expect(PICKAXE_SWING_COST_STEP).toBe(0.1);
  });

  it("makes richer ore strikes cost noticeably more battery", () => {
    expect(ORE_SWING_COST_STEP).toBe(0.08);
    expect(oreSwingCostFor("coal", DEFAULT_GEAR)).toBeCloseTo(
      SWING_COST.ore,
      5,
    );
    expect(oreSwingCostFor("diamond", DEFAULT_GEAR)).toBeCloseTo(
      SWING_COST.ore + 5 * ORE_SWING_COST_STEP,
      5,
    );
    expect(oreSwingCostFor("core-crystal", DEFAULT_GEAR)).toBeCloseTo(
      SWING_COST.ore + 6 * ORE_SWING_COST_STEP,
      5,
    );
    expect(
      oreSwingCostFor("core-crystal", { ...DEFAULT_GEAR, pickaxe: 4 }),
    ).toBeCloseTo(
      SWING_COST.ore + 3 * PICKAXE_SWING_COST_STEP + 6 * ORE_SWING_COST_STEP,
      5,
    );
  });

  it("extends tool upgrades behind level and depth gates", () => {
    expect(maxGearLevel("pickaxe")).toBe(10);
    expect(maxGearLevel("battery")).toBe(10);
    expect(maxGearLevel("cargo")).toBe(10);
    expect(gearUpgradeRequirements("pickaxe", 9)).toEqual({
      playerLevel: 100,
      maxDepth: 820,
    });
    expect(gearUpgradeRequirements("warpcoil", 6)).toEqual({
      playerLevel: 100,
      maxDepth: 850,
    });
    expect(gearUpgradeRequirements("cargo", 9)).toEqual({
      playerLevel: 100,
      maxDepth: 850,
    });
    expect(BATTERY_CHARGE[BATTERY_CHARGE.length - 1]).toBe(820);
    expect(cargoCapacity(DEFAULT_GEAR)).toBe(4);
    expect(cargoCapacity({ ...DEFAULT_GEAR, cargo: 10 })).toBe(50);
    expect(lightRadius({ ...DEFAULT_GEAR, lantern: 8 })).toBe(17);
    expect(safeFallRows({ ...DEFAULT_GEAR, fall: 8 })).toBe(39);
    expect(warpRange({ ...DEFAULT_GEAR, warpcoil: 7 })).toBe(999);
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

  it("fills row 1000 with impenetrable metal cells", () => {
    const state = createMine(42, {
      ...DEFAULT_GEAR,
      elevator: MINE_BOTTOM_ROW + 200,
      elevatorSpeed: 10,
    });

    expect(cellAt(state, -100, MINE_BOTTOM_ROW)?.kind).toBe("metal");
    expect(cellAt(state, 0, MINE_BOTTOM_ROW)?.kind).toBe("metal");
    expect(cellAt(state, 100, MINE_BOTTOM_ROW)?.kind).toBe("metal");
    expect(cellAt(state, 0, MINE_BOTTOM_ROW + 1)).toBe(null);

    const fromOldDiff = createMine(42, DEFAULT_GEAR, NO_CONSUMABLES, [
      [0, MINE_BOTTOM_ROW, { kind: "empty", beacon: true }],
    ]);
    expect(cellAt(fromOldDiff, 0, MINE_BOTTOM_ROW)?.kind).toBe("metal");
    expect(countPlacedBeaconsInDiff(exportDiff(fromOldDiff))).toBe(0);

    state.miner.row = MINE_BOTTOM_ROW - 1;
    setCell(state, state.miner.col, state.miner.row, { kind: "empty" });
    expect(step(state, "down")).toEqual({ ok: false, reason: "blocked" });
    expect(state.miner.row).toBe(MINE_BOTTOM_ROW - 1);

    expect(
      dynamiteBlastCells(
        state,
        { col: state.miner.col, row: MINE_BOTTOM_ROW - 1 },
        1,
      ).some((coord) => coord.row >= MINE_BOTTOM_ROW),
    ).toBe(false);

    const lift = createMine(42, {
      ...DEFAULT_GEAR,
      elevator: MINE_BOTTOM_ROW + 200,
      elevatorSpeed: 10,
    });
    lift.miner.col = ELEVATOR_COL;
    for (let i = 0; i < 200; i++) applyAction(lift, "ride-down");
    expect(lift.miner.row).toBe(MINE_BOTTOM_ROW - 1);
    expect(applyAction(lift, "ride-down")).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  it("adds deeper rock tiers through the row 1000 goal", () => {
    expect(rockTierAt(23)).toBe(1);
    expect(rockTierAt(24)).toBe(2);
    expect(rockTierAt(140)).toBe(5);
    expect(rockTierAt(720)).toBe(9);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 9 }, 9)).toBe(false);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 10 }, 9)).toBe(true);
  });

  it("keeps ores inside their starting band and leaves trace odds deeper", () => {
    for (const seed of [3, 77, 901]) {
      const state = createMine(seed);
      for (let row = 1; row < 120; row++) {
        for (let col = -6; col <= 6; col++) {
          const cell = cellAt(state, col, row);
          if (cell?.kind === "ore" && cell.ore) {
            const def = oreDef(cell.ore);
            expect(row).toBeGreaterThanOrEqual(def.minRow);
          }
        }
      }
    }
    for (const ore of ORES) {
      if (!Number.isFinite(ore.maxRow)) continue;
      const trace = oreChanceAt(ore, ore.maxRow + 200);
      expect(trace).toBeGreaterThan(0);
      expect(trace).toBeLessThan(ore.peakChance);
    }
  });

  it("keeps total ore cell value on the intended tier curve", () => {
    const row = 1;
    expect(
      ORES.filter((ore) => ore.biome === "default").map((ore) =>
        oreCellValueAt(ore.id, row),
      ),
    ).toEqual([4, 5, 7, 9, 24, 54, 112]);
    expect(oreCellValueAt("core-crystal", MINE_BALANCE_MAX_ROW)).toBe(1344);
  });

  it("maps horizontal biome bands and ore pools by column", () => {
    expect(biomeAt(-101)).toBe("default");
    expect(biomeAt(-100)).toBe("winter");
    expect(biomeAt(-75)).toBe("winter");
    expect(biomeAt(-50)).toBe("winter");
    expect(biomeAt(-49)).toBe("default");
    expect(biomeAt(99)).toBe("default");
    expect(biomeAt(100)).toBe("highTech");
    expect(biomeAt(125)).toBe("highTech");
    expect(biomeAt(150)).toBe("highTech");
    expect(biomeAt(151)).toBe("default");
    expect(oreIdsForBiome("winter")).toContain("aurora-emerald");
    expect(oreIdsForBiome("highTech")).toContain("keyboard-matrix");
  });

  it("uses biome-only ore ids inside biome columns", () => {
    const state = createMine(912);
    for (const [col, biome] of [
      [-75, "winter"],
      [125, "highTech"],
    ] as const) {
      let checked = 0;
      for (let row = 1; row < 220; row++) {
        const cell = cellAt(state, col, row);
        if (cell?.kind !== "ore" || !cell.ore) continue;
        expect(oreDef(cell.ore).biome).toBe(biome);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }
    for (let row = 1; row < 220; row++) {
      const cell = cellAt(state, 0, row);
      if (cell?.kind === "ore" && cell.ore) {
        expect(oreDef(cell.ore).biome).toBe("default");
      }
    }
  });

  it("ramps ore chance as a trapezoid over the band", () => {
    const silver = oreDef("silver");
    expect(oreChanceAt(silver, silver.minRow - 1)).toBe(0);
    expect(oreChanceAt(silver, silver.peakStart)).toBe(silver.peakChance);
    expect(oreChanceAt(silver, silver.peakEnd)).toBe(silver.peakChance);
    expect(oreChanceAt(silver, silver.maxRow + 1)).toBeGreaterThan(0);
    const fadingIn = oreChanceAt(
      silver,
      Math.floor((silver.minRow + silver.peakStart) / 2),
    );
    expect(fadingIn).toBeGreaterThan(0);
    expect(fadingIn).toBeLessThan(silver.peakChance);
  });

  it("fades every band onto its trace floor with no dead row (F-041)", () => {
    for (const ore of ORES) {
      if (!Number.isFinite(ore.maxRow)) continue;
      const trace = ore.peakChance * ORE_TRACE_SHARE;
      // The boundary row itself sits on the floor, not at zero.
      expect(oreChanceAt(ore, ore.maxRow)).toBeCloseTo(trace, 12);
      expect(oreChanceAt(ore, ore.maxRow + 1)).toBeCloseTo(trace, 12);
      // The whole fade never dips below the floor: continuity, no jump.
      for (let row = ore.peakEnd; row <= ore.maxRow; row++) {
        expect(oreChanceAt(ore, row)).toBeGreaterThanOrEqual(trace);
      }
    }
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

  it("names strata by row without granting bonus vibes", () => {
    expect(stratumAt(0).name).toBe("Topsoil");
    expect(stratumAt(11).name).toBe("Topsoil");
    expect(stratumAt(12).name).toBe("Clay Beds");
    expect(stratumAt(48).name).toBe("Magma Verge");
    expect(stratumAt(500).name).toBe("Ion Mantle");
    expect(stratumAt(MINE_BALANCE_MAX_ROW).name).toBe("Depth 1000 Gate");
    expect(STRATA.map((stratum) => stratum.startRow)).toEqual([
      0, 12, 24, 36, 48, 64, 84, 110, 140, 220, 340, 500, 680, 880,
    ]);
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
      if (result.ok && (result.dug || result.cracked)) digs++;
      if (result.ok && result.oreHarvested) {
        oreChunks += result.oreHarvested.units;
        value +=
          oreDef(result.oreHarvested.ore).value * result.oreHarvested.units;
      }
    }
    expect(digs).toBeGreaterThan(0);
    expect(carriedCount(state.miner)).toBe(oreChunks);
    expect(carriedValue(state.miner)).toBe(value);
  });

  it("varies ore chunks per swing and clears after the reserve is depleted", () => {
    expect(oreUnitsAt(1)).toBe(1);
    expect(oreUnitsAt(80)).toBe(2);
    expect(oreUnitsAt(420)).toBe(6);
    expect(oreUnitsAt(MINE_BALANCE_MAX_ROW)).toBe(12);
    expect(oreReserveAt("diamond", 48)).toBe(18);
    expect(oreReserveAt("core-crystal", 64)).toBe(28);
    expect(oreDef("ruby").value).toBeGreaterThan(oreDef("emerald").value);
    expect(oreDef("diamond").value).toBeGreaterThan(oreDef("ruby").value);
    expect(oreDef("core-crystal").value).toBeGreaterThan(
      oreDef("diamond").value,
    );

    let foundDrySwing = false;
    let weakYield = 0;
    let strongYield = 0;
    for (let col = -10; col <= 10; col++) {
      const row = 180;
      const reserve = oreReserveAt("copper", row);
      weakYield += expectedOreYield(8, DEFAULT_GEAR, "copper", row, col);
      strongYield += expectedOreYield(
        8,
        { ...DEFAULT_GEAR, pickaxe: 5 },
        "copper",
        row,
        col,
      );
      for (let current = reserve; current > 1; current--) {
        const weak = oreSwingYield(
          8,
          DEFAULT_GEAR,
          "copper",
          row,
          col,
          current,
        );
        if (weak === 0) foundDrySwing = true;
      }
    }
    expect(foundDrySwing).toBe(true);
    expect(strongYield).toBeGreaterThan(weakYield);

    const state = createMine(8, { ...DEFAULT_GEAR, cargo: 4 });
    state.miner.col = START_COL;
    state.miner.row = 179;
    setCell(state, START_COL, 179, { kind: "empty" });
    setCell(state, START_COL, 180, { kind: "ore", ore: "copper" });
    setCell(state, START_COL, 181, { kind: "dirt" });
    const reserve = oreReserveAt("copper", 180);
    const first = step(state, "down");
    expect(first.ok && first.dug).toBe(null);
    const expectedFirstYield = oreSwingYield(
      8,
      state.gear,
      "copper",
      180,
      START_COL,
      reserve,
    );
    expect(first.ok && first.oreHarvested).toEqual(
      expectedFirstYield > 0
        ? {
            ore: "copper",
            units: expectedFirstYield,
            dropped:
              expectedFirstYield > cargoCapacity(state.gear)
                ? expectedFirstYield - cargoCapacity(state.gear)
                : undefined,
            remaining: reserve - Math.max(1, expectedFirstYield),
          }
        : undefined,
    );
    expect(state.miner.row).toBe(179);
    expect(cellAt(state, START_COL, 180)?.oreRemaining).toBe(
      reserve - Math.max(1, expectedFirstYield),
    );

    let mined = first;
    for (
      let guard = 0;
      guard < reserve && cellAt(state, START_COL, 180)?.kind === "ore";
      guard++
    ) {
      mined = step(state, "down");
    }
    expect(mined.ok).toBe(true);
    if (!mined.ok) throw new Error("ore did not clear");
    expect(mined.dugOre).toBe("copper");
    expect(mined.dugOreCount).toBeGreaterThan(0);
    expect(mined.oreHarvested?.remaining).toBe(0);
    expect(state.miner.row).toBe(180);
    const carried = state.miner.carried.copper ?? 0;
    const dropped =
      cellAt(state, START_COL, 180)?.drop?.copper ??
      cellAt(state, START_COL, 181)?.drop?.copper ??
      0;
    expect(carried + dropped).toBe(
      expectedOreYield(8, state.gear, "copper", 180, START_COL),
    );
    expect(carriedValue(state.miner)).toBe(carried * oreDef("copper").value);
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
    expect(state.miner.bankedCredits).toBe(
      2 * oreDef("silver").value + 3 * oreDef("coal").value,
    );
    expect(state.miner.lastSoldHaul).toEqual({
      ores: { silver: 2, coal: 3 },
      salvageCredits: 0,
      totalVibes: 2 * oreDef("silver").value + 3 * oreDef("coal").value,
    });
    expect(state.miner.energy).toBe(START_ENERGY);
  });

  it("collapses underground when energy runs out, losing the carry", () => {
    const state = createMine(13);
    dig(state, "down");
    expect(state.miner.row).toBe(1);
    state.miner.carried = { emerald: 2 };
    state.miner.energy = 0.2;
    // Any successful swing now drains the robot battery underground.
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

  it("counts successful bag drop actions during replay", () => {
    const diff: WorldDiff = [
      [START_COL, 1, { kind: "empty", drop: { coal: 1 } }],
    ];
    const replayed = replayTrip(
      31337,
      ["down", dropOreAction({ coal: 1 })],
      DEFAULT_GEAR,
      NO_CONSUMABLES,
      diff,
    );

    expect(replayed.bagDrops).toBe(1);
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
    expect(state.miner.col).not.toBe(ELEVATOR_COL);
    expect(applyAction(state, "ride-down")).toEqual({
      ok: false,
      reason: "blocked",
    });
    // Walk to the elevator. Rides are free and bore the rail span as they go.
    while (state.miner.col > ELEVATOR_COL) step(state, "left");
    const energyBeforeRide = state.miner.energy;
    // A ride covers the car's speed in rows; the UI repeats rides
    // automatically to the rail end.
    const carRows = elevatorSpeedRows(gear);
    expect(carRows).toBe(6);
    const ride = applyAction(state, "ride-down");
    expect(ride.ok).toBe(true);
    expect(state.miner.row).toBe(carRows);
    expect(state.miner.col).toBe(ELEVATOR_COL);
    expect(state.miner.energy).toBe(energyBeforeRide);
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
    // Off-elevator rides are refused even inside owned depth.
    state.miner.col = ELEVATOR_COL + 3;
    expect(applyAction(state, "ride-up")).toEqual({
      ok: false,
      reason: "blocked",
    });
    state.miner.col = ELEVATOR_COL;
    // Ride back up from the current elevator floor: free, banks only at the surface.
    state.miner.carried = { coal: 2 };
    applyAction(state, "ride-up");
    expect(state.miner.row).toBeGreaterThan(0);
    expect(state.miner.col).toBe(ELEVATOR_COL);
    expect(state.miner.bankedCredits).toBe(0);
    guard = 0;
    while (state.miner.row > 0 && guard++ < 50) applyAction(state, "ride-up");
    expect(state.miner.row).toBe(0);
    expect(state.miner.col).toBe(ELEVATOR_COL);
    expect(state.miner.bankedCredits).toBe(2);
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

  it("prices rail segments progressively through the row-1000 goal", () => {
    expect(elevatorSegmentPrice(1)).toBe(45);
    expect(elevatorSegmentPrice(2)).toBe(80);
    expect(elevatorSegmentPrice(3)).toBe(130);
    expect(elevatorSegmentPrice(12)).toBe(800);
    expect(elevatorSegmentPrice(34)).toBe(3315);
    expect(
      elevatorSegmentPrice(
        Math.ceil(MINE_BALANCE_MAX_ROW / ELEVATOR_SEGMENT_ROWS),
      ),
    ).toBe(7945);
  });

  it("plants multiple beacons and warps to a chosen target (REQ-029)", () => {
    const cons = stock({ beacon: 2 });
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
    const firstBeacon = { col: START_COL, row: 2 };
    expect(findBeacon(state)).toEqual({ col: START_COL, row: 2 });
    // Warp home banks from the beacon cell; warp down returns to it.
    state.miner.carried = { coal: 1 };
    expect(applyAction(state, "warp-home").ok).toBe(true);
    expect(state.miner.row).toBe(0);
    expect(state.miner.col).toBe(WARP_PAD_COL);
    expect(state.miner.bankedCredits).toBe(1);
    expect(
      applyAction(state, `warp-down:${firstBeacon.col},${firstBeacon.row}`),
    ).toEqual({
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
    });
    expect(state.miner.row).toBe(2);
    // Later placements remain alongside older anchors and sort first.
    dig(state, "down");
    expect(applyAction(state, "place-beacon").ok).toBe(true);
    expect(findBeacon(state)).toEqual({ col: START_COL, row: 3 });
    expect(findBeacons(state).map(({ col, row }) => ({ col, row }))).toEqual([
      { col: START_COL, row: 3 },
      { col: START_COL, row: 2 },
    ]);
    expect(state.consumables.beacon).toBe(0);
    expect(applyAction(state, "place-beacon")).toEqual({
      ok: false,
      reason: "no-beacon",
    });
    expect(applyAction(state, "warp-home").ok).toBe(true);
    expect(applyAction(state, "warp-down").ok).toBe(true);
    expect(state.miner.row).toBe(3);
  });

  it("activates authored biome portals and travels for free", () => {
    const state = createMine(330);
    expect(findPortalBeacons(state).map((portal) => portal.active)).toEqual([
      false,
      false,
    ]);
    state.miner.col = -75;
    expect(applyAction(state, activatePortalAction("winter")).ok).toBe(true);
    expect(findPortalBeacons(state)[0]?.active).toBe(true);
    expect(countPlacedBeaconsInDiff(exportDiff(state))).toBe(0);
    expect(applyAction(state, portalWarpAction("highTech"))).toEqual({
      ok: false,
      reason: "no-beacon",
    });

    state.miner.col = 125;
    expect(applyAction(state, activatePortalAction("highTech")).ok).toBe(true);
    expect(applyAction(state, portalWarpAction("winter")).ok).toBe(true);
    expect(state.miner.col).toBe(-75);
    expect(state.used.beacon).toBe(0);
    expect(applyAction(state, portalWarpAction("base")).ok).toBe(true);
    expect(state.miner.col).toBe(START_COL);
    expect(state.miner.row).toBe(0);

    const restored = createMine(
      330,
      DEFAULT_GEAR,
      NO_CONSUMABLES,
      exportDiff(state),
    );
    expect(findPortalBeacons(restored).map((portal) => portal.active)).toEqual([
      true,
      true,
    ]);
    expect(countActiveBiomePortalsInDiff(exportDiff(restored))).toBe(2);
  });

  it("replays portal trips identically", () => {
    const actions: MineAction[] = [
      "left",
      "left",
      ...Array.from({ length: 73 }, () => "left" as const),
      activatePortalAction("winter"),
      portalWarpAction("base"),
      ...Array.from({ length: 125 }, () => "right" as const),
      activatePortalAction("highTech"),
      portalWarpAction("winter"),
    ];
    const a = replayTrip(331, actions, DEFAULT_GEAR, NO_CONSUMABLES);
    const b = replayTrip(331, actions, DEFAULT_GEAR, NO_CONSUMABLES);
    expect(a.diff).toEqual(b.diff);
    const live = createMine(331);
    for (const action of actions) applyAction(live, action);
    expect(live.miner.col).toBe(-75);
    expect(live.miner.row).toBe(0);
  });

  it("renames placed beacons through replayed Warp Pad actions", () => {
    const cons = stock({ beacon: 1 });
    const state = createMine(246, DEFAULT_GEAR, cons);
    dig(state, "down");
    dig(state, "down");
    expect(applyAction(state, "place-beacon").ok).toBe(true);
    expect(applyAction(state, "warp-home").ok).toBe(true);
    const action = renameBeaconAction(
      { col: START_COL, row: 2 },
      "  Core   Door  ",
    );
    expect(action).toBe("rename-beacon:0,2,Core%20Door");
    expect(applyAction(state, action).ok).toBe(true);
    expect(findBeacons(state)[0]?.label).toBe("Core Door");
    expect(normalizeBeaconLabel("123456789012345")).toBe("123456789012");
    const clear = renameBeaconAction({ col: START_COL, row: 2 }, "   ");
    expect(applyAction(state, clear).ok).toBe(true);
    expect(findBeacons(state)[0]?.label).toBeNull();
  });

  it("refuses warps past the coil range until upgraded", () => {
    const cons = stock({ beacon: 1 });
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
    state.miner.col = WARP_PAD_COL;
    state.miner.row = 0;
    expect(applyAction(state, "warp-down")).toEqual({
      ok: false,
      reason: "out-of-range",
    });
    const coil = createMine(251, { ...DEFAULT_GEAR, warpcoil: 3 }, cons);
    expect(warpRange(coil.gear)).toBe(400);
  });

  it("refuses beacon placement deeper than the current warpcoil range", () => {
    const cons = stock({ beacon: 1 });
    const state = createMine(252, DEFAULT_GEAR, cons);
    state.miner.row = warpRange(state.gear) + 1;
    setCell(state, state.miner.col, state.miner.row, { kind: "empty" });

    expect(applyAction(state, "place-beacon")).toEqual({
      ok: false,
      reason: "out-of-range",
    });
    expect(state.consumables.beacon).toBe(1);
    expect(state.used.beacon).toBe(0);
    expect(findBeacon(state)).toBeNull();

    state.gear.warpcoil = 2;
    expect(applyAction(state, "place-beacon").ok).toBe(true);
    expect(state.consumables.beacon).toBe(0);
    expect(findBeacon(state)).toEqual({
      col: state.miner.col,
      row: 61,
    });
  });

  it("replays beacon trips identically", () => {
    const cons = stock({ beacon: 2 });
    const actions: MineAction[] = [
      "down",
      "down",
      "down",
      "down",
      "down",
      "down",
      "place-beacon",
      "down",
      "place-beacon",
      "warp-home",
    ];
    const state = createMine(257, DEFAULT_GEAR, cons);
    for (const a of actions) applyAction(state, a);
    const target = findBeacons(state)[0];
    expect(target).toBeDefined();
    if (!target) return;
    const rename = renameBeaconAction(target, "Deep Gate");
    actions.push(rename, `warp-down:${target.col},${target.row}`);
    applyAction(state, rename);
    applyAction(state, `warp-down:${target.col},${target.row}`);
    const replayed = replayTrip(257, actions, DEFAULT_GEAR, cons);
    expect(replayed.used.beacon).toBe(state.used.beacon);
    expect(replayed.diff).toEqual(exportDiff(state));
    expect(
      findBeacons(state).find((beacon) => beacon.row === target.row)?.label,
    ).toBe("Deep Gate");
    expect(replayTrip(257, actions, DEFAULT_GEAR, cons)).toEqual(replayed);
  });

  it("salvages placed beacons through edit pickup", () => {
    const state = createMine(258, DEFAULT_GEAR, stock({ beacon: 1 }));
    dig(state, "down");
    dig(state, "down");
    expect(applyAction(state, "place-beacon").ok).toBe(true);
    const target = findBeacon(state);
    expect(target).toEqual({ col: START_COL, row: 2 });
    expect(target).not.toBeNull();
    if (!target) return;
    const result = applyAction(
      state,
      collectAction([{ type: "beacon", col: target.col, row: target.row }]),
    );
    expect(result.ok && result.supportCollected).toEqual({ beacon: 1 });
    expect(result.ok && result.supportSalvageValue).toBe(
      supportSalvageValue("beacon"),
    );
    expect(cellAt(state, target.col, target.row)?.beacon).toBeUndefined();
    expect(cellAt(state, target.col, target.row)?.beaconOrder).toBeUndefined();
    expect(cellAt(state, target.col, target.row)?.beaconLabel).toBeUndefined();
    expect(findBeacons(state)).toEqual([]);
    expect(countPlacedBeaconsInDiff(exportDiff(state))).toBe(0);
    expect(state.consumables.beacon).toBe(0);
    expect(state.miner.carriedSalvageCredits).toBe(30);
  });

  it("escalates the deep: strata, magma, tier-4 rock, richer caches (REQ-030)", () => {
    // Strata extend past the Magma Verge as stamp goals.
    expect(stratumAt(70).name).toBe("Ashfall Galleries");
    expect(stratumAt(90).name).toBe("The Black Seam");
    expect(stratumAt(120).name).toBe("Echo Vaults");
    expect(stratumAt(200).name).toBe("Core Approach");
    // Rock tier 4 gates on pickaxe 5.
    expect(rockTierAt(95)).toBe(4);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 4 }, 4)).toBe(false);
    expect(canDigRock({ ...DEFAULT_GEAR, pickaxe: 5 }, 4)).toBe(true);
    expect(maxGearLevel("pickaxe")).toBe(10);
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

  it("scales battery charge and bank recharge with the battery level", () => {
    const base = createMine(3);
    expect(base.miner.energy).toBe(BATTERY_CHARGE[0]);
    const owned = stock({ ladder: 8 });
    const upgraded = createMine(3, { ...DEFAULT_GEAR, battery: 3 }, owned);
    expect(upgraded.miner.energy).toBe(BATTERY_CHARGE[2]);
    dig(upgraded, "down");
    step(upgraded, "up");
    expect(upgraded.miner.energy).toBe(BATTERY_CHARGE[2]);
  });

  it("normalizes legacy lamp gear snapshots into battery gear", () => {
    const { battery: _battery, ...legacy } = { ...DEFAULT_GEAR, lamp: 3 };
    const normalized = normalizeGear(legacy);
    expect(normalized.battery).toBe(3);
    expect(normalized.recall).toBe(1);
    expect(createMine(3, normalized).miner.energy).toBe(BATTERY_CHARGE[2]);
  });

  it("extends visibility with the lantern level in every direction", () => {
    const base = createMine(3);
    const lit = createMine(3, { ...DEFAULT_GEAR, lantern: 3 });
    const deepRow = LANTERN_RADIUS[2];
    expect(isVisible(base, START_COL, deepRow)).toBe(false);
    expect(isVisible(lit, START_COL, deepRow)).toBe(true);
    expect(isVisible(base, START_COL + lightRadius(base.gear) + 1, 0)).toBe(
      false,
    );
    expect(isVisible(lit, START_COL + lightRadius(lit.gear), 0)).toBe(true);
    expect(lanternDistance(lit, START_COL + 2, lit.miner.row + 3)).toBe(3);
  });

  it("digs ore with a full hold and drops the overflow on the nearest surface", () => {
    const state = createMine(19);
    state.miner.carried = { coal: cargoCapacity(state.gear) * BAG_STACK_LIMIT };
    setCell(state, START_COL, 1, { kind: "ore", ore: "coal" });
    setCell(state, START_COL, 2, { kind: "empty" });
    setCell(state, START_COL, 3, { kind: "dirt" });
    const expectedOverflow = expectedOreYield(
      19,
      state.gear,
      "coal",
      1,
      START_COL,
    );
    const dug = dig(state, "down");
    expect(dug.ok && dug.dug).toBe("ore");
    expect(dug.ok && dug.dugOre).toBe("coal");
    expect(dug.ok && dug.dugOreCount).toBe(1);
    expect(dug.ok && dug.oreHarvested).toEqual({
      ore: "coal",
      units: 1,
      dropped: 1,
      remaining: 0,
    });
    expect(dug.ok && dug.dropped).toBe(1);
    expect(dug.ok && dug.bagFull).toBe(true);
    expect(cellAt(state, START_COL, 1)?.drop).toBeUndefined();
    expect(cellAt(state, START_COL, 2)?.drop).toEqual({
      coal: expectedOverflow,
    });
    expect(carriedCount(state.miner)).toBe(
      cargoCapacity(state.gear) * BAG_STACK_LIMIT,
    );
    expect(carriedStackCount(state.miner)).toBe(cargoCapacity(state.gear));
  });

  it("drops floor ore again when the surface below it is dug out", () => {
    const state = createMine(19);
    state.miner.carried = { coal: cargoCapacity(state.gear) * BAG_STACK_LIMIT };
    setCell(state, START_COL, 1, { kind: "ore", ore: "coal" });
    setCell(state, START_COL, 2, { kind: "empty" });
    setCell(state, START_COL, 3, { kind: "dirt" });
    setCell(state, START_COL, 4, { kind: "dirt" });
    const expectedOverflow = expectedOreYield(
      19,
      state.gear,
      "coal",
      1,
      START_COL,
    );
    expect(dig(state, "down").ok).toBe(true);
    expect(step(state, "down").ok).toBe(true);
    const dugSupport = dig(state, "down");
    expect(dugSupport.ok && dugSupport.dug).toBe("dirt");
    expect(cellAt(state, START_COL, 2)?.drop).toBeUndefined();
    expect(cellAt(state, START_COL, 3)?.drop).toEqual({
      coal: expectedOverflow,
    });
  });

  it("partially picks up a floor pile and leaves the remainder", () => {
    const state = createMine(19);
    state.miner.carried = {
      coal: cargoCapacity(state.gear) * BAG_STACK_LIMIT - 2,
    };
    setCell(state, START_COL, 1, { kind: "empty", drop: { coal: 3 } });
    setCell(state, START_COL, 2, { kind: "dirt" });
    const picked = step(state, "down");
    expect(picked.ok && picked.pickedUp).toBe(2);
    expect(carriedCount(state.miner)).toBe(
      cargoCapacity(state.gear) * BAG_STACK_LIMIT,
    );
    expect(carriedStackCount(state.miner)).toBe(cargoCapacity(state.gear));
    expect(cellAt(state, START_COL, 1)?.drop).toEqual({ coal: 1 });
  });

  it("stacks matching ore without mixing resource types", () => {
    const state = createMine(191, { ...DEFAULT_GEAR, cargo: 2 });
    const initialCarried = {
      coal: 4,
      silver: 5,
      emerald: 5,
      ruby: 5,
      diamond: 5,
      "core-crystal": 5,
    };
    state.miner.carried = { ...initialCarried };
    expect(carriedStackCount(state.miner)).toBe(cargoCapacity(state.gear));

    setCell(state, START_COL, 1, { kind: "empty", drop: { coal: 3 } });
    setCell(state, START_COL, 2, { kind: "dirt" });
    const pickedCoal = step(state, "down");
    expect(pickedCoal.ok && pickedCoal.pickedUp).toBe(1);
    expect(state.miner.carried).toEqual({ ...initialCarried, coal: 5 });
    expect(cellAt(state, START_COL, 1)?.drop).toEqual({ coal: 2 });

    state.miner.row = 1;
    setCell(state, START_COL + 1, 1, {
      kind: "empty",
      drop: { copper: 2 },
    });
    setCell(state, START_COL + 1, 2, { kind: "dirt" });
    const blockedCopper = step(state, "right");
    expect(blockedCopper.ok && blockedCopper.pickedUp).toBeUndefined();
    expect(state.miner.carried).toEqual({ ...initialCarried, coal: 5 });
    expect(cellAt(state, START_COL + 1, 1)?.drop).toEqual({ copper: 2 });
  });

  it("drops carried ore into the current cell without auto-picking floor ore", () => {
    const state = createMine(191);
    state.miner.row = 1;
    state.miner.carried = { coal: 1, copper: 2 };
    setCell(state, START_COL, 1, {
      kind: "empty",
      drop: { copper: 3 },
    });

    const dropped = applyAction(state, dropOreAction({ coal: 1, copper: 1 }));

    expect(dropped.ok && dropped.droppedFromBag).toBe(2);
    expect(state.miner.carried).toEqual({ copper: 1 });
    expect(cellAt(state, START_COL, 1)?.drop).toEqual({
      coal: 1,
      copper: 4,
    });
    expect(cellAt(state, START_COL, 1)?.dropDeferred).toEqual({
      coal: 1,
      copper: 1,
    });
  });

  it("collects existing floor ore before ore the player just dropped", () => {
    const state = createMine(192);
    const capacity = cargoCapacity(state.gear);
    state.miner.col = START_COL - 1;
    state.miner.row = 1;
    state.miner.carried = { diamond: (capacity - 1) * BAG_STACK_LIMIT };
    setCell(state, START_COL - 1, 1, { kind: "empty" });
    setCell(state, START_COL - 1, 2, { kind: "dirt" });
    setCell(state, START_COL, 1, {
      kind: "empty",
      drop: { coal: 1, copper: 1 },
      dropDeferred: { copper: 1 },
    });
    setCell(state, START_COL, 2, { kind: "dirt" });

    const firstPickup = step(state, "right");

    expect(firstPickup.ok && firstPickup.pickedUp).toBe(1);
    expect(state.miner.carried).toEqual({
      diamond: (capacity - 1) * BAG_STACK_LIMIT,
      coal: 1,
    });
    expect(cellAt(state, START_COL, 1)?.drop).toEqual({ copper: 1 });
    expect(cellAt(state, START_COL, 1)?.dropDeferred).toEqual({ copper: 1 });

    state.miner.carried = {};
    expect(step(state, "left").ok).toBe(true);
    const secondPickup = step(state, "right");

    expect(secondPickup.ok && secondPickup.pickedUp).toBe(1);
    expect(state.miner.carried).toEqual({ copper: 1 });
    expect(cellAt(state, START_COL, 1)?.drop).toBeUndefined();
    expect(cellAt(state, START_COL, 1)?.dropDeferred).toBeUndefined();
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
      (BASE_HITS.rock - 1) *
        swingCostFor("rock", { ...DEFAULT_GEAR, pickaxe: 2 }),
      5,
    );
    void ROCK_DIG_COST;

    const walled = createMine(19);
    setCell(walled, START_COL, 1, { kind: "rock", rockTier: 1 });
    expect(step(walled, "down")).toEqual({
      ok: false,
      reason: "rock",
      requiredPickaxeLevel: 2,
    });
  });

  it("replays identically with a gear snapshot", () => {
    const gear = {
      pickaxe: 2,
      battery: 2,
      cargo: 2,
      lantern: 2,
      elevator: 0,
      warpcoil: 1,
    };
    // A push-your-luck descent: mostly down with lateral sweeps. The
    // bigger battery digs further before the collapse, so the snapshot
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
    expect(dug.ok && dug.fallingRockTriggered).toBe(true);
    expect(state.miner.col).toBe(c + 1);
    expect(cellAt(state, c + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS);
    // Step clear; the countdown ticks one per action with no early drop.
    const stepClear = step(state, "right"); // -> c+2
    expect(stepClear.ok).toBe(true);
    expect(stepClear.ok && stepClear.fallingRockTriggered).toBeUndefined();
    expect(cellAt(state, c + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS - 1);
    expect(cellAt(state, c + 1, 5)?.kind).toBe("boulder"); // still perched
    const stepDrop = step(state, "right"); // -> c+3: the countdown hits zero
    expect(stepDrop.ok).toBe(true);
    expect(stepDrop.ok && stepDrop.fallingRockTriggered).toBeUndefined();
    // The boulder fell into the vacated support cell and rests there.
    expect(cellAt(state, c + 1, 5)?.kind).toBe("empty");
    expect(cellAt(state, c + 1, 6)?.kind).toBe("boulder");
  });

  it("drops a falling rock chain together when its support is mined away", () => {
    const state = createMine(4301, { ...DEFAULT_GEAR, pickaxe: 4 });
    const c = START_COL;
    state.miner.row = 8;
    state.miner.col = c;
    setCell(state, c, 8, { kind: "empty" });
    setCell(state, c, 9, { kind: "dirt" });
    setCell(state, c + 1, 5, { kind: "rock", rockTier: 1 });
    setCell(state, c + 1, 6, { kind: "rock", rockTier: 1 });
    setCell(state, c + 1, 7, { kind: "boulder" });
    setCell(state, c + 1, 8, { kind: "dirt" });
    setCell(state, c + 1, 9, { kind: "empty" });
    setCell(state, c + 1, 10, { kind: "empty" });
    setCell(state, c + 1, 11, { kind: "dirt" });
    // Keep the corridor under SPAN_COLLAPSE_WIDTH so the wide-span rule
    // stays quiet and this test isolates the direct undercut chain.
    for (let dc = 2; dc <= 3; dc++) {
      setCell(state, c + dc, 8, { kind: "empty" });
      setCell(state, c + dc, 9, { kind: "dirt" });
    }

    const dug = step(state, "right");

    expect(dug.ok && dug.fallingRockWarnings).toEqual([
      { col: c + 1, row: 7 },
      { col: c + 1, row: 6 },
      { col: c + 1, row: 5 },
    ]);
    expect(cellAt(state, c + 1, 7)?.fallIn).toBe(FALL_DELAY_ACTIONS);
    expect(cellAt(state, c + 1, 6)?.fallIn).toBe(FALL_DELAY_ACTIONS);
    expect(cellAt(state, c + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS);

    expect(step(state, "right").ok).toBe(true);
    const dropped = step(state, "right");

    expect(dropped.ok && dropped.fallingRockTriggered).toBeUndefined();
    for (const row of [5, 6, 7]) {
      expect(cellAt(state, c + 1, row)?.kind).toBe("empty");
    }
    expect(cellAt(state, c + 1, 8)).toMatchObject({
      kind: "rock",
      fallen: true,
    });
    expect(cellAt(state, c + 1, 9)).toMatchObject({
      kind: "rock",
      fallen: true,
    });
    expect(cellAt(state, c + 1, 10)).toMatchObject({
      kind: "boulder",
      fallen: true,
    });
  });

  it("replays a falling rock chain deterministically", () => {
    const seed = 4302;
    const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
    const c = START_COL;
    const diff: WorldDiff = [
      [c, 1, { kind: "empty" }],
      [c, 2, { kind: "empty" }],
      [c, 3, { kind: "empty" }],
      [c, 4, { kind: "empty" }],
      [c, 5, { kind: "empty" }],
      [c, 6, { kind: "empty" }],
      [c, 7, { kind: "empty" }],
      [c, 8, { kind: "empty" }],
      [c, 9, { kind: "dirt" }],
      [c + 1, 5, { kind: "rock", rockTier: 1 }],
      [c + 1, 6, { kind: "rock", rockTier: 1 }],
      [c + 1, 7, { kind: "boulder" }],
      [c + 1, 8, { kind: "dirt" }],
      [c + 1, 9, { kind: "empty" }],
      [c + 1, 10, { kind: "empty" }],
      [c + 1, 11, { kind: "dirt" }],
      [c + 2, 8, { kind: "empty" }],
      [c + 2, 9, { kind: "dirt" }],
      [c + 3, 8, { kind: "empty" }],
      [c + 3, 9, { kind: "dirt" }],
    ];
    const actions: MineAction[] = ["down", "right", "right", "right"];
    const live = createMine(seed, gear, NO_CONSUMABLES, diff);
    for (const action of actions) applyAction(live, action);

    expect(cellAt(live, c + 1, 8)?.fallen).toBe(true);
    expect(cellAt(live, c + 1, 9)?.fallen).toBe(true);
    expect(cellAt(live, c + 1, 10)?.fallen).toBe(true);

    const replayed = replayTrip(seed, actions, gear, NO_CONSUMABLES, diff);
    expect(replayed.diff).toEqual(exportDiff(live));
  });

  it("mines the overhead cell without climbing and warns on a falling rock", () => {
    const state = createMine(431, { ...DEFAULT_GEAR, pickaxe: 4 });
    const c = START_COL;
    state.miner.row = 9;
    state.miner.col = c;
    state.consumables.ladder = 0;
    setCell(state, c, 9, { kind: "empty" });
    setCell(state, c, 8, { kind: "dirt" });
    setCell(state, c, 7, { kind: "rock", rockTier: 1 });
    setCell(state, c, 10, { kind: "dirt" });

    const result = step(state, "up");

    expect(result.ok).toBe(true);
    expect(result.ok && result.dug).toBe("dirt");
    expect(result.ok && result.dugAt).toEqual({ col: c, row: 8 });
    expect(result.ok && result.fallingRockTriggered).toBe(true);
    expect(result.ok && result.fallingRockWarnings).toEqual([
      { col: c, row: 7 },
    ]);
    expect(state.miner.col).toBe(c);
    expect(state.miner.row).toBe(9);
    expect(state.consumables.ladder).toBe(0);
    expect(cellAt(state, c, 8)?.kind).toBe("empty");
    expect(cellAt(state, c, 7)?.fallIn).toBe(FALL_DELAY_ACTIONS);
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

  it("crushes if a teetering rock overlaps the miner before it can move", () => {
    const state = createMine(470);
    const c = START_COL;
    state.miner.row = 6;
    state.miner.col = c;
    setCell(state, c, 6, { kind: "rock", rockTier: 1, fallIn: 1 });
    setCell(state, c, 7, { kind: "dirt" });
    state.miner.carried = { coal: 1 };

    const fatal = step(state, "down");

    expect(fatal.ok && fatal.crushed).toBe(true);
    expect(fatal.ok && fatal.collapsed).toBe(true);
    expect(fatal.ok && fatal.lost).toMatchObject({
      value: 1,
      col: c,
      row: 6,
    });
    expect(state.miner.row).toBe(0);
    expect(carriedCount(state.miner)).toBe(0);
  });

  it("crushes a miner who keeps digging under an undermined rock", () => {
    const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 5 };
    const state = createMine(6262, gear);
    const c = START_COL;
    for (let row = 1; row <= 6; row++) {
      setCell(state, c, row, { kind: "empty" });
    }
    setCell(state, c, 7, { kind: "dirt" });
    setCell(state, c + 1, 5, { kind: "rock", rockTier: 1 });
    setCell(state, c + 1, 6, { kind: "dirt" });
    setCell(state, c + 1, 7, { kind: "dirt" });
    setCell(state, c + 1, 8, { kind: "dirt" });
    setCell(state, c + 1, 9, { kind: "dirt" });

    expect(step(state, "down").ok).toBe(true);
    expect(step(state, "right").ok).toBe(true);
    expect(step(state, "down").ok).toBe(true);
    const fatal = step(state, "down");

    expect(fatal.ok && fatal.crushed).toBe(true);
    expect(fatal.ok && fatal.lost).toMatchObject({ col: c + 1, row: 8 });
    expect(state.miner.row).toBe(0);
  });

  it("drops crush cargo on the fallen rock rest cell", () => {
    const state = createMine(48);
    const c = START_COL;
    state.miner.row = 6;
    state.miner.col = c;
    setCell(state, c, 6, { kind: "empty" });
    setCell(state, c + 1, 5, { kind: "rock", rockTier: 1 });
    setCell(state, c + 1, 6, { kind: "dirt", plank: true });
    setCell(state, c + 1, 7, { kind: "empty" });
    setCell(state, c + 1, 8, { kind: "empty" });
    setCell(state, c + 1, 9, { kind: "dirt" });
    setCell(state, c + 2, 6, { kind: "dirt" });
    state.miner.carried = { coal: 2 };
    state.miner.carriedSalvageCredits = 4;
    state.miner.carriedParts = ["drive-wheel"];

    const dug = dig(state, "right");
    expect(dug.ok).toBe(true);
    expect(state.miner.col).toBe(c + 1);
    expect(state.miner.row).toBe(6);
    expect(cellAt(state, c + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS);

    expect(step(state, "right").ok).toBe(true);
    const fatal = step(state, "right");
    expect(fatal.ok && fatal.crushed).toBe(true);
    expect(fatal.ok && fatal.lost).toEqual({
      value: 6,
      parts: ["drive-wheel"],
      col: c + 1,
      row: 8,
    });
    expect(cellAt(state, c + 1, 6)?.bag).toBeUndefined();
    expect(cellAt(state, c + 1, 8)).toMatchObject({
      kind: "rock",
      fallen: true,
      bag: {
        ores: { coal: 2 },
        salvageCredits: 4,
        parts: ["drive-wheel"],
      },
    });
    expect(state.miner.row).toBe(0);
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
    expect(dug.ok && dug.fallingRockTriggered).toBeUndefined();
    // Inside the gentle top the rock never starts a countdown, so it
    // never falls: the first lesson stays safe.
    expect(cellAt(state, c + 1, HAZARD_FREE_ROWS)?.fallIn).toBeUndefined();
    expect(cellAt(state, c + 1, HAZARD_FREE_ROWS)?.kind).toBe("rock");
  });

  it("drops an undermined rock deterministically across a replay", () => {
    const seed = 777;
    const gear = { ...DEFAULT_GEAR, pickaxe: 4, fall: 2 };
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
      "down", // descend the empty shaft to row 6 by gravity
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

  it("mines falling rocks before and after they drop with the row pickaxe gate", () => {
    const c = START_COL;
    const ordinaryRock = createMine(108, { ...DEFAULT_GEAR, pickaxe: 5 });
    ordinaryRock.miner.col = c;
    ordinaryRock.miner.row = 6;
    setCell(ordinaryRock, c, 6, { kind: "empty" });
    setCell(ordinaryRock, c + 1, 6, { kind: "rock", rockTier: 1 });
    setCell(ordinaryRock, c + 1, 7, { kind: "dirt" });
    const minedOrdinary = step(ordinaryRock, "right");
    expect(minedOrdinary.ok && minedOrdinary.dug).toBe("rock");
    expect(ordinaryRock.miner.col).toBe(c + 1);

    const beforeDrop = createMine(109, { ...DEFAULT_GEAR, pickaxe: 5 });
    beforeDrop.miner.col = c;
    beforeDrop.miner.row = 6;
    setCell(beforeDrop, c, 6, { kind: "empty" });
    setCell(beforeDrop, c + 1, 6, {
      kind: "boulder",
      fallIn: FALL_DELAY_ACTIONS,
    });
    setCell(beforeDrop, c + 1, 7, { kind: "dirt" });

    const crackedBeforeDrop = step(beforeDrop, "right");
    expect(crackedBeforeDrop.ok && crackedBeforeDrop.cracked).toEqual({
      kind: "rock",
      remaining: FALLING_ROCK_MIN_HITS - 1,
    });
    expect(beforeDrop.miner.col).toBe(c);
    expect(cellAt(beforeDrop, c + 1, 6)?.hp).toBe(FALLING_ROCK_MIN_HITS - 1);
    const minedBeforeDrop = step(beforeDrop, "right");
    expect(minedBeforeDrop.ok && minedBeforeDrop.dug).toBe("rock");
    expect(beforeDrop.miner.col).toBe(c + 1);
    expect(cellAt(beforeDrop, c + 1, 6)?.kind).toBe("empty");

    const weakFallen = createMine(110, { ...DEFAULT_GEAR, pickaxe: 2 });
    weakFallen.miner.col = c;
    weakFallen.miner.row = 24;
    setCell(weakFallen, c, 24, { kind: "empty" });
    setCell(weakFallen, c + 1, 24, {
      kind: "rock",
      rockTier: 1,
      fallen: true,
    });
    setCell(weakFallen, c + 1, 25, { kind: "dirt" });
    expect(step(weakFallen, "right")).toEqual({
      ok: false,
      reason: "rock",
      requiredPickaxeLevel: 3,
    });

    const afterDrop = createMine(111, { ...DEFAULT_GEAR, pickaxe: 5 });
    afterDrop.miner.col = c;
    afterDrop.miner.row = 30;
    setCell(afterDrop, c, 30, { kind: "empty" });
    setCell(afterDrop, c + 1, 30, { kind: "boulder", fallen: true });
    setCell(afterDrop, c + 1, 31, { kind: "dirt" });

    const crackedAfterDrop = step(afterDrop, "right");
    expect(crackedAfterDrop.ok && crackedAfterDrop.cracked).toEqual({
      kind: "rock",
      remaining: FALLING_ROCK_MIN_HITS - 1,
    });
    expect(afterDrop.miner.col).toBe(c);
    const minedAfterDrop = step(afterDrop, "right");
    expect(minedAfterDrop.ok && minedAfterDrop.dug).toBe("rock");
    expect(afterDrop.miner.col).toBe(c + 1);
    expect(cellAt(afterDrop, c + 1, 30)?.kind).toBe("empty");
  });

  it("plants dynamite, then explodes once the miner moves clear", () => {
    const noStick = createMine(53);
    expect(applyAction(noStick, "dynamite-1")).toEqual({
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
    const planted = applyAction(state, "dynamite-1");
    expect(planted.ok && planted.dynamitePlanted).toEqual({
      col: START_COL,
      row: 0,
      tier: 1,
    });
    expect(planted.ok && (planted.blasted ?? 0)).toBe(0);
    expect(state.pendingDynamite).toEqual({ col: START_COL, row: 0, tier: 1 });
    expect(cellAt(state, START_COL, 1)?.kind).toBe("rock");

    const result = applyAction(state, "left");
    expect(result.ok && (result.blasted ?? 0)).toBeGreaterThanOrEqual(1);
    expect(result.ok && result.exploded).toEqual({
      col: START_COL,
      row: 0,
      tier: 1,
    });
    expect(cellAt(state, START_COL, 1)?.kind).toBe("empty");
    expect(state.pendingDynamite).toBeUndefined();
    expect(state.consumables.dynamite).toBe(1);
    expect(state.used.dynamite).toBe(1);
    // The surface step recharges the battery at the top after the charge pops.
    expect(state.miner.energy).toBe(BATTERY_CHARGE[0]);

    const replayed = replayTrip(
      53,
      ["dynamite-1", "left"],
      DEFAULT_GEAR,
      stock({ dynamite: 2 }),
    );
    expect(replayed.diff).toEqual(exportDiff(state));
  });

  it("dynamite harvests part of a rich ore reserve instead of clearing it", () => {
    const state = createMine(54, DEFAULT_GEAR, stock({ dynamite: 1 }));
    state.miner.col = START_COL;
    state.miner.row = 63;
    setCell(state, START_COL, 63, { kind: "empty" });
    setCell(state, START_COL - 1, 63, { kind: "empty" });
    setCell(state, START_COL - 1, 64, { kind: "dirt" });
    setCell(state, START_COL, 64, {
      kind: "ore",
      ore: "core-crystal",
    });
    const planted = applyAction(state, "dynamite-1");
    expect(planted.ok && planted.dynamitePlanted).toEqual({
      col: START_COL,
      row: 63,
      tier: 1,
    });

    const exploded = applyAction(state, "left");
    expect(exploded.ok && exploded.exploded).toEqual({
      col: START_COL,
      row: 63,
      tier: 1,
    });
    expect(exploded.ok && exploded.collected).toBe(8);
    expect(cellAt(state, START_COL, 64)).toMatchObject({
      kind: "ore",
      ore: "core-crystal",
      oreRemaining: 20,
    });
    expect(state.miner.carried["core-crystal"]).toBe(8);
  });

  it("recall rope banks the carry inside the owned range", () => {
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
    expect(state.miner.bankedCredits).toBe(3 * oreDef("silver").value);
    expect(state.used.rope).toBe(1);
    expect(applyAction(state, "recall")).toEqual({
      ok: false,
      reason: "surface",
    });
  });

  it("recall rope needs upgrades for deeper use", () => {
    const limited = createMine(60, DEFAULT_GEAR, stock({ rope: 1 }));
    limited.miner.row = recallRopeRange(DEFAULT_GEAR) + 1;

    expect(applyAction(limited, "recall")).toEqual({
      ok: false,
      reason: "rope-range",
    });
    expect(limited.consumables.rope).toBe(1);
    expect(limited.used.rope).toBe(0);

    const upgradedGear = { ...DEFAULT_GEAR, recall: 3 };
    const upgraded = createMine(60, upgradedGear, stock({ rope: 1 }));
    upgraded.miner.row = recallRopeRange(upgradedGear);
    upgraded.miner.carried = { copper: 2 };

    const result = applyAction(upgraded, "recall");
    expect(result.ok && result.recalled).toBe(true);
    expect(upgraded.miner.row).toBe(0);
    expect(upgraded.miner.bankedCredits).toBe(2 * oreDef("copper").value);
    expect(upgraded.used.rope).toBe(1);
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

  it("does not place ladders or planks while riding the elevator rail", () => {
    const gear = { ...DEFAULT_GEAR, elevator: ELEVATOR_SEGMENT_ROWS };
    const state = createMine(72, gear, stock({ ladder: 2, plank: 2 }));
    state.miner.col = ELEVATOR_COL;
    state.miner.row = 1;
    setCell(state, ELEVATOR_COL, 1, { kind: "empty" });
    setCell(state, ELEVATOR_COL, 0, { kind: "empty" });
    expect(applyAction(state, "up")).toEqual({ ok: false, reason: "blocked" });
    expect(state.used.ladder).toBe(0);
    expect(applyAction(state, "plank-right")).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(state.used.plank).toBe(0);
  });

  it("salvages visible placed ladders and planks for partial value", () => {
    const state = createMine(74, DEFAULT_GEAR, stock({ ladder: 2, plank: 2 }));
    dig(state, "down");
    dig(state, "down");
    step(state, "up");
    state.miner.col = START_COL - 1;
    state.miner.row = 1;
    setCell(state, START_COL - 1, 1, { kind: "empty" });
    setCell(state, START_COL, 1, { kind: "empty" });
    expect(applyAction(state, "plank-right").ok).toBe(true);
    expect(state.used.ladder).toBe(1);
    expect(state.used.plank).toBe(1);
    const visible = collectablePlacements(state);
    expect(visible).toEqual(
      expect.arrayContaining([
        { type: "ladder", col: START_COL, row: 2 },
        { type: "plank", col: START_COL, row: 1 },
      ]),
    );
    const result = applyAction(
      state,
      collectAction([
        { type: "ladder", col: START_COL, row: 2 },
        { type: "plank", col: START_COL, row: 1 },
      ]),
    );
    expect(result.ok && result.supportCollected).toEqual({
      ladder: 1,
      plank: 1,
    });
    expect(result.ok && result.supportSalvageValue).toBe(2);
    expect(cellAt(state, START_COL, 2)?.ladder).toBeUndefined();
    expect(cellAt(state, START_COL, 1)?.plank).toBeUndefined();
    expect(state.consumables.ladder).toBe(1);
    expect(state.consumables.plank).toBe(1);
    expect(state.used.ladder).toBe(1);
    expect(state.used.plank).toBe(1);
    expect(state.miner.carriedSalvageCredits).toBe(2);
  });

  it("salvages only supports in the miner's adjacent 3x3 range", () => {
    const state = createMine(75, DEFAULT_GEAR, stock({}));
    state.miner.col = START_COL;
    state.miner.row = 2;
    setCell(state, START_COL, 2, { kind: "empty" });
    setCell(state, START_COL + 1, 2, { kind: "empty", ladder: true });
    setCell(state, START_COL + 2, 2, { kind: "empty", plank: true });

    expect(collectablePlacements(state)).toEqual([
      { type: "ladder", col: START_COL + 1, row: 2 },
    ]);
    expect(
      applyAction(
        state,
        collectAction([{ type: "plank", col: START_COL + 2, row: 2 }]),
      ),
    ).toEqual({ ok: false, reason: "blocked" });
    expect(cellAt(state, START_COL + 2, 2)?.plank).toBe(true);
  });

  it("refunds supports covered by new elevator rail depth", () => {
    const diff: WorldDiff = [
      [ELEVATOR_COL, 1, { kind: "empty", ladder: true }],
      [ELEVATOR_COL, 2, { kind: "empty", ladder: true }],
      [ELEVATOR_COL, 3, { kind: "empty", plank: true }],
      [ELEVATOR_COL - 1, 1, { kind: "empty", ladder: true }],
      [
        ELEVATOR_COL,
        ELEVATOR_SEGMENT_ROWS + 1,
        { kind: "empty", ladder: true, plank: true },
      ],
    ];
    const refund = refundRailSupportsInDiff(diff, 0, ELEVATOR_SEGMENT_ROWS);
    expect(refund.refunded).toEqual({ ladder: 2, plank: 1 });
    const next = createMine(76, DEFAULT_GEAR, NO_CONSUMABLES, refund.diff);
    expect(cellAt(next, ELEVATOR_COL, 1)?.ladder).toBeUndefined();
    expect(cellAt(next, ELEVATOR_COL, 2)?.ladder).toBeUndefined();
    expect(cellAt(next, ELEVATOR_COL, 3)?.plank).toBeUndefined();
    expect(cellAt(next, ELEVATOR_COL - 1, 1)?.ladder).toBe(true);
    expect(cellAt(next, ELEVATOR_COL, ELEVATOR_SEGMENT_ROWS + 1)?.ladder).toBe(
      true,
    );
    expect(cellAt(next, ELEVATOR_COL, ELEVATOR_SEGMENT_ROWS + 1)?.plank).toBe(
      true,
    );
  });

  it("refills ladders and planks up to the floor on death", () => {
    const owned = stock({ ladder: 2, plank: 1 });
    const state = createMine(91, DEFAULT_GEAR, owned);
    expect(state.consumables.ladder).toBe(2);
    expect(state.consumables.plank).toBe(1);
    // Drop below ground, then swing with a dead battery: a death (not a
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

  it("drops a recoverable bag on battery death", () => {
    const state = createMine(91);
    setCell(state, START_COL, 1, { kind: "empty" });
    setCell(state, START_COL, 2, { kind: "empty" });
    setCell(state, START_COL, 3, { kind: "dirt" });
    expect(step(state, "down").ok).toBe(true);
    state.miner.carried = { coal: 2 };
    state.miner.carriedSalvageCredits = 3;
    state.miner.carriedParts = ["drive-wheel"];
    state.miner.energy = 0;

    const death = step(state, "down");
    expect(death.ok && death.collapsed).toBe(true);
    expect(death.ok && death.lost).toEqual({
      value: 5,
      parts: ["drive-wheel"],
      col: START_COL,
      row: 2,
    });
    expect(state.miner.row).toBe(0);
    expect(state.miner.carried).toEqual({});
    expect(state.miner.carriedSalvageCredits).toBe(0);
    expect(state.miner.carriedParts).toEqual([]);
    expect(cellAt(state, START_COL, 2)?.bag).toEqual({
      ores: { coal: 2 },
      salvageCredits: 3,
      parts: ["drive-wheel"],
    });

    const recovered = step(state, "down");
    expect(recovered.ok && recovered.pickedUpBag).toEqual({
      value: 5,
      parts: 1,
    });
    expect(cellAt(state, START_COL, 2)?.bag).toBeUndefined();
    expect(state.miner.carried).toEqual({ coal: 2 });
    expect(state.miner.carriedSalvageCredits).toBe(3);
    expect(state.miner.carriedParts).toEqual(["drive-wheel"]);
    expect(state.miner.lostCargo).toBeUndefined();
  });

  it("drops a recoverable bag when its support cell is mined away", () => {
    const state = createMine(94);
    const col = START_COL + 2;
    setCell(state, col, 1, {
      kind: "empty",
      bag: {
        ores: { coal: 1 },
        salvageCredits: 2,
        parts: ["drive-wheel"],
      },
    });
    setCell(state, col, 2, { kind: "dirt" });
    setCell(state, col, 3, { kind: "empty" });
    setCell(state, col, 4, { kind: "dirt" });
    state.miner.col = START_COL - 2;
    state.miner.row = 2;
    setCell(state, START_COL - 2, 2, { kind: "empty" });
    setCell(state, START_COL - 2, 3, { kind: "dirt" });
    setCell(state, START_COL - 3, 2, { kind: "empty" });
    setCell(state, START_COL - 3, 3, { kind: "dirt" });
    state.pendingDynamite = { col, row: 2, tier: 1 };
    state.miner.lostCargo = {
      value: 3,
      parts: ["drive-wheel"],
      col,
      row: 1,
    };

    const blasted = applyAction(state, "left");
    expect(blasted.ok && blasted.exploded).toEqual({ col, row: 2, tier: 1 });
    expect(cellAt(state, col, 1)?.bag).toBeUndefined();
    expect(cellAt(state, col, 3)?.bag).toEqual({
      ores: { coal: 1 },
      salvageCredits: 2,
      parts: ["drive-wheel"],
    });
    expect(state.miner.lostCargo).toEqual({
      value: 3,
      parts: ["drive-wheel"],
      col,
      row: 3,
    });
  });

  it("drops a recoverable bag when the ladder supporting it is picked up", () => {
    const state = createMine(95);
    const col = START_COL;
    state.miner.col = col + 1;
    state.miner.row = 2;
    setCell(state, col + 1, 2, { kind: "empty" });
    setCell(state, col + 1, 3, { kind: "dirt" });
    setCell(state, col, 1, {
      kind: "empty",
      bag: {
        ores: { copper: 2 },
        salvageCredits: 0,
        parts: [],
      },
    });
    setCell(state, col, 2, { kind: "empty", ladder: true });
    setCell(state, col, 3, { kind: "empty" });
    setCell(state, col, 4, { kind: "dirt" });

    const collected = applyAction(
      state,
      collectAction([{ type: "ladder", col, row: 2 }]),
    );
    expect(collected.ok && collected.supportCollected).toEqual({ ladder: 1 });
    expect(cellAt(state, col, 1)?.bag).toBeUndefined();
    expect(cellAt(state, col, 3)?.bag).toEqual({
      ores: { copper: 2 },
      salvageCredits: 0,
      parts: [],
    });
  });

  it("drops a recoverable bag when its plank support is picked up", () => {
    const state = createMine(96);
    const col = START_COL;
    state.miner.col = col + 1;
    state.miner.row = 1;
    setCell(state, col + 1, 1, { kind: "empty" });
    setCell(state, col + 1, 2, { kind: "dirt" });
    setCell(state, col, 1, {
      kind: "empty",
      plank: true,
      bag: {
        ores: { silver: 1 },
        salvageCredits: 1,
        parts: [],
      },
    });
    setCell(state, col, 2, { kind: "empty" });
    setCell(state, col, 3, { kind: "dirt" });

    const collected = applyAction(
      state,
      collectAction([{ type: "plank", col, row: 1 }]),
    );
    expect(collected.ok && collected.supportCollected).toEqual({ plank: 1 });
    expect(cellAt(state, col, 1)?.bag).toBeUndefined();
    expect(cellAt(state, col, 2)?.bag).toEqual({
      ores: { silver: 1 },
      salvageCredits: 1,
      parts: [],
    });
  });

  it("drops a ladder when its bottom support is mined away", () => {
    const state = createMine(97, { ...DEFAULT_GEAR, pickaxe: 4 });
    const col = START_COL;
    state.miner.col = col;
    state.miner.row = 2;
    setCell(state, col, 2, { kind: "empty" });
    setCell(state, col, 3, { kind: "dirt" });
    setCell(state, col + 1, 1, { kind: "empty", ladder: true });
    setCell(state, col + 1, 2, { kind: "dirt" });
    setCell(state, col + 1, 3, { kind: "empty" });
    setCell(state, col + 1, 4, { kind: "dirt" });

    const result = step(state, "right");

    expect(result.ok && result.dug).toBe("dirt");
    expect(result.ok && result.ladderFalls).toEqual([
      { from: { col: col + 1, row: 1 }, to: { col: col + 1, row: 3 } },
    ]);
    expect(cellAt(state, col + 1, 1)?.ladder).toBeUndefined();
    expect(cellAt(state, col + 1, 3)?.ladder).toBe(true);
    expect(state.miner.col).toBe(col + 1);
    expect(state.miner.row).toBe(2);
  });

  it("settles stacked unsupported ladders bottom-up", () => {
    const state = createMine(98, { ...DEFAULT_GEAR, pickaxe: 4 });
    const col = START_COL;
    state.miner.col = col;
    state.miner.row = 3;
    setCell(state, col, 3, { kind: "empty" });
    setCell(state, col, 4, { kind: "dirt" });
    setCell(state, col + 1, 1, { kind: "empty", ladder: true });
    setCell(state, col + 1, 2, { kind: "empty", ladder: true });
    setCell(state, col + 1, 3, { kind: "dirt" });
    setCell(state, col + 1, 4, { kind: "empty" });
    setCell(state, col + 1, 5, { kind: "dirt" });

    const result = step(state, "right");

    expect(result.ok && result.dug).toBe("dirt");
    expect(result.ok && result.ladderFalls).toEqual([
      { from: { col: col + 1, row: 2 }, to: { col: col + 1, row: 4 } },
      { from: { col: col + 1, row: 1 }, to: { col: col + 1, row: 3 } },
    ]);
    expect(cellAt(state, col + 1, 1)?.ladder).toBeUndefined();
    expect(cellAt(state, col + 1, 2)?.ladder).toBeUndefined();
    expect(cellAt(state, col + 1, 3)?.ladder).toBe(true);
    expect(cellAt(state, col + 1, 4)?.ladder).toBe(true);
    const sameSetup = createMine(98, { ...DEFAULT_GEAR, pickaxe: 4 });
    sameSetup.miner.col = col;
    sameSetup.miner.row = 3;
    setCell(sameSetup, col, 3, { kind: "empty" });
    setCell(sameSetup, col, 4, { kind: "dirt" });
    setCell(sameSetup, col + 1, 1, { kind: "empty", ladder: true });
    setCell(sameSetup, col + 1, 2, { kind: "empty", ladder: true });
    setCell(sameSetup, col + 1, 3, { kind: "dirt" });
    setCell(sameSetup, col + 1, 4, { kind: "empty" });
    setCell(sameSetup, col + 1, 5, { kind: "dirt" });
    expect(step(sameSetup, "right").ok).toBe(true);
    expect(exportDiff(sameSetup)).toEqual(exportDiff(state));
  });

  it("settles a ladder chain when its bottom ladder is salvaged", () => {
    const state = createMine(99);
    const col = START_COL;
    state.miner.col = col;
    state.miner.row = 3;
    setCell(state, col, 1, { kind: "empty", ladder: true });
    setCell(state, col, 2, { kind: "empty", ladder: true });
    setCell(state, col, 3, { kind: "empty", ladder: true });
    setCell(state, col, 4, { kind: "empty" });
    setCell(state, col, 5, { kind: "dirt" });

    const result = applyAction(state, "collect-ladder");

    expect(result.ok && result.collectedLadder).toBe(true);
    expect(result.ok && result.ladderFalls).toEqual([
      { from: { col, row: 2 }, to: { col, row: 4 } },
      { from: { col, row: 1 }, to: { col, row: 3 } },
    ]);
    expect(cellAt(state, col, 1)?.ladder).toBeUndefined();
    expect(cellAt(state, col, 2)?.ladder).toBeUndefined();
    expect(cellAt(state, col, 3)?.ladder).toBe(true);
    expect(cellAt(state, col, 4)?.ladder).toBe(true);
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
    // Still standing where the refusal happened, battery untouched by it.
    expect(state.miner.row).toBe(1);
  });

  it("jump jets lift one empty row without placing a ladder", () => {
    const state = createMine(2026062001, DEFAULT_GEAR, stock({ ladder: 0 }));
    const c = START_COL;
    state.miner.row = 2;
    state.miner.col = c;
    setCell(state, c, 1, { kind: "empty" });
    setCell(state, c, 2, { kind: "empty" });
    setCell(state, c, 3, { kind: "dirt" });
    setCell(state, c + 1, 1, { kind: "empty" });
    setCell(state, c + 1, 2, { kind: "empty" });
    setCell(state, c + 1, 3, { kind: "dirt" });

    expect(canJump(state)).toBe(true);
    const jumped = applyAction(state, "jump");

    expect(jumped.ok && jumped.jumped).toEqual({ col: c, row: 1 });
    expect(state.miner.row).toBe(1);
    expect(state.jumpHover).toBe(true);
    expect(state.consumables.ladder).toBe(0);
    expect(state.used.ladder).toBe(0);
    expect(cellAt(state, c, 2)?.ladder).toBeUndefined();
    expect(state.miner.energy).toBeCloseTo(START_ENERGY - MOVE_COST, 5);
    expect(returnLadderNeed(state)).toBe(1);

    const drift = applyAction(state, "right");

    expect(drift.ok && drift.fell).toBe(1);
    expect(state.jumpHover).toBe(false);
    expect(state.miner.col).toBe(c + 1);
    expect(state.miner.row).toBe(2);
  });

  it("jump jets cannot chain upward", () => {
    const state = createMine(2026062002);
    const c = START_COL;
    state.miner.row = 2;
    setCell(state, c, 1, { kind: "empty" });
    setCell(state, c, 2, { kind: "empty" });
    setCell(state, c, 3, { kind: "dirt" });

    expect(applyAction(state, "jump").ok).toBe(true);
    expect(applyAction(state, "jump")).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(state.miner.row).toBe(1);
    expect(state.jumpHover).toBe(true);
  });

  it("jump jets stay in hover through blocked moves", () => {
    const state = createMine(2026062004, DEFAULT_GEAR, stock({ ladder: 0 }));
    const c = START_COL;
    state.miner.row = 2;
    setCell(state, c, 0, { kind: "empty" });
    setCell(state, c, 1, { kind: "empty" });
    setCell(state, c, 2, { kind: "empty" });
    setCell(state, c, 3, { kind: "dirt" });
    setCell(state, c + 1, 1, { kind: "empty" });
    setCell(state, c + 1, 2, { kind: "empty" });
    setCell(state, c + 1, 3, { kind: "dirt" });

    expect(applyAction(state, "jump").ok).toBe(true);
    expect(applyAction(state, "up")).toEqual({
      ok: false,
      reason: "no-ladder",
    });
    expect(state.miner.row).toBe(1);
    expect(state.jumpHover).toBe(true);
    expect(applyAction(state, "jump")).toEqual({
      ok: false,
      reason: "blocked",
    });

    const drift = applyAction(state, "right");

    expect(drift.ok && drift.fell).toBe(1);
    expect(state.jumpHover).toBe(false);
    expect(state.miner.row).toBe(2);
  });

  it("replays jump jet trips identically", () => {
    const seed = 2026062003;
    const base = createMine(seed);
    const c = START_COL;
    setCell(base, c, 1, { kind: "empty" });
    setCell(base, c, 2, { kind: "empty" });
    setCell(base, c, 3, { kind: "dirt" });
    setCell(base, c + 1, 1, { kind: "empty" });
    setCell(base, c + 1, 2, { kind: "empty" });
    setCell(base, c + 1, 3, { kind: "dirt" });
    const diff = exportDiff(base);
    const live = createMine(seed, DEFAULT_GEAR, NO_CONSUMABLES, diff);
    live.miner.row = 2;
    live.miner.col = c;
    const actions: MineAction[] = ["jump", "right"];
    for (const action of actions) applyAction(live, action);

    const replayed = createMine(seed, DEFAULT_GEAR, NO_CONSUMABLES, diff);
    replayed.miner.row = 2;
    replayed.miner.col = c;
    for (const action of actions) applyAction(replayed, action);

    expect(replayed.miner.row).toBe(live.miner.row);
    expect(replayed.miner.col).toBe(live.miner.col);
    expect(replayed.used.ladder).toBe(0);
    expect(exportDiff(replayed)).toEqual(exportDiff(live));
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
    // The first ladder drops with the opened shaft and can be reused.
    dig(state, "down");
    dig(state, "down");
    step(state, "up");
    step(state, "down");
    dig(state, "down");
    step(state, "up");
    expect(state.used.ladder).toBe(1);
    // Nothing was granted (no death), so the leftover purchased stock banks.
    expect(carryoverConsumables(state).ladder).toBe(2);
    expect(carryoverConsumables(createMine(83)).ladder).toBe(0);
    expect(carryoverConsumables(state)).toEqual({
      dynamite: 0,
      rope: 0,
      ladder: 2,
      plank: 0,
      beacon: 0,
    });
  });

  function lateralGapState(planks: number) {
    const state = createMine(101, DEFAULT_GEAR, stock({ plank: planks }));
    const c = START_COL;
    state.miner.col = c - 1;
    state.miner.row = 1;
    setCell(state, c - 1, 1, { kind: "empty" });
    setCell(state, c - 1, 2, { kind: "dirt" });
    setCell(state, c, 1, { kind: "empty" });
    setCell(state, c, 2, { kind: "empty" });
    setCell(state, c, 3, { kind: "dirt" });
    return state;
  }

  it("places planks explicitly before crossing lateral gaps", () => {
    const state = lateralGapState(4);
    expect(state.used.plank).toBe(0);
    expect(canPlacePlank(state, "right")).toBe(true);
    const placed = applyAction(state, "plank-right");
    expect(placed.ok && placed.plankPlaced).toEqual({
      col: START_COL,
      row: 1,
    });
    expect(state.consumables.plank).toBe(PLANK_RECOVERY_FLOOR - 1);
    expect(state.used.plank).toBe(1);
    expect(cellAt(state, START_COL, 1)?.plank).toBe(true);
    const cross = step(state, "right");
    expect(cross.ok && !cross.planked).toBe(true);
    expect(cross.ok && cross.fell).toBeUndefined();
    expect(state.miner.row).toBe(1);
    // Re-crossing the planked cell is free.
    step(state, "left");
    const recross = step(state, "right");
    expect(recross.ok && !recross.planked).toBe(true);
    expect(state.used.plank).toBe(1);
  });

  it("falls through a lateral gap instead of refusing without planks", () => {
    const state = lateralGapState(0);
    const energy = state.miner.energy;
    const result = step(state, "right");
    expect(result.ok && result.fell).toBe(1);
    expect(state.miner.col).toBe(START_COL);
    expect(state.miner.row).toBe(2);
    expect(state.miner.energy).toBe(energy - MOVE_COST);
    expect(state.used.plank).toBe(0);
  });

  function lateralDropState(dropCells: number, gear = DEFAULT_GEAR) {
    const state = createMine(115, gear);
    const c = START_COL;
    state.miner.col = c - 1;
    state.miner.row = 1;
    state.miner.carried = { coal: 2 };
    setCell(state, c - 1, 1, { kind: "empty" });
    setCell(state, c - 1, 2, { kind: "dirt" });
    for (let row = 1; row <= dropCells + 1; row++) {
      setCell(state, c, row, { kind: "empty" });
    }
    setCell(state, c, dropCells + 2, { kind: "dirt" });
    return state;
  }

  it("free falls until landing and survives up to the fall limit", () => {
    const state = lateralDropState(4);
    const result = step(state, "right");
    expect(result.ok && result.fell).toBe(4);
    expect(result.ok && result.collapsed).toBe(false);
    expect(state.miner.col).toBe(START_COL);
    expect(state.miner.row).toBe(5);
    expect(state.miner.carried.coal).toBe(2);
  });

  it("dies when a free fall exceeds the fall limit", () => {
    expect(safeFallRows(DEFAULT_GEAR)).toBe(4);
    const state = lateralDropState(5);
    const result = step(state, "right");
    expect(result.ok && result.fell).toBe(5);
    expect(result.ok && result.collapsed).toBe(true);
    expect(result.ok && result.crushed).toBe(true);
    expect(result.ok && result.fallFatal).toBe(true);
    expect(result.ok && result.lost?.value).toBe(2);
    expect(state.miner.row).toBe(0);
    expect(state.miner.col).toBe(START_COL);
    expect(state.miner.carried).toEqual({});
    expect(state.consumables.ladder).toBe(LADDER_RECOVERY_FLOOR);
    expect(state.consumables.plank).toBe(PLANK_RECOVERY_FLOOR);
  });

  it("fall harness upgrades raise the fatal fall distance", () => {
    const gear = { ...DEFAULT_GEAR, fall: 2 };
    expect(safeFallRows(gear)).toBe(6);
    const survived = lateralDropState(6, gear);
    const ok = step(survived, "right");
    expect(ok.ok && ok.collapsed).toBe(false);
    expect(survived.miner.row).toBe(7);

    const killed = lateralDropState(7, gear);
    const dead = step(killed, "right");
    expect(dead.ok && dead.fell).toBe(7);
    expect(dead.ok && dead.collapsed).toBe(true);
    expect(dead.ok && dead.fallFatal).toBe(true);
  });

  it("pre-places a plank under a diggable facing cell", () => {
    const state = createMine(105, DEFAULT_GEAR, stock({ plank: 1 }));
    state.miner.col = START_COL;
    state.miner.row = 1;
    setCell(state, START_COL, 1, { kind: "empty" });
    setCell(state, START_COL + 1, 1, { kind: "dirt" });
    setCell(state, START_COL + 1, 2, { kind: "empty" });
    expect(canPlacePlank(state, "right")).toBe(true);
    const placed = applyAction(state, "plank-right");
    expect(placed.ok && placed.plankPlaced).toEqual({
      col: START_COL + 1,
      row: 1,
    });
    expect(cellAt(state, START_COL + 1, 1)?.plank).toBe(true);
    expect(state.used.plank).toBe(1);
    const mined = dig(state, "right");
    expect(mined.ok).toBe(true);
    expect(state.miner.col).toBe(START_COL + 1);
    expect(cellAt(state, START_COL + 1, 1)).toEqual({
      kind: "empty",
      plank: true,
    });
  });

  it("damages a plank before digging down through it", () => {
    const state = createMine(106, DEFAULT_GEAR, stock({ plank: 1 }));
    state.miner.col = START_COL;
    state.miner.row = 1;
    setCell(state, START_COL, 1, { kind: "empty", plank: true });
    setCell(state, START_COL, 2, { kind: "empty" });
    const energy = state.miner.energy;
    const hit = step(state, "down");
    expect(hit.ok && hit.plankCracked?.remaining).toBe(2);
    expect(state.miner.col).toBe(START_COL);
    expect(state.miner.row).toBe(1);
    expect(state.miner.energy).toBe(energy - 0.5);
    expect(cellAt(state, START_COL, 1)?.plank).toBe(true);
    expect(cellAt(state, START_COL, 2)?.kind).toBe("empty");
  });

  it("allows side digs without planks and drops through the opened gap", () => {
    const state = createMine(105, { ...DEFAULT_GEAR, pickaxe: 4 }, stock({}));
    const c = START_COL;
    state.miner.col = c;
    state.miner.row = 5;
    setCell(state, c, 5, { kind: "empty" });
    setCell(state, c, 6, { kind: "dirt" });
    setCell(state, c + 1, 5, { kind: "dirt" });
    setCell(state, c + 1, 6, { kind: "empty" });
    setCell(state, c + 1, 7, { kind: "dirt" });
    const result = step(state, "right");
    expect(result.ok && result.dug).toBe("dirt");
    expect(result.ok && result.fell).toBe(1);
    expect(state.miner.col).toBe(c + 1);
    expect(state.miner.row).toBe(6);
    expect(state.used.plank).toBe(0);
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

  it("salvages a planted ladder instead of returning carried stock", () => {
    const owned = stock({ ladder: 1 });
    const state = createMine(87, DEFAULT_GEAR, owned);
    dig(state, "down");
    const climb = step(state, "up");
    expect(climb.ok && climb.laddered).toBe(true);
    expect(state.consumables.ladder).toBe(0);
    step(state, "down");
    const collected = applyAction(state, "collect-ladder");
    expect(collected.ok && collected.collectedLadder).toBe(true);
    expect(collected.ok && collected.supportSalvageValue).toBe(1);
    expect(cellAt(state, START_COL, 1)?.ladder).toBeUndefined();
    expect(state.consumables.ladder).toBe(0);
    expect(state.used.ladder).toBe(1);
    expect(state.miner.carriedSalvageCredits).toBe(1);
    expect(carryoverConsumables(state).ladder).toBe(0);
  });

  it("salvages old world ladders without granting future reuse", () => {
    const diff: WorldDiff = [[START_COL, 1, { kind: "empty", ladder: true }]];
    const state = createMine(88, DEFAULT_GEAR, stock({ rope: 1 }), diff);
    step(state, "down");
    expect(applyAction(state, "collect-ladder").ok).toBe(true);
    expect(state.consumables.ladder).toBe(0);
    expect(state.miner.carriedSalvageCredits).toBe(1);
    expect(applyAction(state, "up")).toEqual({
      ok: false,
      reason: "no-ladder",
    });
    applyAction(state, "recall");
    expect(state.miner.bankedCredits).toBe(1);
    const replayed = replayTrip(
      88,
      ["down", "collect-ladder", "up", "recall"],
      DEFAULT_GEAR,
      stock({ rope: 1 }),
      diff,
    );
    expect(replayed.bankedCredits).toBe(1);
    expect(replayed.used.ladder).toBe(0);
  });

  it("breaks the current plank after repeated down hits and salvages partial value", () => {
    const state = lateralGapState(1);
    expect(applyAction(state, "plank-right").ok).toBe(true);
    expect(step(state, "right").ok).toBe(true);
    expect(state.consumables.plank).toBe(0);
    expect(state.used.plank).toBe(1);
    const hit1 = applyAction(state, "down");
    expect(hit1.ok && hit1.plankCracked?.remaining).toBe(2);
    expect(cellAt(state, START_COL, 1)?.plank).toBe(true);
    const hit2 = applyAction(state, "down");
    expect(hit2.ok && hit2.plankCracked?.remaining).toBe(1);
    expect(cellAt(state, START_COL, 1)?.plank).toBe(true);
    const result = applyAction(state, "down");
    expect(result.ok && result.supportCollected).toEqual({ plank: 1 });
    expect(result.ok && result.supportSalvageValue).toBe(1);
    expect(cellAt(state, START_COL, 1)?.plank).toBeUndefined();
    expect(state.consumables.plank).toBe(0);
    expect(state.used.plank).toBe(1);
    expect(state.miner.carriedSalvageCredits).toBe(1);
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
    expect(result.ok && result.lost?.value).toBe(2 * oreDef("silver").value);
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
    // a top pickaxe so nothing blocks, until the battery runs out below).
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
      "down",
      "plank-right",
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
    const c = START_COL;
    const diff: WorldDiff = [
      [c, 1, { kind: "empty" }],
      [c, 2, { kind: "dirt" }],
      [c + 1, 1, { kind: "empty" }],
      [c + 1, 2, { kind: "empty" }],
      [c + 1, 3, { kind: "dirt" }],
    ];
    const state = createMine(109, DEFAULT_GEAR, consumables, diff);
    for (const action of actions) applyAction(state, action);
    const replayed = replayTrip(109, actions, DEFAULT_GEAR, consumables, diff);
    expect(replayed.used.plank).toBe(state.used.plank);
    expect(replayed.used.plank).toBe(1);
    expect(replayTrip(109, actions, DEFAULT_GEAR, consumables, diff)).toEqual(
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
          ? "dynamite-1"
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

  it("pins the upgrade price table to the progressive mine economy", () => {
    expect(
      Object.fromEntries(GEAR_TRACKS.map((def) => [def.track, def.prices])),
    ).toEqual({
      pickaxe: [45, 140, 420, 1200, 3200, 8200, 19000, 42000, 90000],
      battery: [35, 110, 340, 950, 2400, 5600, 12500, 28000, 62000],
      cargo: [80, 220, 600, 1650, 4600, 12500, 34000, 78000, 170000],
      lantern: [55, 180, 520, 1400, 3600, 9000, 22000],
      warpcoil: [180, 700, 2600, 9000, 26000, 70000],
      blast: [250, 800, 2500],
      elevatorSpeed: [100, 260, 680, 1750, 4500, 11000, 26000, 62000],
      fall: [80, 220, 620, 1700, 4300, 10500, 25000],
      recall: [75, 240, 850, 3200, 12000],
    });
  });

  it("scales recall rope range toward the bottom row", () => {
    expect(recallRopeRange(DEFAULT_GEAR)).toBe(12);
    expect(recallRopeRange({ ...DEFAULT_GEAR, recall: 3 })).toBe(75);
    expect(recallRopeRange({ ...DEFAULT_GEAR, recall: 6 })).toBe(1000);
  });

  it("prices blast charge unlocks against the current mining economy", () => {
    expect(gearTrackDef("blast").prices).toEqual([250, 800, 2500]);
  });

  it("maps blast gear to capped dynamite tiers", () => {
    expect(blastRadius({ ...DEFAULT_GEAR, blast: 1 })).toBe(1);
    expect(blastRadius({ ...DEFAULT_GEAR, blast: 3 })).toBe(3);
    expect(dynamiteTier({ blast: 14 })).toBe(4);
    // A gear snapshot that predates the track reads as tier 1.
    const legacy: Partial<typeof DEFAULT_GEAR> = { ...DEFAULT_GEAR };
    legacy.blast = undefined;
    expect(dynamiteTier(legacy as typeof DEFAULT_GEAR)).toBe(1);
  });

  it("uses fixed dynamite tier footprints", () => {
    const state = createMine(401, { ...DEFAULT_GEAR, blast: 4 });
    expect(dynamiteBlastCells(state, { col: 0, row: 10 }, 1)).toEqual([
      { col: 0, row: 10 },
      { col: 0, row: 9 },
      { col: -1, row: 10 },
      { col: 1, row: 10 },
      { col: 0, row: 11 },
    ]);
    expect(dynamiteBlastCells(state, { col: 0, row: 10 }, 2)).toEqual([
      { col: 0, row: 10 },
      { col: 0, row: 9 },
      { col: 0, row: 8 },
      { col: -1, row: 10 },
      { col: -2, row: 10 },
      { col: 1, row: 10 },
      { col: 2, row: 10 },
      { col: 0, row: 11 },
      { col: 0, row: 12 },
      { col: 0, row: 13 },
    ]);
    expect(dynamiteBlastCells(state, { col: 0, row: 10 }, 3)).toHaveLength(9);
    expect(dynamiteBlastCells(state, { col: 0, row: 10 }, 4)).toHaveLength(
      (lightRadius(state.gear) * 2 + 1) ** 2,
    );
  });

  it("previews and detonates the selected dynamite tier", () => {
    const cons = stock({ dynamite: 1 });
    const state = createMine(401, { ...DEFAULT_GEAR, blast: 3 }, cons);
    setCell(state, START_COL - 1, 1, { kind: "dirt" });
    setCell(state, START_COL, 1, { kind: "rock", rockTier: 3 });
    setCell(state, START_COL + 1, 1, { kind: "ore", ore: "coal" });
    expect(dynamitePreviewCells(state, 3)).toEqual([
      { col: -1, row: 1 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ]);
    expect(applyAction(state, "dynamite-4")).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(applyAction(state, "dynamite-3").ok).toBe(true);
    const result = applyAction(state, "left");
    expect(result.ok && result.exploded).toEqual({
      col: START_COL,
      row: 0,
      tier: 3,
    });
    expect(cellAt(state, START_COL - 1, 1)?.kind).toBe("empty");
    expect(cellAt(state, START_COL, 1)?.kind).toBe("empty");
    expect(cellAt(state, START_COL + 1, 1)?.kind).toBe("empty");
  });

  it("accelerates the elevator car with the speed gear", () => {
    // Base car moves several rows per tick now that rides auto-chain;
    // each level picks up more rows per ride.
    expect(elevatorSpeedRows({ ...DEFAULT_GEAR, elevatorSpeed: 1 })).toBe(6);
    expect(elevatorSpeedRows({ ...DEFAULT_GEAR, elevatorSpeed: 2 })).toBe(11);
    expect(elevatorSpeedRows({ ...DEFAULT_GEAR, elevatorSpeed: 3 })).toBe(19);
    // A gear snapshot that predates the track reads as the base car.
    const legacy: Partial<typeof DEFAULT_GEAR> = { ...DEFAULT_GEAR };
    legacy.elevatorSpeed = undefined;
    expect(elevatorSpeedRows(legacy as typeof DEFAULT_GEAR)).toBe(6);
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
