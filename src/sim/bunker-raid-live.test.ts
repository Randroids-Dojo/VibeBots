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
  clankerPlayerBiteDamage,
  collectLiveRaidPickup,
  createLiveRaid,
  LIVE_CLANKER_ACTIVATION_STAGGER_TICKS,
  LIVE_CLANKER_BASE_ENERGY,
  LIVE_CLANKER_BITE_PERIOD_TICKS,
  LIVE_CLANKER_BREACH_HOLD_TICKS,
  LIVE_CLANKER_ENERGY_PER_TIER,
  LIVE_MOVE_ENERGY_COST,
  LIVE_PICKAXE_BASE_DAMAGE,
  LIVE_PICKAXE_DAMAGE_PER_LEVEL,
  LIVE_PLAYER_MAX_HEALTH,
  LIVE_PLAYER_STRIKE_COOLDOWN_TICKS,
  LIVE_PLAYER_STRIKE_REACH,
  LIVE_RAID_DURATION_TICKS,
  LIVE_RAID_EXPIRY_GRACE_TICKS,
  LIVE_RAID_ONSET_TICKS,
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
  pickaxeStrikeDamage,
  settleLiveRaidOutcome,
  stepLiveRaid,
  strikeLiveRaid,
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

describe("staged wave onset (F-218)", () => {
  it("staggers each Clanker's activation tick from the onset window", () => {
    const bunker = makeBunker([{ col: 8, row: 7, depth: 0 }]);
    const raid = createLiveRaid(bunker, 2);
    raid.clankers.forEach((clanker, index) => {
      expect(clanker.inertUntilTick).toBe(
        LIVE_RAID_ONSET_TICKS + index * LIVE_CLANKER_ACTIVATION_STAGGER_TICKS,
      );
    });
  });

  it("holds inactive Clankers at spawn with no movement or energy drain", () => {
    const player: LiveRaidCell = { col: 8, row: 5, depth: 0 };
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    const raid = createLiveRaid(makeBunker(corridor), 1);
    const spawns = raid.clankers.map((c) => ({ col: c.col, row: c.row }));
    stepTimes(raid, player, LIVE_RAID_ONSET_TICKS - 1);
    raid.clankers.forEach((clanker, index) => {
      expect(clanker.col).toBe(spawns[index].col);
      expect(clanker.row).toBe(spawns[index].row);
      expect(clanker.energy).toBe(LIVE_CLANKER_BASE_ENERGY + 1 * 20);
    });
    expect(raid.breached).toBe(false);
    // One action tick past its activation, the lead has moved or spent.
    stepTimes(raid, player, 3);
    const lead = raid.clankers[0];
    const moved =
      lead.col !== spawns[0].col ||
      lead.row !== spawns[0].row ||
      lead.energy < LIVE_CLANKER_BASE_ENERGY + 20;
    expect(moved).toBe(true);
    // The last of the wave is still waiting untouched at its spawn.
    const tail = raid.clankers[raid.clankers.length - 1];
    expect(tail.col).toBe(spawns[spawns.length - 1].col);
    expect(tail.energy).toBe(LIVE_CLANKER_BASE_ENERGY + 20);
  });

  it("holds a breaching Clanker at its entry cell instead of biting on the same hop", () => {
    // The player stands ON the perimeter dug cell the lead Clanker enters
    // through: the worst case that used to be an invisible same-tick kill.
    const player: LiveRaidCell = { col: 5, row: 5, depth: 0 };
    const raid = createLiveRaid(makeBunker([{ col: 5, row: 5, depth: 0 }]), 1);
    // Run until the lead burrows in. Bodies travel continuously now, so
    // the breach lands a couple of ticks after its activation rather than
    // exactly on it.
    let guard = 0;
    while (!raid.breached && guard < LIVE_RAID_ONSET_TICKS + 30) {
      stepLiveRaid(raid, player);
      guard++;
    }
    // The emergence hold means the miner is untouched while it surfaces.
    expect(raid.breached).toBe(true);
    expect(raid.outcome).toBe("active");
    expect(raid.playerHealth).toBe(LIVE_PLAYER_MAX_HEALTH);
    const lead = raid.clankers[0];
    expect(lead.col).toBe(5);
    expect(lead.row).toBe(5);
    expect(lead.inertUntilTick).toBe(
      raid.tick + LIVE_CLANKER_BREACH_HOLD_TICKS,
    );
    // Still nothing lands while the hold runs.
    stepTimes(raid, player, LIVE_CLANKER_BREACH_HOLD_TICKS - 1);
    expect(raid.playerHealth).toBe(LIVE_PLAYER_MAX_HEALTH);
    // A player who stays put past the hold starts taking bites, and the
    // fight (not first contact) is what eventually kills them.
    stepTimes(raid, player, 4);
    expect(raid.playerHealth).toBeLessThan(LIVE_PLAYER_MAX_HEALTH);
    expect(raid.outcome).toBe("active");
    runToEnd(raid, player);
    expect(raid.outcome).toBe("lost");
  });

  it("gives an undefended fresh claim a witnessable invasion before it can lose", () => {
    // The fresh-claim shape that used to lose in ~3 seconds: only the
    // authored 3x3x3 spawn pocket dug, player standing on the pocket floor.
    const pocket: DugBunkerCell[] = [];
    for (let z = 0; z < 3; z++)
      for (let y = 0; y < 3; y++)
        for (let dx = -1; dx <= 1; dx++)
          pocket.push({ col: 8 + dx, row: 9 - y, depth: z });
    const player: LiveRaidCell = { col: 8, row: 9, depth: 0 };
    const raid = createLiveRaid(makeBunker(pocket), 1);
    // Nothing can happen during the onset window.
    stepTimes(raid, player, LIVE_RAID_ONSET_TICKS);
    expect(raid.outcome).toBe("active");
    expect(raid.breached).toBe(false);
    // The invasion then unfolds: the claim is breached (the moment the
    // render layer shows the emergence) strictly before the stationary
    // player can be reached, so the entry is witnessable.
    let breachedTick = -1;
    while (raid.outcome === "active" && raid.tick < LIVE_RAID_DURATION_TICKS) {
      stepLiveRaid(raid, player);
      if (breachedTick < 0 && raid.breached) breachedTick = raid.tick;
    }
    expect(raid.outcome).toBe("lost");
    expect(breachedTick).toBeGreaterThan(LIVE_RAID_ONSET_TICKS);
    expect(raid.tick).toBeGreaterThan(breachedTick);
  });
});

