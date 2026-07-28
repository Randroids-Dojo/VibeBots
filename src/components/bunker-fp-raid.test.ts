import { describe, expect, it } from "vitest";
import type { BunkerFootprint, BunkerState, DugBunkerCell } from "@/sim/bunker";
import { type LiveRaidCell, pickaxeStrikeDamage } from "@/sim/bunker-raid-live";
import {
  advanceFpRaid,
  collectFpRaidPickup,
  createFpRaidRuntime,
  FP_RAID_ACTION_SECONDS,
  FP_RAID_TICK_SECONDS,
  type FpRaidRuntime,
  formatRaidCooldown,
  fpRaidEnded,
  fpRaidInterpFactor,
  fpRaidReport,
  raidCooldownMsLeft,
  strikeFpRaid,
} from "./bunker-fp-raid";

const FOOTPRINT: BunkerFootprint = { col: 5, row: 5, width: 7, height: 5 };

function makeBunker(dug: DugBunkerCell[]): BunkerState {
  return {
    footprint: FOOTPRINT,
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
      // from and to both start on the spawn body position (no motion
      // yet), which is the spawn cell centre.
      expect([view.fromCol, view.fromRow, view.fromDepth]).toEqual([
        clanker.x,
        clanker.y,
        clanker.z,
      ]);
      expect([view.toCol, view.toRow, view.toDepth]).toEqual([
        clanker.col,
        clanker.row,
        clanker.depth,
      ]);
      expect(view.biteTick).toBe(-1);
      expect(view.hurtTick).toBe(-1);
    });
  });

  it("carries specialist Clanker kinds into the views (F-159 tint source)", () => {
    // The render layer reads each view's kind to tint breachers and tanks;
    // a tier-1 wave is all standard, a tier-3 wave fields both specialists.
    const standardWave = sealedRuntime(1);
    expect(standardWave.views.every((view) => view.kind === "standard")).toBe(
      true,
    );

    const specialistWave = sealedRuntime(3);
    const kinds = new Set(specialistWave.views.map((view) => view.kind));
    expect(kinds.has("breacher")).toBe(true);
    expect(kinds.has("tank")).toBe(true);
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

  it("tracks Clanker motion through the from/to positions", () => {
    // The open corridor lets Clankers walk toward the player, so their
    // view positions must leave the spawn ring as the sim advances.
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

  it("hands the render layer a one-tick segment of continuous travel", () => {
    // The layer lerps from -> to across a single tick, so a moving body's
    // segment must be a real sub-cell step, not a whole-cell snap.
    const runtime = openRuntime();
    let segment = 0;
    let frames = 0;
    while (!fpRaidEnded(runtime) && frames < 6000 && segment === 0) {
      advanceFpRaid(runtime, OPEN_PLAYER, FP_RAID_TICK_SECONDS);
      for (const view of runtime.views) {
        if (!view.alive) continue;
        const dx = view.toCol - view.fromCol;
        const dy = view.toRow - view.fromRow;
        const dz = view.toDepth - view.fromDepth;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length > 0) segment = length;
      }
      frames += 1;
    }
    expect(segment).toBeGreaterThan(0);
    expect(segment).toBeLessThan(1);
  });
});

describe("strikeFpRaid", () => {
  it("lands a pickaxe hit scaled by gear level on the aimed Clanker", () => {
    const runtime = openRuntime();
    const target = runtime.state.clankers[0];
    for (let i = 1; i < runtime.state.clankers.length; i += 1) {
      runtime.state.clankers[i].alive = false;
    }
    // Park the target one cell ahead of the miner along +col.
    target.x = OPEN_PLAYER.col + 1;
    target.y = OPEN_PLAYER.row;
    target.z = OPEN_PLAYER.depth;
    target.col = target.x;
    target.row = target.y;
    const before = target.energy;

    const hit = strikeFpRaid(
      runtime,
      OPEN_PLAYER,
      { col: 1, row: 0, depth: 0 },
      2,
    );
    expect(hit).toBe(target);
    expect(before - target.energy).toBe(pickaxeStrikeDamage(2));
    // A level-1 pick hits for less than a level-2 one.
    expect(pickaxeStrikeDamage(1)).toBeLessThan(pickaxeStrikeDamage(2));
  });

  it("returns null when the swing connects with nothing", () => {
    const runtime = openRuntime();
    // Every Clanker is still out on the spawn ring, far from the miner.
    expect(
      strikeFpRaid(runtime, OPEN_PLAYER, { col: 0, row: 0, depth: -1 }, 2),
    ).toBeNull();
  });
});

describe("fpRaidInterpFactor", () => {
  it("sweeps 0 to 1 across one sim tick", () => {
    const runtime = sealedRuntime();
    // Fresh: tick 0, no sub-tick accumulation.
    expect(fpRaidInterpFactor(runtime)).toBe(0);

    // Landing exactly on a tick boundary leaves nothing to tween.
    advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS * 2);
    expect(runtime.state.tick).toBe(2);
    expect(fpRaidInterpFactor(runtime)).toBeCloseTo(0, 5);

    // Bodies move every tick now, so the tween window is one tick: a
    // frame landing 40% into it reads 0.4.
    advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS * 0.4);
    expect(runtime.state.tick).toBe(2);
    expect(fpRaidInterpFactor(runtime)).toBeCloseTo(0.4, 5);

    // A between-tick fraction never leaves [0, 1].
    advanceFpRaid(runtime, SEALED_PLAYER, FP_RAID_TICK_SECONDS * 5.3);
    expect(fpRaidInterpFactor(runtime)).toBeGreaterThanOrEqual(0);
    expect(fpRaidInterpFactor(runtime)).toBeLessThanOrEqual(1);
  });

  it("keeps the route-decision window a whole number of ticks", () => {
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

describe("raid cooldown helpers", () => {
  it("computes the clamped time left until the next raid", () => {
    expect(raidCooldownMsLeft(10_000, 4_000)).toBe(6_000);
    // At or past the deadline nothing remains.
    expect(raidCooldownMsLeft(10_000, 10_000)).toBe(0);
    expect(raidCooldownMsLeft(10_000, 15_000)).toBe(0);
    // No deadline (no prior raid) means a raid can start now.
    expect(raidCooldownMsLeft(null, 4_000)).toBe(0);
  });

  it("formats the countdown with its two largest units", () => {
    expect(formatRaidCooldown(4 * 60 * 60 * 1000)).toBe("4h 0m");
    expect(formatRaidCooldown(3 * 60 * 60 * 1000 + 59 * 60 * 1000)).toBe(
      "3h 59m",
    );
    expect(formatRaidCooldown(59 * 60 * 1000 + 30 * 1000)).toBe("59m 30s");
    expect(formatRaidCooldown(45 * 1000)).toBe("45s");
    expect(formatRaidCooldown(0)).toBe("0s");
  });

  it("rounds seconds up so a live countdown never shows zero early", () => {
    expect(formatRaidCooldown(1)).toBe("1s");
    expect(formatRaidCooldown(59_001)).toBe("1m 0s");
  });
});
