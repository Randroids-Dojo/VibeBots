import { describe, expect, it } from "vitest";
import type { BunkerFootprint, BunkerState, DugBunkerCell } from "@/sim/bunker";
import type { LiveRaidCell } from "@/sim/bunker-raid-live";
import {
  advanceFpRaid,
  collectFpRaidPickup,
  createFpRaidRuntime,
  FP_RAID_ACTION_SECONDS,
  FP_RAID_TICK_SECONDS,
  type FpRaidRuntime,
  fpRaidEnded,
  fpRaidInterpFactor,
  fpRaidReport,
} from "./bunker-fp-raid";

const FOOTPRINT: BunkerFootprint = { col: 5, row: 5, width: 7, height: 5 };

function makeBunker(dug: DugBunkerCell[]): BunkerState {
  return {
    footprint: FOOTPRINT,
    core: { col: 8, row: 7, depth: 0, durability: 100 },
    parts: [],
    dug,
    blockSeed: 1,
  };
}

/** A single isolated interior cell: no Clanker can reach it, so they all
 * drain and the raid is survived (matches the sim's sealed scenario). */
const SEALED_PLAYER: LiveRaidCell = { col: 8, row: 7, depth: 2 };
function sealedRuntime(tier = 1): FpRaidRuntime {
  return createFpRaidRuntime(makeBunker([{ col: 8, row: 7, depth: 2 }]), tier);
}

/** An open depth-0 corridor across the footprint: a Clanker walks in and
 * reaches the player, losing the raid. */
const OPEN_PLAYER: LiveRaidCell = { col: 8, row: 5, depth: 0 };
function openRuntime(): FpRaidRuntime {
  const corridor: DugBunkerCell[] = [];
  for (let col = 5; col <= 11; col += 1)
    corridor.push({ col, row: 5, depth: 0 });
  return createFpRaidRuntime(makeBunker(corridor), 1);
}

function driveToEnd(
  runtime: FpRaidRuntime,
  player: LiveRaidCell,
  cap = 6000,
): number {
  let frames = 0;
  while (!fpRaidEnded(runtime) && frames < cap) {
    advanceFpRaid(runtime, player, FP_RAID_TICK_SECONDS);
    frames += 1;
  }
  return frames;
}

describe("createFpRaidRuntime", () => {
  it("builds a view per Clanker parked on its spawn cell", () => {
    const runtime = sealedRuntime(2);
    expect(runtime.views).toHaveLength(runtime.state.clankers.length);
    expect(runtime.tickAccum).toBe(0);
    runtime.views.forEach((view, index) => {
      const clanker = runtime.state.clankers[index];
      expect(view.id).toBe(clanker.id);
      expect(view.kind).toBe(clanker.kind);
      expect(view.alive).toBe(true);
      expect(view.justDied).toBe(false);
      // from and to both start on the spawn cell (no motion yet).
      expect([view.fromCol, view.fromRow, view.fromDepth]).toEqual([
        clanker.col,
        clanker.row,
        clanker.depth,
      ]);
      expect([view.toCol, view.toRow, view.toDepth]).toEqual([
        clanker.col,
        clanker.row,
        clanker.depth,
      ]);
    });
  });
});