describe("melee combat (dev direction 2026-07-27)", () => {
  /** A depth-0 corridor across the footprint with the player on it: the
   * shape Clankers walk straight into, so contact is quick to reach. */
  function corridorRaid(tier = 1): {
    raid: LiveRaidState;
    player: LiveRaidCell;
  } {
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    return {
      raid: createLiveRaid(makeBunker(corridor), tier),
      player: { col: 8, row: 5, depth: 0 },
    };
  }

  /** Step until the miner has taken damage, returning the tick it landed
   * on (or -1 if the cap ran out first). */
  function stepUntilBitten(
    state: LiveRaidState,
    player: LiveRaidCell,
    cap = 600,
  ): number {
    let guard = 0;
    while (state.outcome === "active" && guard < cap) {
      stepLiveRaid(state, player);
      guard++;
      if (state.playerHealth < LIVE_PLAYER_MAX_HEALTH) return state.tick;
    }
    return -1;
  }

  it("starts the miner on a full health bar instead of dying to one touch", () => {
    const { raid, player } = corridorRaid();
    expect(raid.playerHealth).toBe(LIVE_PLAYER_MAX_HEALTH);
    expect(raid.playerMaxHealth).toBe(LIVE_PLAYER_MAX_HEALTH);
    expect(stepUntilBitten(raid, player)).toBeGreaterThan(0);
    // Contact costs exactly one bite, and the raid keeps running.
    expect(raid.playerHealth).toBe(
      LIVE_PLAYER_MAX_HEALTH - clankerPlayerBiteDamage(1, "standard"),
    );
    expect(raid.outcome).toBe("active");
    expect(raid.minerKilled).toBe(false);
  });

  it("paces bites by the bite cooldown rather than every tick", () => {
    const { raid, player } = corridorRaid();
    expect(stepUntilBitten(raid, player)).toBeGreaterThan(0);
    const afterFirst = raid.playerHealth;
    // Well inside the cooldown: no second bite from the same Clanker.
    stepTimes(raid, player, LIVE_CLANKER_BITE_PERIOD_TICKS - 2);
    expect(raid.playerHealth).toBe(afterFirst);
    stepTimes(raid, player, 2);
    expect(raid.playerHealth).toBeLessThan(afterFirst);
  });

  it("kills the miner only when bites empty the bar, self-destructing the Clanker that lands it", () => {
    const { raid, player } = corridorRaid();
    runToEnd(raid, player);
    expect(raid.outcome).toBe("lost");
    expect(raid.minerKilled).toBe(true);
    expect(raid.playerHealth).toBe(0);
    expect(raid.clankers.some((c) => c.death === "reached-player")).toBe(true);
  });

  it("chases a fleeing miner instead of trailing a cell behind", () => {
    // A tall open room the miner can run across. The lead Clanker's body
    // must close on the player's live position while the player retreats
    // one cell at a time, which the old cell-hop model could not do.
    const room: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++) {
      for (let row = 5; row <= 9; row++) room.push({ col, row, depth: 0 });
    }
    const raid = createLiveRaid(makeBunker(room), 1);
    const player: LiveRaidCell = { col: 5, row: 9, depth: 0 };
    // Let the lead activate and burrow into the room.
    let guard = 0;
    while (!raid.breached && guard < 200) {
      stepLiveRaid(raid, player);
      guard++;
    }
    stepTimes(raid, player, LIVE_CLANKER_BREACH_HOLD_TICKS + 1);
    const lead = raid.clankers[0];
    const gap = () => {
      const dx = player.col - lead.x;
      const dy = player.row - lead.y;
      const dz = player.depth - lead.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
    // Retreat across the room a fraction of a cell per tick, slower than
    // the Clanker's chase speed, and watch the gap shrink.
    const startGap = gap();
    for (let i = 0; i < 40 && raid.outcome === "active"; i++) {
      player.col = Math.min(11, player.col + 0.1);
      stepLiveRaid(raid, player);
    }
    expect(gap()).toBeLessThan(startGap);
    // The body is genuinely off-lattice while it hunts, not snapped to
    // cell centres.
    expect(
      raid.clankers.some(
        (c) => c.alive && (c.x !== Math.round(c.x) || c.z !== Math.round(c.z)),
      ),
    ).toBe(true);
  });

  it("gets bodies into the room on the open-plane claim the raid e2e uses", () => {
    // The exact shape E2E-MINE-BUNKER-FP-0019 fights on: a 7x5 claim with
    // its whole depth-0 plane dug, one wall on the corner cell, tier 3.
    // The render layer only draws Clankers inside the footprint, so if
    // none ever crosses in, the raid looks empty. A stalled body (an
    // engaged beeline pressing into shell rock forever) used to do
    // exactly that, which the room-shaped tests above did not catch.
    const footprint: BunkerFootprint = { col: -3, row: 1, width: 7, height: 5 };
    const dug: DugBunkerCell[] = [];
    for (let row = 1; row <= 5; row++) {
      for (let col = -3; col <= 3; col++) dug.push({ col, row, depth: 0 });
    }
    const bunker: BunkerState = {
      footprint,
      parts: [part("wall-panel", -3, 1, 0)],
      dug,
      blockSeed: 1,
    };
    const raid = createLiveRaid(bunker, 3);
    const player: LiveRaidCell = { col: 0, row: 5, depth: 0 };
    let sawInside = false;
    for (let i = 0; i < 400 && raid.outcome === "active" && !sawInside; i++) {
      stepLiveRaid(raid, player);
      sawInside = raid.clankers.some(
        (c) => c.alive && containsBunkerCell(footprint, c.col, c.row),
      );
    }
    expect(sawInside).toBe(true);
    expect(raid.breached).toBe(true);
  });

  it("records a breach even when the entering hop spends the last energy", () => {
    // A Clanker that dies the instant it gets in still got in, so the claim
    // was not sealed. Missing this hands out the sealed verdict and the
    // Buttoned Up stamp on a raid that was genuinely breached.
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    const raid = createLiveRaid(makeBunker(corridor), 1);
    const player: LiveRaidCell = { col: 8, row: 5, depth: 0 };
    // Starve the whole wave so the very next cell entry is fatal, and run
    // the lead up to the claim's edge.
    let guard = 0;
    while (!raid.breached && guard < 400) {
      for (const clanker of raid.clankers) {
        if (clanker.alive) clanker.energy = LIVE_MOVE_ENERGY_COST;
      }
      stepLiveRaid(raid, player);
      guard++;
    }
    expect(raid.breached).toBe(true);
    // The Clanker that got in died on the hop that did it.
    expect(
      raid.clankers.some(
        (c) =>
          !c.alive &&
          c.death === "energy" &&
          containsBunkerCell(FOOTPRINT, c.col, c.row),
      ),
    ).toBe(true);
    expect(liveRaidSealed(raid)).toBe(false);
  });

  it("keeps bodies out of rock while beelining at the player", () => {
    // A sealed pocket next to the corridor: no Clanker may ever settle in
    // an undug cell, however directly it steers at the miner.
    const corridor: DugBunkerCell[] = [];
    for (let col = 5; col <= 11; col++)
      corridor.push({ col, row: 5, depth: 0 });
    const raid = createLiveRaid(makeBunker(corridor), 3);
    const player: LiveRaidCell = { col: 8, row: 5, depth: 0 };
    for (let i = 0; i < 400 && raid.outcome === "active"; i++) {
      stepLiveRaid(raid, player);
      for (const clanker of raid.clankers) {
        if (!clanker.alive) continue;
        if (!containsBunkerCell(FOOTPRINT, clanker.col, clanker.row)) continue;
        // Inside the claim a live body may only occupy a dug cell.
        expect(
          corridor.some(
            (cell) =>
              cell.col === clanker.col &&
              cell.row === clanker.row &&
              cell.depth === clanker.depth,
          ),
        ).toBe(true);
      }
    }
  });
});

