import { describe, expect, it } from "vitest";
import {
  BASE_PART_CATALOG,
  BASIC_TURRET_AMMO,
  type BunkerFootprint,
  type BunkerSlot,
  type BunkerState,
  CLANKER_TANK_TURRET_SHOTS,
  clankerKindFor,
  clankerXpFor,
  containsBunkerCell,
  type DugBunkerCell,
  type PlacedBasePart,
} from "./bunker";
import {
  BUNKER_RAID_LIVE_VERSION,
  collectLiveRaidPickup,
  createLiveRaid,
  LIVE_CLANKER_BASE_ENERGY,
  LIVE_CLANKER_ENERGY_PER_TIER,
  LIVE_RAID_DURATION_TICKS,
  LIVE_RAID_EXPIRY_GRACE_TICKS,
  LIVE_RAID_SURVIVE_VIBES_BASE,
  LIVE_RAID_SURVIVE_VIBES_PER_TIER,
  type LiveRaidCell,
  type LiveRaidOutcomeReport,
  type LiveRaidState,
  liveRaidDefenseXp,
  liveRaidMaxDefenseXp,
  liveRaidOutcomeReport,
  liveRaidPartWear,
  liveRaidSealed,
  liveRaidWaveSize,
  settleLiveRaidOutcome,
  stepLiveRaid,
  validateLiveRaidOutcome,
} from "./bunker-raid-live";

const FOOTPRINT: BunkerFootprint = { col: 5, row: 5, width: 7, height: 5 };

function makeBunker(
  dug: DugBunkerCell[],
  parts: PlacedBasePart[] = [],
): BunkerState {
  return {
    footprint: FOOTPRINT,
    parts,
    dug,
    blockSeed: 1,
  };
}

function part(
  partId: PlacedBasePart["partId"],
  col: number,
  row: number,
  depth: number,
  slot?: BunkerSlot,
): PlacedBasePart {
  return {
    partId,
    col,
    row,
    depth,
    durability: BASE_PART_CATALOG[partId].durability,
    ...(slot ? { slot } : {}),
  };
}

/** Step until the raid settles or the tick cap is hit, holding the player
 * at a fixed cell. Returns the final state (mutated in place). */
function runToEnd(
  state: LiveRaidState,
  player: LiveRaidCell,
  cap = 4000,
): LiveRaidState {
  let guard = 0;
  while (state.outcome === "active" && guard < cap) {
    stepLiveRaid(state, player);
    guard++;
  }
  return state;
}

function stepTimes(
  state: LiveRaidState,
  player: LiveRaidCell,
  ticks: number,
): void {
  for (let i = 0; i < ticks; i++) stepLiveRaid(state, player);
}

describe("createLiveRaid", () => {
  it("spawns 4 + 2*tier Clankers with tier-scaled energy outside the footprint", () => {
    const bunker = makeBunker([{ col: 8, row: 7, depth: 0 }]);
    const raid = createLiveRaid(bunker, 3);
    expect(raid.version).toBe(BUNKER_RAID_LIVE_VERSION);
    expect(raid.clankers).toHaveLength(4 + 3 * 2);
    for (let i = 0; i < raid.clankers.length; i++) {
      const clanker = raid.clankers[i];
      expect(clanker.kind).toBe(clankerKindFor(i, 3));
      expect(clanker.energy).toBe(
        LIVE_CLANKER_BASE_ENERGY + 3 * LIVE_CLANKER_ENERGY_PER_TIER,
      );
      expect(clanker.alive).toBe(true);
      expect(clanker.depth).toBe(0);
      expect(containsBunkerCell(FOOTPRINT, clanker.col, clanker.row)).toBe(
        false,
      );
    }
  });

  it("normalizes a sub-1 tier and floors fractional tiers", () => {
    const bunker = makeBunker([{ col: 8, row: 7, depth: 0 }]);
    expect(createLiveRaid(bunker, 0).clankers).toHaveLength(6);
    expect(createLiveRaid(bunker, 2.9).tier).toBe(2);
  });

  it("splits blocking parts and spikes from turrets", () => {
    const bunker = makeBunker(
      [{ col: 8, row: 7, depth: 0 }],
      [
        part("wall-panel", 6, 5, 0),
        part("floor-spikes", 7, 5, 0),
        part("basic-turret", 8, 5, 0),
      ],
    );
    const raid = createLiveRaid(bunker, 1);
    const ids = raid.parts.map((p) => p.partId).sort();
    expect(ids).toEqual(["floor-spikes", "wall-panel"]);
    expect(raid.turrets).toHaveLength(1);
    expect(raid.turrets[0]).toMatchObject({
      col: 8,
      row: 5,
      depth: 0,
      ammo: BASIC_TURRET_AMMO,
    });
  });
});