describe("advanceFpRaid", () => {
  it("runs whole 6 Hz ticks out of the accumulator", () => {
    const runtime = sealedRuntime();
    expect(advanceFpRaid(runtime, SEALED_PLAYER, 0)).toBe(0);
    expect(runtime.state.tick).toBe(0);

    // Just under one tick: nothing steps, the remainder accumulates.
    expect(
      advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS * 0.9),
    ).toBe(0);
    expect(runtime.state.tick).toBe(0);

    // The accumulated remainder plus a fresh 0.2 crosses one tick.
    expect(
      advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS * 0.2),
    ).toBe(1);
    expect(runtime.state.tick).toBe(1);

    // A three-tick delta steps exactly three.
    expect(
      advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS * 3),
    ).toBe(3);
    expect(runtime.state.tick).toBe(4);
  });

  it("caps catch-up and drops the stale remainder", () => {
    const runtime = sealedRuntime();
    const ticks = advanceFpRaid(runtime, SEALED_PLAYER, 100);
    expect(ticks).toBe(8);
    expect(runtime.state.tick).toBe(8);
    expect(runtime.tickAccum).toBe(0);
  });

  it("flags each Clanker's death frame exactly once", () => {
    const runtime = sealedRuntime();
    const diedOnce = new Set<string>();
    let frames = 0;
    while (!fpRaidEnded(runtime) && frames < 6000) {
      advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS);
      for (const view of runtime.views) {
        if (view.justDied) {
          // justDied must fire exactly on the transition, never twice.
          expect(diedOnce.has(view.id)).toBe(false);
          diedOnce.add(view.id);
        }
      }
      frames += 1;
    }
    expect(diedOnce.size).toBe(runtime.state.clankers.length);
    expect(runtime.views.every((view) => !view.alive)).toBe(true);
  });

  it("tracks Clanker motion through the from/to cells", () => {
    // The open corridor lets Clankers walk toward the player, so their
    // view cells must leave the spawn ring as the sim advances.
    const runtime = openRuntime();
    const spawns = runtime.views.map((view) => ({
      col: view.toCol,
      row: view.toRow,
      depth: view.toDepth,
    }));
    let sawMotion = false;
    let frames = 0;
    while (!fpRaidEnded(runtime) && frames < 6000 && !sawMotion) {
      advanceFpRaid(runtime, OPEN_PLAYER, FP_RAID_TICK_SECONDS);
      runtime.views.forEach((view, index) => {
        if (
          view.toCol !== spawns[index].col ||
          view.toRow !== spawns[index].row ||
          view.toDepth !== spawns[index].depth
        ) {
          sawMotion = true;
        }
      });
      frames += 1;
    }
    expect(sawMotion).toBe(true);
  });
});

describe("fpRaidInterpFactor", () => {
  it("sweeps 0 to 1 across an action window", () => {
    const runtime = sealedRuntime();
    // Fresh: tick 0, phase 0, no sub-tick accumulation.
    expect(fpRaidInterpFactor(runtime)).toBe(0);

    // Land exactly on the action tick (period is 2 ticks): phase resets.
    advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS * 2);
    expect(runtime.state.tick).toBe(2);
    expect(fpRaidInterpFactor(runtime)).toBe(0);

    // One tick into the next window is halfway (period = 2 ticks).
    advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS);
    expect(fpRaidInterpFactor(runtime)).toBeCloseTo(0.5, 5);

    // A between-tick fraction never exceeds 1.
    advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS * 5);
    expect(fpRaidInterpFactor(runtime)).toBeGreaterThanOrEqual(0);
    expect(fpRaidInterpFactor(runtime)).toBeLessThanOrEqual(1);
  });

  it("keeps the action window a whole number of ticks", () => {
    expect(FP_RAID_ACTION_SECONDS).toBeCloseTo(FP_RAID_TICK_SECONDS * 2, 6);
  });
});

describe("collectFpRaidPickup", () => {
  it("credits a walked-over pickup once and reflects it in the report", () => {
    const runtime = sealedRuntime();
    driveToEnd(runtime, SEALED_PLAYER);
    expect(runtime.state.xpPickups.length).toBeGreaterThan(0);

    const pickup = runtime.state.xpPickups[0];
    const cell: LiveRaidCell = {
      col: pickup.col,
      row: pickup.row,
      depth: pickup.depth,
    };
    const gained = collectFpRaidPickup(runtime, cell);
    expect(gained).toBe(pickup.defenseXp);
    expect(gained).toBeGreaterThan(0);
    // A second walk-over on the same cell grants nothing.
    expect(collectFpRaidPickup(runtime, cell)).toBe(0);
    // A survived raid credits the collected XP in the report.
    expect(fpRaidReport(runtime).defenseXp).toBe(pickup.defenseXp);
  });
});

describe("fpRaidReport", () => {
  it("reports a sealed raid as a survived win", () => {
    const runtime = sealedRuntime();
    driveToEnd(runtime, SEALED_PLAYER);
    expect(fpRaidEnded(runtime)).toBe(true);
    const report = fpRaidReport(runtime);
    expect(report.outcome).toBe("won");
    expect(report.minerKilled).toBe(false);
    expect(report.clankersKilled).toBe(runtime.state.clankers.length);
  });

  it("reports an open-route raid as a miner-death loss", () => {
    const runtime = openRuntime();
    driveToEnd(runtime, OPEN_PLAYER);
    expect(fpRaidEnded(runtime)).toBe(true);
    const report = fpRaidReport(runtime);
    expect(report.outcome).toBe("lost");
    expect(report.minerKilled).toBe(true);
  });
});