describe("pickaxe strikes (dev direction 2026-07-27)", () => {
  /** A raid with one live Clanker parked at a known body position, so a
   * strike's reach, cone, cooldown, and damage are exactly measurable. */
  function strikeFixture(): {
    raid: LiveRaidState;
    player: LiveRaidCell;
    target: LiveRaidState["clankers"][number];
  } {
    const raid = createLiveRaid(makeBunker([{ col: 8, row: 5, depth: 0 }]), 1);
    // Retire the rest of the wave so only the target can be hit.
    for (let i = 1; i < raid.clankers.length; i++) {
      raid.clankers[i].alive = false;
    }
    const target = raid.clankers[0];
    target.x = 9;
    target.y = 5;
    target.z = 0;
    target.col = 9;
    target.row = 5;
    return { raid, player: { col: 8, row: 5, depth: 0 }, target };
  }

  const AIM_PLUS_COL: LiveRaidCell = { col: 1, row: 0, depth: 0 };

  it("scales damage by pickaxe level", () => {
    expect(pickaxeStrikeDamage(1)).toBe(
      LIVE_PICKAXE_BASE_DAMAGE + LIVE_PICKAXE_DAMAGE_PER_LEVEL,
    );
    expect(pickaxeStrikeDamage(2)).toBe(
      LIVE_PICKAXE_BASE_DAMAGE + 2 * LIVE_PICKAXE_DAMAGE_PER_LEVEL,
    );
    // A missing or sub-1 level still swings as level 1.
    expect(pickaxeStrikeDamage(0)).toBe(pickaxeStrikeDamage(1));
  });

  it("drains the aimed Clanker's energy and stamps the hit tick", () => {
    const { raid, player, target } = strikeFixture();
    const before = target.energy;
    const hit = strikeLiveRaid(raid, player, AIM_PLUS_COL, 12);
    expect(hit).toBe(target);
    expect(target.energy).toBe(before - 12);
    expect(target.hurtTick).toBe(raid.tick);
  });

  it("refuses a second strike inside the cooldown", () => {
    const { raid, player, target } = strikeFixture();
    expect(strikeLiveRaid(raid, player, AIM_PLUS_COL, 12)).toBe(target);
    const afterFirst = target.energy;
    expect(strikeLiveRaid(raid, player, AIM_PLUS_COL, 12)).toBeNull();
    expect(target.energy).toBe(afterFirst);
    // Past the cooldown it connects again.
    raid.tick += LIVE_PLAYER_STRIKE_COOLDOWN_TICKS;
    expect(strikeLiveRaid(raid, player, AIM_PLUS_COL, 12)).toBe(target);
  });

  it("misses what is out of reach or outside the aim cone", () => {
    const { raid, player, target } = strikeFixture();
    // Beyond reach along the same axis.
    target.x = player.col + LIVE_PLAYER_STRIKE_REACH + 0.5;
    expect(strikeLiveRaid(raid, player, AIM_PLUS_COL, 12)).toBeNull();
    // In reach but behind the miner.
    target.x = player.col + 1;
    expect(
      strikeLiveRaid(raid, player, { col: -1, row: 0, depth: 0 }, 12),
    ).toBeNull();
    // In reach and in front: connects.
    expect(strikeLiveRaid(raid, player, AIM_PLUS_COL, 12)).toBe(target);
  });

  it("hits only the nearest Clanker in the cone, so one swing cannot clear a pack", () => {
    const raid = createLiveRaid(makeBunker([{ col: 8, row: 5, depth: 0 }]), 1);
    for (let i = 2; i < raid.clankers.length; i++) {
      raid.clankers[i].alive = false;
    }
    const near = raid.clankers[0];
    const far = raid.clankers[1];
    near.x = 8.8;
    near.y = 5;
    near.z = 0;
    near.col = 9;
    near.row = 5;
    far.x = 9.4;
    far.y = 5;
    far.z = 0;
    far.col = 9;
    far.row = 5;
    const farEnergy = far.energy;
    expect(
      strikeLiveRaid(raid, { col: 8, row: 5, depth: 0 }, AIM_PLUS_COL, 12),
    ).toBe(near);
    expect(far.energy).toBe(farEnergy);
  });

  it("cannot reach a Clanker still out in the approach, matching the bite rule", () => {
    // The render layer draws nothing outside the footprint, so a body out
    // in the shell rock is neither a threat nor a target. Park the Clanker
    // one cell in front of the miner but on an approach cell.
    const { raid, player, target } = strikeFixture();
    target.col = FOOTPRINT.col - 1;
    target.row = FOOTPRINT.row;
    target.x = player.col + 1;
    expect(containsBunkerCell(FOOTPRINT, target.col, target.row)).toBe(false);
    expect(strikeLiveRaid(raid, player, AIM_PLUS_COL, 12)).toBeNull();
    expect(target.energy).toBe(
      LIVE_CLANKER_BASE_ENERGY + LIVE_CLANKER_ENERGY_PER_TIER,
    );
  });

  it("kills at zero energy, records a pickaxe death, and drops XP", () => {
    const { raid, player, target } = strikeFixture();
    strikeLiveRaid(raid, player, AIM_PLUS_COL, target.energy);
    expect(target.alive).toBe(false);
    expect(target.death).toBe("pickaxe");
    expect(raid.xpPickups).toHaveLength(1);
    // The last Clanker down ends the raid as a win.
    expect(raid.outcome).toBe("won");
  });

  it("is inert once the raid has settled", () => {
    const { raid, player, target } = strikeFixture();
    raid.outcome = "lost";
    expect(strikeLiveRaid(raid, player, AIM_PLUS_COL, 12)).toBeNull();
    expect(target.alive).toBe(true);
  });

  it("balances a level-2 pickaxe to beat one Clanker but not two", () => {
    // The authored tuning target: a level-2 pickaxe fends off a single
    // tier-1 Clanker with health to spare, and loses to a pair. Modelled
    // head-on with both sides at full rate, which is the worst case for
    // the player (no kiting, no layout help).
    const damage = pickaxeStrikeDamage(2);
    const bite = clankerPlayerBiteDamage(1, "standard");
    const energy = LIVE_CLANKER_BASE_ENERGY + LIVE_CLANKER_ENERGY_PER_TIER;
    const strikesToKill = Math.ceil(energy / damage);
    const ticksToKill = strikesToKill * LIVE_PLAYER_STRIKE_COOLDOWN_TICKS;
    const bitesTaken = Math.floor(ticksToKill / LIVE_CLANKER_BITE_PERIOD_TICKS);

    // One Clanker: survivable, and not so cheap that it is a formality.
    const soloDamage = bitesTaken * bite;
    expect(soloDamage).toBeLessThan(LIVE_PLAYER_MAX_HEALTH);
    expect(soloDamage).toBeGreaterThan(LIVE_PLAYER_MAX_HEALTH * 0.2);

    // Two Clankers, killed one at a time (a swing hits one target), take
    // the miner past the bar before the second one falls.
    expect(bitesTaken * 2 * bite + bitesTaken * bite).toBeGreaterThan(
      LIVE_PLAYER_MAX_HEALTH,
    );
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
    // Past the staged onset plus a few action ticks: the lead Clanker
    // activates, descends to the wall, and bites it.
    stepTimes(raid, player, LIVE_RAID_ONSET_TICKS + 12);
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
    // Step past the staged onset and the lead's breach hold to a point
    // where it has crossed depth 2 but not yet reached the player at
    // depth 4.
    const crossed = LIVE_RAID_ONSET_TICKS + LIVE_CLANKER_BREACH_HOLD_TICKS + 5;
    stepTimes(withSpike, player, crossed);
    stepTimes(noSpike, player, crossed);
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