describe("connectivity and outcomes", () => {
  it("survives when no dug opening reaches the player (sealed rock is safe)", () => {
    // A single isolated interior cell: no path from the mine approach.
    const player: LiveRaidCell = { col: 8, row: 7, depth: 2 };
    const bunker = makeBunker([{ col: 8, row: 7, depth: 2 }]);
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, player);
    expect(raid.outcome).toBe("won");
    expect(raid.minerKilled).toBe(false);
    expect(raid.clankers.every((c) => !c.alive)).toBe(true);
    expect(raid.clankers.every((c) => c.death === "energy")).toBe(true);
    // Every drained Clanker drops an XP pickup.
    expect(raid.xpPickups).toHaveLength(raid.clankers.length);
  });

  it("loses when an open corridor lets a Clanker reach the player", () => {
    const player: LiveRaidCell = { col: 8, row: 5, depth: 0 };
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    const bunker = makeBunker(corridor);
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, player);
    expect(raid.outcome).toBe("lost");
    expect(raid.minerKilled).toBe(true);
    expect(raid.clankers.some((c) => c.death === "reached-player")).toBe(true);
  });
});

describe("walls and chewing", () => {
  // A deep shaft forces the only route through the wall: the player sits
  // below the tunnel plane where no exposed perimeter face reaches them, so
  // the wall in the shaft is genuinely the sole way in.
  function shaftWithWall(): { dug: DugBunkerCell[]; player: LiveRaidCell } {
    const dug: DugBunkerCell[] = [];
    for (let depth = 0; depth <= 3; depth++)
      dug.push({ col: 5, row: 5, depth });
    return { dug, player: { col: 5, row: 5, depth: 3 } };
  }

  it("chews a blocking wall in the path, dropping its durability over time", () => {
    const { dug, player } = shaftWithWall();
    const bunker = makeBunker(dug, [part("wall-panel", 5, 5, 1)]);
    const raid = createLiveRaid(bunker, 1);
    const startDurability = BASE_PART_CATALOG["wall-panel"].durability;
    // A few action ticks: the lead Clanker descends to the wall and bites it.
    stepTimes(raid, player, 12);
    const wall = liveRaidPartWear(raid).find(
      (p) => p.col === 5 && p.row === 5 && p.depth === 1,
    );
    expect(wall).toBeDefined();
    expect(wall?.durability).toBeLessThan(startDurability);
  });

  it("breaks through a single wall and still reaches the player", () => {
    const { dug, player } = shaftWithWall();
    const bunker = makeBunker(dug, [part("wall-panel", 5, 5, 1)]);
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, player);
    // One wall does not save you at tier 1: the wave chews through.
    expect(raid.outcome).toBe("lost");
  });
});

describe("spikes", () => {
  it("drains a crossing Clanker harder than an open cell and spends a spike use", () => {
    const player: LiveRaidCell = { col: 5, row: 5, depth: 4 };
    // A vertical shaft the lead Clanker descends; a spike sits partway down.
    const shaft: DugBunkerCell[] = [];
    for (let depth = 0; depth <= 4; depth++) {
      shaft.push({ col: 5, row: 5, depth });
    }
    const withSpike = createLiveRaid(
      makeBunker(shaft, [part("floor-spikes", 5, 5, 2)]),
      1,
    );
    const noSpike = createLiveRaid(makeBunker(shaft), 1);
    // Step to a point where the lead Clanker has crossed depth 2 but not yet
    // reached the player at depth 4.
    stepTimes(withSpike, player, 8);
    stepTimes(noSpike, player, 8);
    expect(withSpike.outcome).toBe("active");
    const leadWith = withSpike.clankers[0];
    const leadNo = noSpike.clankers[0];
    expect(leadWith.energy).toBeLessThan(leadNo.energy);
    const spike = liveRaidPartWear(withSpike).find(
      (p) => p.col === 5 && p.row === 5 && p.depth === 2,
    );
    expect(spike?.durability).toBeLessThan(
      BASE_PART_CATALOG["floor-spikes"].durability,
    );
  });
});

describe("rewards", () => {
  it("drops collectible XP pickups worth clankerXpFor on a survive", () => {
    const player: LiveRaidCell = { col: 8, row: 7, depth: 2 };
    const raid = createLiveRaid(makeBunker([{ col: 8, row: 7, depth: 2 }]), 1);
    runToEnd(raid, player);
    expect(raid.outcome).toBe("won");
    const pickup = raid.xpPickups[0];
    expect(pickup.defenseXp).toBe(clankerXpFor(raid.clankers[0].kind));
    expect(pickup.collected).toBe(false);
    const gained = collectLiveRaidPickup(raid, {
      col: pickup.col,
      row: pickup.row,
      depth: pickup.depth,
    });
    expect(gained).toBe(pickup.defenseXp);
    // Collecting the same pickup twice yields nothing.
    expect(
      collectLiveRaidPickup(raid, {
        col: pickup.col,
        row: pickup.row,
        depth: pickup.depth,
      }),
    ).toBe(0);
    expect(liveRaidDefenseXp(raid)).toBe(pickup.defenseXp);
  });

  it("grants no reward on a loss (matches interim raids)", () => {
    const player: LiveRaidCell = { col: 8, row: 5, depth: 0 };
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    const raid = createLiveRaid(makeBunker(corridor), 1);
    runToEnd(raid, player);
    expect(raid.outcome).toBe("lost");
    // Even a pickup that was dropped before the loss cannot be banked.
    const dropped = raid.xpPickups[0];
    if (dropped) {
      expect(
        collectLiveRaidPickup(raid, {
          col: dropped.col,
          row: dropped.row,
          depth: dropped.depth,
        }),
      ).toBe(0);
    }
    expect(liveRaidDefenseXp(raid)).toBe(0);
  });
});

describe("determinism and terminal stability", () => {
  it("produces identical state for identical inputs", () => {
    const player: LiveRaidCell = { col: 8, row: 7, depth: 2 };
    const a = createLiveRaid(makeBunker([{ col: 8, row: 7, depth: 2 }]), 2);
    const b = createLiveRaid(makeBunker([{ col: 8, row: 7, depth: 2 }]), 2);
    runToEnd(a, player);
    runToEnd(b, player);
    expect(a).toEqual(b);
  });

  it("is a no-op once the outcome has settled", () => {
    const player: LiveRaidCell = { col: 8, row: 5, depth: 0 };
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    const raid = createLiveRaid(makeBunker(corridor), 1);
    runToEnd(raid, player);
    const settledTick = raid.tick;
    const snapshot = JSON.stringify(raid);
    stepLiveRaid(raid, player);
    expect(raid.tick).toBe(settledTick);
    expect(JSON.stringify(raid)).toBe(snapshot);
  });
});

describe("outcome report and validation (F-110)", () => {
  const SEALED_PLAYER: LiveRaidCell = { col: 8, row: 7, depth: 2 };
  function sealedWonReport(tier = 1): {
    bunker: BunkerState;
    report: LiveRaidOutcomeReport;
  } {
    const bunker = makeBunker([{ col: 8, row: 7, depth: 2 }]);
    const raid = createLiveRaid(bunker, tier);
    runToEnd(raid, SEALED_PLAYER);
    return { bunker, report: liveRaidOutcomeReport(raid) };
  }

  it("reports a settled win with the full wave drained", () => {
    const { report } = sealedWonReport(1);
    expect(report.outcome).toBe("won");
    expect(report.minerKilled).toBe(false);
    expect(report.clankersKilled).toBe(liveRaidWaveSize(1));
    expect(report.defenseXp).toBe(0); // dropped but uncollected
  });

  it("validates an honest report against its snapshot", () => {
    const { bunker, report } = sealedWonReport(2);
    expect(validateLiveRaidOutcome(bunker, 2, report)).toEqual({ ok: true });
  });

  it("validates a report carrying collected XP up to the wave maximum", () => {
    const bunker = makeBunker([{ col: 8, row: 7, depth: 2 }]);
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    for (const pickup of raid.xpPickups) {
      collectLiveRaidPickup(raid, {
        col: pickup.col,
        row: pickup.row,
        depth: pickup.depth,
      });
    }
    const report = liveRaidOutcomeReport(raid);
    expect(report.defenseXp).toBe(liveRaidMaxDefenseXp(1));
    expect(validateLiveRaidOutcome(bunker, 1, report)).toEqual({ ok: true });
  });

  it("validates an honest loss report as a miner death with no reward", () => {
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    const bunker = makeBunker(corridor);
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, { col: 8, row: 5, depth: 0 });
    const report = liveRaidOutcomeReport(raid);
    expect(report.outcome).toBe("lost");
    expect(report.defenseXp).toBe(0);
    expect(validateLiveRaidOutcome(bunker, 1, report)).toEqual({ ok: true });
  });

  it("rejects a stale sim version", () => {
    const { bunker, report } = sealedWonReport();
    const bad = { ...report, version: BUNKER_RAID_LIVE_VERSION + 1 };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "version",
    });
  });

  it("rejects a win that claims a miner death (and vice versa)", () => {
    const { bunker, report } = sealedWonReport();
    const bad = { ...report, minerKilled: true };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "outcome-consistency",
    });
  });

  it("rejects an out-of-range end tick", () => {
    const { bunker, report } = sealedWonReport();
    const bad = {
      ...report,
      endedTick: LIVE_RAID_DURATION_TICKS + LIVE_RAID_EXPIRY_GRACE_TICKS + 1,
    };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "tick-range",
    });
  });

  it("rejects more kills than the wave can hold", () => {
    const { bunker, report } = sealedWonReport();
    const bad = { ...report, clankersKilled: liveRaidWaveSize(1) + 1 };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "clankers-range",
    });
  });

  it("rejects any reward on a loss", () => {
    const { bunker, report } = sealedWonReport();
    const bad = {
      ...report,
      outcome: "lost" as const,
      minerKilled: true,
      sealed: false,
      defenseXp: 25,
    };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "reward-on-loss",
    });
  });

  it("marks a fully-sealed survive as sealed and a breach as not", () => {
    // Sealed rock: no Clanker ever enters the footprint.
    const sealed = createLiveRaid(
      makeBunker([{ col: 8, row: 7, depth: 2 }]),
      1,
    );
    runToEnd(sealed, SEALED_PLAYER);
    expect(sealed.breached).toBe(false);
    expect(liveRaidSealed(sealed)).toBe(true);
    expect(liveRaidOutcomeReport(sealed).sealed).toBe(true);

    // An open corridor loss: Clankers entered the footprint to reach the
    // player, so the claim was breached and is never sealed.
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    const lost = createLiveRaid(makeBunker(corridor), 1);
    runToEnd(lost, { col: 8, row: 5, depth: 0 });
    expect(lost.breached).toBe(true);
    expect(liveRaidSealed(lost)).toBe(false);
  });

  it("treats a survive where a Clanker got in as not sealed", () => {
    const won = createLiveRaid(makeBunker([{ col: 8, row: 7, depth: 2 }]), 1);
    runToEnd(won, SEALED_PLAYER);
    expect(won.outcome).toBe("won");
    // Force the breach flag: a survive that let a Clanker inside is not
    // sealed even though the miner lived.
    won.breached = true;
    expect(liveRaidSealed(won)).toBe(false);
    expect(liveRaidOutcomeReport(won).sealed).toBe(false);
  });

  it("rejects a sealed flag on a loss", () => {
    const { bunker, report } = sealedWonReport();
    const bad = {
      ...report,
      outcome: "lost" as const,
      minerKilled: true,
      defenseXp: 0,
      sealed: true,
    };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "sealed-on-loss",
    });
  });

  it("rejects a reward above the wave maximum", () => {
    const { bunker, report } = sealedWonReport();
    const bad = { ...report, defenseXp: liveRaidMaxDefenseXp(1) + 1 };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "reward-range",
    });
  });

  it("rejects a fabricated part not in the snapshot", () => {
    const bunker = makeBunker(
      [{ col: 8, row: 7, depth: 2 }],
      [part("wall-panel", 8, 7, 2)],
    );
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    const report = liveRaidOutcomeReport(raid);
    const bad = {
      ...report,
      partWear: [
        ...report.partWear,
        {
          partId: "wall-panel" as const,
          col: 0,
          row: 0,
          depth: 0,
          durability: 1,
        },
      ],
    };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "part-wear",
    });
  });

  it("rejects a part durability above its snapshot value", () => {
    const bunker = makeBunker(
      [{ col: 8, row: 7, depth: 2 }],
      [part("wall-panel", 8, 7, 2)],
    );
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    const report = liveRaidOutcomeReport(raid);
    const wall = BASE_PART_CATALOG["wall-panel"].durability;
    const bad = {
      ...report,
      partWear: [
        {
          partId: "wall-panel" as const,
          col: 8,
          row: 7,
          depth: 2,
          durability: wall + 1,
        },
      ],
    };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "part-wear",
    });
  });

  // F-117: a cell can hold more than one thin wall (one per face), so wear
  // and validation key on the exact slot. Cell-keyed identity collapsed two
  // walls in a cell into one entry and rejected an honest report.
  function twoWallCell(): BunkerState {
    return makeBunker(
      [
        { col: 8, row: 7, depth: 2 },
        { col: 9, row: 7, depth: 2 },
      ],
      [
        part("wall-panel", 9, 7, 2, "wall-px"),
        part("wall-panel", 9, 7, 2, "wall-nz"),
      ],
    );
  }

  it("keeps two thin walls in one cell distinct through validation", () => {
    const bunker = twoWallCell();
    const raid = createLiveRaid(bunker, 1);
    expect(raid.parts).toHaveLength(2);
    runToEnd(raid, SEALED_PLAYER);
    const report = liveRaidOutcomeReport(raid);
    expect(report.partWear).toHaveLength(2);
    expect(new Set(report.partWear.map((p) => p.slot))).toEqual(
      new Set(["wall-px", "wall-nz"]),
    );
    expect(validateLiveRaidOutcome(bunker, 1, report)).toEqual({ ok: true });
  });

  it("settles wear onto the exact slot, not every part sharing the cell", () => {
    const full = BASE_PART_CATALOG["wall-panel"].durability;
    const bunker = twoWallCell();
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    const report: LiveRaidOutcomeReport = {
      ...liveRaidOutcomeReport(raid),
      partWear: [
        {
          partId: "wall-panel",
          col: 9,
          row: 7,
          depth: 2,
          slot: "wall-px",
          durability: 0,
        },
        {
          partId: "wall-panel",
          col: 9,
          row: 7,
          depth: 2,
          slot: "wall-nz",
          durability: full,
        },
      ],
    };
    const settled = settleLiveRaidOutcome(bunker, 1, report);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    const parts = settled.settlement.bunker.parts;
    expect(parts.find((p) => p.slot === "wall-px")?.durability).toBe(0);
    expect(parts.find((p) => p.slot === "wall-nz")?.durability).toBe(full);
  });

  it("rejects a report that omits one of two walls sharing a cell", () => {
    const bunker = twoWallCell();
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    const report = liveRaidOutcomeReport(raid);
    const bad: LiveRaidOutcomeReport = {
      ...report,
      partWear: report.partWear.slice(0, 1),
    };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "part-wear",
    });
  });

  it("rejects a report that lists one slot twice for a shared cell", () => {
    const full = BASE_PART_CATALOG["wall-panel"].durability;
    const bunker = twoWallCell();
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    const bad: LiveRaidOutcomeReport = {
      ...liveRaidOutcomeReport(raid),
      partWear: [
        {
          partId: "wall-panel",
          col: 9,
          row: 7,
          depth: 2,
          slot: "wall-px",
          durability: full,
        },
        {
          partId: "wall-panel",
          col: 9,
          row: 7,
          depth: 2,
          slot: "wall-px",
          durability: full,
        },
      ],
    };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "part-wear",
    });
  });

  it("still validates and settles a legacy full-cell part with no slot", () => {
    const bunker = makeBunker(
      [{ col: 8, row: 7, depth: 2 }],
      [part("wall-panel", 9, 7, 2)],
    );
    const raid = createLiveRaid(bunker, 1);
    expect(raid.parts[0]?.slot).toBeUndefined();
    runToEnd(raid, SEALED_PLAYER);
    const report = liveRaidOutcomeReport(raid);
    expect(report.partWear[0]?.slot).toBeUndefined();
    expect(validateLiveRaidOutcome(bunker, 1, report)).toEqual({ ok: true });
    expect(settleLiveRaidOutcome(bunker, 1, report).ok).toBe(true);
  });
});

describe("turrets (F-143)", () => {
  const SEALED_PLAYER: LiveRaidCell = { col: 8, row: 7, depth: 2 };

  it("shoots down Clankers it can see and spends ammo", () => {
    // Player sealed away, so Clankers idle in the approach; a turret on the
    // left perimeter is on the same row as the left-side spawns and picks
    // them off along a clear line.
    const bunker = makeBunker(
      [
        { col: 8, row: 7, depth: 2 },
        { col: 5, row: 5, depth: 0 },
      ],
      [part("basic-turret", 5, 5, 0)],
    );
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    expect(raid.outcome).toBe("won");
    const turretKills = raid.clankers.filter((c) => c.death === "turret");
    expect(turretKills.length).toBeGreaterThan(0);
    expect(raid.turrets[0].ammo).toBeLessThan(BASIC_TURRET_AMMO);
    // A turret-killed Clanker still drops its XP pickup.
    for (const killed of turretKills) {
      expect(raid.xpPickups.some((p) => p.id === `${killed.id}-xp`)).toBe(true);
    }
  });

  it("does not shoot through undug rock", () => {
    // Turret is in range of and axis-aligned with the nearest left Clanker
    // (distance 3), but the cells between are undug rock, so it cannot fire.
    const bunker = makeBunker(
      [
        { col: 8, row: 7, depth: 2 },
        { col: 7, row: 5, depth: 0 },
      ],
      [part("basic-turret", 7, 5, 0)],
    );
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    expect(raid.clankers.some((c) => c.death === "turret")).toBe(false);
    expect(raid.turrets[0].ammo).toBe(BASIC_TURRET_AMMO);
  });

  it("is inert with no ammo", () => {
    const bunker = makeBunker(
      [
        { col: 8, row: 7, depth: 2 },
        { col: 5, row: 5, depth: 0 },
      ],
      [part("basic-turret", 5, 5, 0)],
    );
    const raid = createLiveRaid(bunker, 1);
    for (const turret of raid.turrets) turret.ammo = 0;
    runToEnd(raid, SEALED_PLAYER);
    expect(raid.clankers.some((c) => c.death === "turret")).toBe(false);
  });

  it("makes a tank soak more shots than a standard Clanker", () => {
    // Tier 3 spawns a tank at index 3 (id clanker-4) on the right at
    // (13,5,0) and a standard at index 1 (id clanker-2) at (12,5,0). A
    // right-perimeter turret picks the nearer standard first, then needs two
    // shots to drop the tank.
    const bunker = makeBunker(
      [
        { col: 8, row: 7, depth: 2 },
        { col: 11, row: 5, depth: 0 },
      ],
      [part("basic-turret", 11, 5, 0)],
    );
    const raid = createLiveRaid(bunker, 3);
    const tank = raid.clankers.find((c) => c.kind === "tank");
    expect(tank).toBeDefined();
    runToEnd(raid, SEALED_PLAYER);
    // Whichever standard the turret dropped fell to a single shot.
    const standardTurretKill = raid.clankers.find(
      (c) => c.kind === "standard" && c.death === "turret",
    );
    if (standardTurretKill) expect(standardTurretKill.hits).toBe(1);
    // The tank, if the turret killed it, soaked the full quota.
    if (tank?.death === "turret") {
      expect(tank.hits).toBe(CLANKER_TANK_TURRET_SHOTS);
    } else {
      // Otherwise it at least absorbed a hit and lived past it.
      expect(tank?.hits ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("settlement (F-105/F-108)", () => {
  const SEALED_PLAYER: LiveRaidCell = { col: 8, row: 7, depth: 2 };

  it("settles a survive with tier-scaled vibes and the collected XP", () => {
    const bunker = makeBunker([{ col: 8, row: 7, depth: 2 }]);
    const raid = createLiveRaid(bunker, 2);
    runToEnd(raid, SEALED_PLAYER);
    for (const pickup of raid.xpPickups) {
      collectLiveRaidPickup(raid, {
        col: pickup.col,
        row: pickup.row,
        depth: pickup.depth,
      });
    }
    const report = liveRaidOutcomeReport(raid);
    const settled = settleLiveRaidOutcome(bunker, 2, report);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.settlement.survived).toBe(true);
    expect(settled.settlement.sealed).toBe(true);
    expect(settled.settlement.reward.vibes).toBe(
      LIVE_RAID_SURVIVE_VIBES_BASE + 2 * LIVE_RAID_SURVIVE_VIBES_PER_TIER,
    );
    expect(settled.settlement.reward.defenseXp).toBe(report.defenseXp);
    expect(report.defenseXp).toBeGreaterThan(0);
  });

  it("settles a loss with no reward and applies part wear to the bunker", () => {
    const dug: DugBunkerCell[] = [];
    for (let depth = 0; depth <= 3; depth++)
      dug.push({ col: 5, row: 5, depth });
    const bunker = makeBunker(dug, [part("wall-panel", 5, 5, 1)]);
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, { col: 5, row: 5, depth: 3 });
    expect(raid.outcome).toBe("lost");
    const report = liveRaidOutcomeReport(raid);
    const settled = settleLiveRaidOutcome(bunker, 1, report);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.settlement.survived).toBe(false);
    expect(settled.settlement.reward).toEqual({ vibes: 0, defenseXp: 0 });
    const wall = settled.settlement.bunker.parts.find(
      (p) => p.col === 5 && p.row === 5 && p.depth === 1,
    );
    // The wave chewed the wall down to break it, so the settled bunker
    // records the reduced durability, not the pristine snapshot value.
    expect(wall?.durability).toBeLessThan(
      BASE_PART_CATALOG["wall-panel"].durability,
    );
    // The snapshot passed in is not mutated.
    expect(bunker.parts[0].durability).toBe(
      BASE_PART_CATALOG["wall-panel"].durability,
    );
  });

  it("refuses to settle an invalid report, surfacing the reason", () => {
    const bunker = makeBunker([{ col: 8, row: 7, depth: 2 }]);
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    const report = liveRaidOutcomeReport(raid);
    const bad = { ...report, defenseXp: liveRaidMaxDefenseXp(1) + 1 };
    const settled = settleLiveRaidOutcome(bunker, 1, bad);
    expect(settled).toEqual({ ok: false, reason: "reward-range" });
  });

  it("rejects a report that omits a damaged part (cannot keep it pristine)", () => {
    const bunker = makeBunker(
      [{ col: 8, row: 7, depth: 2 }],
      [part("wall-panel", 8, 7, 2), part("floor-spikes", 8, 6, 2)],
    );
    const raid = createLiveRaid(bunker, 1);
    runToEnd(raid, SEALED_PLAYER);
    const report = liveRaidOutcomeReport(raid);
    // Drop one tracked part from the report.
    const bad = { ...report, partWear: report.partWear.slice(0, 1) };
    expect(validateLiveRaidOutcome(bunker, 1, bad)).toEqual({
      ok: false,
      reason: "part-wear",
    });
  });
});
