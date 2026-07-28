/**
 * Live first-person bunker raid sim (Q-024 option D).
 *
 * This is the client-run, movement-matters raid model. The player walks
 * the bunker in first person while a wave of Clankers flows toward the
 * player's live 3D position, chewing through placed blocking parts to get
 * in, spending energy to move, chew, and cross spikes, and dying when
 * their energy runs out.
 *
 * Melee combat (dev direction 2026-07-27). Clankers used to hop cell to
 * cell and kill the miner outright on contact, so a raid read as bodies
 * crawling the rock nearby and then a sudden loss. Now the fight is a
 * physical one: a Clanker's body carries a continuous position that it
 * walks every tick, the grid route only picks its next waypoint, and once
 * it is a few open cells from the player it drops the route and beelines
 * at the player's live position, so it pursues a fleeing miner instead of
 * hopping between neighboring cells. Contact is a bite that costs player
 * health on a cooldown, and the miner swings back: {@link strikeLiveRaid}
 * lands a pickaxe hit on the nearest Clanker in the aim cone. Only the
 * bite that empties the health bar kills the miner (the Clanker that lands
 * it self-destructs, keeping the GDD's death fantasy). The tuning target
 * is that a level-2 pickaxe fends off one Clanker but loses to two.
 *
 * Authority: the client steps this sim in real time against the rig's
 * position and reports a bounded outcome; the server trusts it against a
 * frozen start snapshot (no server replay, no cross-engine determinism,
 * per Q-024). This module is nonetheless deterministic given the same
 * (snapshot, tier, per-tick player-position sequence, strike sequence):
 * spawns and tie-breaks are index-ordered, so no rng is needed.
 *
 * Connectivity (Q-020, "sealed is safe"): undug claim rock is impassable
 * and unchewable. Clankers travel the open mine approach and dug cells and
 * chew placed blocking parts; a claim with no dug opening out to the mine
 * is unreachable, so every Clanker idle-drains and dies and the raid is a
 * guaranteed survive. Digging out for space and rewards is also how
 * Clankers get in.
 *
 * Pure per the sim contract: no react/next/three/zustand imports, no
 * seedless randomness, and no transcendental math (sin/cos/pow/log and the
 * like differ across JS engines). Integer state, arithmetic and
 * floor/min/max/abs only.
 */

import {
  BASE_PART_CATALOG,
  BASIC_TURRET_AMMO,
  type BasePartId,
  BUNKER_CLAIM_DEPTH,
  BUNKER_RAID_DURATION_SECONDS,
  type BunkerFootprint,
  type BunkerSlot,
  type BunkerState,
  CLANKER_BASE_BITE_DAMAGE,
  CLANKER_BITE_DAMAGE_PER_TIER,
  CLANKER_BREACHER_BITE_FACTOR,
  CLANKER_TANK_TURRET_SHOTS,
  type ClankerKind,
  clankerKindFor,
  clankerXpFor,
  containsBunkerCell,
  type DugBunkerCell,
} from "./bunker";

export const BUNKER_RAID_LIVE_VERSION = 1;

/** Sim ticks per second. The client steps at this cadence in real time. */
export const LIVE_RAID_TICKS_PER_SECOND = 6;

/** Seconds of raid time one tick covers; the step size continuous Clanker
 * motion integrates over. */
export const LIVE_RAID_TICK_SECONDS = 1 / LIVE_RAID_TICKS_PER_SECOND;

/** Total ticks in a raid; a timeout with the player alive is a survive. */
export const LIVE_RAID_DURATION_TICKS =
  BUNKER_RAID_DURATION_SECONDS * LIVE_RAID_TICKS_PER_SECOND;

/** Clankers act (move or chew) once per this many ticks; between action
 * ticks the client interpolates their motion. */
export const LIVE_CLANKER_MOVE_PERIOD_TICKS = 2;

/**
 * Staged wave onset (F-218): a raid used to lose an undefended fresh claim
 * in ~3 seconds, with the whole approach happening inside solid rock where
 * the player can see nothing. The wave now arrives as an invasion the
 * player can watch and fight: nothing acts for the onset window, then one
 * more Clanker activates per stagger interval, so they burrow in one after
 * another instead of all landing at once. A waiting Clanker is inert: it
 * neither moves nor drains energy (it is not yet in the fight), though a
 * turret with line of sight may still pick it off at the wall.
 */
export const LIVE_RAID_ONSET_TICKS = LIVE_RAID_TICKS_PER_SECOND * 6;
export const LIVE_CLANKER_ACTIVATION_STAGGER_TICKS = Math.floor(
  LIVE_RAID_TICKS_PER_SECOND * 2.5,
);

/**
 * A Clanker that just burrowed into the claim holds at its entry cell for
 * this long before it can act again: the emergence is a real event the
 * player can see and dodge, never a same-hop kill through the floor. The
 * render layer's breach animation fits inside this window.
 */
export const LIVE_CLANKER_BREACH_HOLD_TICKS = 5;

/**
 * Energy budget model (dev direction 2026-07-15: steps AND actions cost
 * energy, so distance and defenses both drain Clankers). Values are
 * provisional and meant to be tuned in playtests; the mechanics, not the
 * exact numbers, are what this slice pins.
 */
export const LIVE_CLANKER_BASE_ENERGY = 50;
export const LIVE_CLANKER_ENERGY_PER_TIER = 20;
export const LIVE_MOVE_ENERGY_COST = 1;
export const LIVE_CHEW_ENERGY_COST = 3;
export const LIVE_SPIKE_ENERGY_COST = 12;

/**
 * Travel speed of a Clanker body, in grid cells per second. The miner
 * walks FP_WALK_SPEED (3.0) in the same units, so a standard Clanker is
 * outrun in a straight line but corners you in a 7x5x5 room, a breacher
 * matches your pace, and a tank trades speed for its turret soak. The
 * body moves every tick; the grid route only supplies its next waypoint.
 */
export const LIVE_CLANKER_CHASE_SPEED = 2.6;
export const LIVE_BREACHER_CHASE_SPEED = 3.0;
export const LIVE_TANK_CHASE_SPEED = 2.1;

/**
 * Cost-to-player (in the same units as the pathing field, where an open
 * cell costs 1) at or under which a Clanker abandons its grid waypoint
 * and steers straight at the player's live position. Bounded low so a
 * beeline only ever cuts across cells the route had already opened.
 */
export const LIVE_CLANKER_ENGAGE_COST = 3;

/** How close a Clanker's body must get to bite, in grid cells. */
export const LIVE_CLANKER_BITE_REACH = 0.7;
/** A Clanker bites at most once per second. */
export const LIVE_CLANKER_BITE_PERIOD_TICKS = LIVE_RAID_TICKS_PER_SECOND;

/**
 * Player combat budget. Health is what turns contact from an instant loss
 * into a fight: a tier-1 standard bite is 17, so one Clanker glued to you
 * takes about six seconds to finish the bar and two take three.
 * Provisional, like the energy model above: the mechanics are what this
 * slice pins, the numbers are playtest tuning.
 */
export const LIVE_PLAYER_MAX_HEALTH = 100;
export const LIVE_PLAYER_BITE_BASE = 14;
export const LIVE_PLAYER_BITE_PER_TIER = 3;
/** Breachers bite the miner harder, tanks slightly harder than standard.
 * Deliberately gentler than CLANKER_BREACHER_BITE_FACTOR (2), which is a
 * wall-chewing multiplier, so a single specialist is not a near-instant
 * loss. */
export const LIVE_BREACHER_PLAYER_BITE_FACTOR = 1.5;
export const LIVE_TANK_PLAYER_BITE_FACTOR = 1.25;

/**
 * Pickaxe damage by gear level: 6 + 5 per level, spent against a
 * Clanker's remaining energy (its life force, the same pool travel and
 * chewing drain, so a Clanker that fought its way in dies faster). At
 * level 2 that is 16 a hit, so a tier-1 Clanker arriving with roughly 60
 * energy falls in four strikes, about two seconds, costing the miner
 * around a third of the health bar. Two at once outpace that.
 */
export const LIVE_PICKAXE_BASE_DAMAGE = 6;
export const LIVE_PICKAXE_DAMAGE_PER_LEVEL = 5;
/** Half a second between landed strikes, so swing spam cannot outrun the
 * authored damage rate. */
export const LIVE_PLAYER_STRIKE_COOLDOWN_TICKS = 3;
/** Pickaxe reach in grid cells, measured from the miner's chest. Longer
 * than a Clanker's bite reach, so meeting one head-on and swinging first
 * is the skillful play. */
export const LIVE_PLAYER_STRIKE_REACH = 1.7;
/** Minimum dot product between the aim direction and the direction to a
 * Clanker for the swing to connect (about a 63 degree half-angle). A
 * cone rather than an angle because the sim contract bars acos. */
export const LIVE_PLAYER_STRIKE_DOT = 0.45;

/** Turret fire: a turret with ammo shoots the nearest Clanker within this
 * Chebyshev range along an axis-aligned clear line of sight, once per
 * period. A hit stops a standard or breacher Clanker outright; a tank soaks
 * CLANKER_TANK_TURRET_SHOTS (mirrors the interim resolver). Provisional. */
export const LIVE_TURRET_RANGE = 3;
export const LIVE_TURRET_SHOT_PERIOD_TICKS = LIVE_RAID_TICKS_PER_SECOND;

/** Pathing weight of a still-standing blocking part: passable but far more
 * expensive than open air, so Clankers prefer open routes yet will chew
 * through when a wall is the shortest way in. Not an energy cost (that is
 * LIVE_CHEW_ENERGY_COST); only steers the flow field. */
const CHEW_PATH_WEIGHT = 8;

/** Approach ring around the footprint (depth 0 only) where Clankers spawn
 * and roam the mine before breaching. v1 treats the approach as open mine;
 * real mine terrain integration is a later refinement. */
const APPROACH_MARGIN = 4;

export type LiveRaidOutcome = "active" | "won" | "lost";
export type LiveClankerDeath =
  | "energy"
  | "reached-player"
  | "turret"
  | "pickaxe";

/**
 * A position in the raid's grid space. Integer values name a cell centre;
 * the player's live position and a Clanker's body are continuous, so
 * fractional values are the normal case for both.
 */
export interface LiveRaidCell {
  col: number;
  row: number;
  depth: number;
}

export interface LiveRaidClanker {
  id: string;
  kind: ClankerKind;
  /** The cell the body currently occupies (its position rounded). All
   * grid logic (routing, chewing, spikes, breach, turret sight) keys on
   * this; the body itself lives at {@link x}/{@link y}/{@link z}. */
  col: number;
  row: number;
  depth: number;
  /** Continuous body position in grid space, walked every tick. */
  x: number;
  y: number;
  z: number;
  /** The cell centre the body is walking toward, refreshed on each action
   * tick from the cost-to-player gradient. Ignored while engaged (the
   * body steers at the player instead) or chewing (it holds still). */
  waypointCol: number;
  waypointRow: number;
  waypointDepth: number;
  /** Close enough to the player, over open cells, to drop the route and
   * beeline at the live position. */
  engaged: boolean;
  /** Biting through a blocking part ahead this action window, so the body
   * holds its ground instead of advancing. */
  chewing: boolean;
  energy: number;
  alive: boolean;
  /** Turret shots absorbed so far (tanks soak more than one). */
  hits: number;
  /** Earliest tick this Clanker may bite the miner again. */
  biteReadyTick: number;
  /** Tick it last bit the miner, or -1 (drives the lunge animation). */
  biteTick: number;
  /** Tick a pickaxe strike last landed on it, or -1 (drives the flinch). */
  hurtTick: number;
  /** Tick the Clanker died on, or -1 while alive (for death animation). */
  deathTick: number;
  death: LiveClankerDeath | null;
  /** The Clanker is inert (no move, no bite, no energy spend) until this
   * tick. Seeded by the staggered wave onset (F-218) so the invasion
   * arrives one attacker at a time, and re-armed for the breach hold when
   * the Clanker burrows into the claim, so an emergence is watchable and
   * dodgeable instead of a same-hop kill. */
  inertUntilTick: number;
}

/** A turret defending the bunker: fixed cell and remaining ammo. */
export interface LiveRaidTurret {
  col: number;
  row: number;
  depth: number;
  ammo: number;
}

/** Working copy of a part whose durability the raid mutates. Spikes carry
 * their remaining uses in `durability` too. `slot` is the thin sub-cell slot
 * the part occupies (F-117): a cell can hold more than one wall (one per
 * face), so wear and validation key on the exact slot, not the cell alone.
 * Absent on legacy full-cell parts (at most one per cell). */
export interface LiveRaidPart {
  partId: BasePartId;
  col: number;
  row: number;
  depth: number;
  durability: number;
  slot?: BunkerSlot;
}

export interface LiveRaidXpPickup {
  id: string;
  col: number;
  row: number;
  depth: number;
  defenseXp: number;
  collected: boolean;
}

export interface LiveRaidState {
  version: number;
  raidId: string;
  tier: number;
  tick: number;
  durationTicks: number;
  outcome: LiveRaidOutcome;
  minerKilled: boolean;
  /** The miner's remaining health. Bites take from it; the bite that
   * empties it kills the miner and loses the raid. */
  playerHealth: number;
  playerMaxHealth: number;
  /** Tick the miner last took a bite, or -1 (drives the hurt flash). */
  playerHurtTick: number;
  /** Earliest tick a pickaxe strike may land again. */
  strikeReadyTick: number;
  /** Pickaxe strikes that connected with a Clanker this raid. */
  strikesLanded: number;
  /** True once any Clanker ever entered the bunker footprint (breached the
   * claim), so a survive can distinguish "nothing got in" from "held them
   * off inside". Drives the sealed verdict and the Buttoned Up stamp. */
  breached: boolean;
  footprint: BunkerFootprint;
  /** Frozen open set for the raid; the bunker is locked against edits and
   * digging while a raid runs, so openness only changes as parts break. */
  dug: DugBunkerCell[];
  clankers: LiveRaidClanker[];
  /** Blocking and spike parts only; other cells never gate movement. */
  parts: LiveRaidPart[];
  turrets: LiveRaidTurret[];
  xpPickups: LiveRaidXpPickup[];
}

function cellKey(col: number, row: number, depth: number): string {
  return `${col},${row},${depth}`;
}

/** Identity key for a single placed part. Unlike `cellKey`, this keeps two
 * thin parts in the same cell (e.g. walls on two faces) distinct, so wear and
 * validation never collapse them. Legacy full-cell parts carry no slot and
 * are unique per cell already, so a stable "-" placeholder keeps their key
 * unchanged from the old cell-keyed behavior. */
function partKey(
  col: number,
  row: number,
  depth: number,
  slot: BunkerSlot | undefined,
): string {
  return `${col},${row},${depth},${slot ?? "-"}`;
}

function clankerBiteDamage(tier: number, kind: ClankerKind): number {
  const base = CLANKER_BASE_BITE_DAMAGE + tier * CLANKER_BITE_DAMAGE_PER_TIER;
  return kind === "breacher" ? base * CLANKER_BREACHER_BITE_FACTOR : base;
}

/** Health a bite takes off the miner. Separate from the wall-chewing bite
 * above so the fight tunes without changing how fast walls fall. */
export function clankerPlayerBiteDamage(
  tier: number,
  kind: ClankerKind,
): number {
  const base = LIVE_PLAYER_BITE_BASE + tier * LIVE_PLAYER_BITE_PER_TIER;
  const factor =
    kind === "breacher"
      ? LIVE_BREACHER_PLAYER_BITE_FACTOR
      : kind === "tank"
        ? LIVE_TANK_PLAYER_BITE_FACTOR
        : 1;
  return Math.round(base * factor);
}

/** Energy a single pickaxe strike drains, by mine gear pickaxe level.
 * Gear arrives from persisted saves, so a non-finite level is a real
 * boundary case rather than an impossible one: Math.floor(NaN) is NaN and
 * would poison a Clanker's energy, leaving it unkillable (NaN <= 0 is
 * false) and the raid quietly unwinnable. Anything not finite reads as
 * level 1. */
export function pickaxeStrikeDamage(pickaxeLevel: number): number {
  const level = Number.isFinite(pickaxeLevel)
    ? Math.max(1, Math.floor(pickaxeLevel))
    : 1;
  return LIVE_PICKAXE_BASE_DAMAGE + level * LIVE_PICKAXE_DAMAGE_PER_LEVEL;
}

function clankerChaseSpeed(kind: ClankerKind): number {
  if (kind === "breacher") return LIVE_BREACHER_CHASE_SPEED;
  if (kind === "tank") return LIVE_TANK_CHASE_SPEED;
  return LIVE_CLANKER_CHASE_SPEED;
}

function clankerEnergyFor(tier: number): number {
  return LIVE_CLANKER_BASE_ENERGY + tier * LIVE_CLANKER_ENERGY_PER_TIER;
}

/** Deterministic depth-0 spawn just outside the footprint perimeter,
 * alternating sides and stepping outward so a wave spreads around the
 * claim. Rows lift toward the top of the footprint as the wave grows. */
function clankerSpawn(footprint: BunkerFootprint, index: number): LiveRaidCell {
  const side = index % 2 === 0 ? -1 : 1;
  const rank = Math.floor(index / 2);
  const col =
    side < 0
      ? footprint.col - 1 - (rank % APPROACH_MARGIN)
      : footprint.col + footprint.width + (rank % APPROACH_MARGIN);
  const rowSpread = Math.floor(rank / APPROACH_MARGIN);
  const row = Math.max(
    0,
    footprint.row + Math.min(footprint.height - 1, rowSpread),
  );
  return { col, row, depth: 0 };
}

export function createLiveRaid(
  bunker: BunkerState,
  tier: number,
  raidId = "live-raid-1",
): LiveRaidState {
  const normalizedTier = Math.max(1, Math.floor(tier));
  const clankerCount = 4 + normalizedTier * 2;
  const energy = clankerEnergyFor(normalizedTier);
  const clankers: LiveRaidClanker[] = [];
  for (let i = 0; i < clankerCount; i++) {
    const spawn = clankerSpawn(bunker.footprint, i);
    clankers.push({
      id: `${raidId}-clanker-${i + 1}`,
      kind: clankerKindFor(i, normalizedTier),
      col: spawn.col,
      row: spawn.row,
      depth: spawn.depth,
      x: spawn.col,
      y: spawn.row,
      z: spawn.depth,
      waypointCol: spawn.col,
      waypointRow: spawn.row,
      waypointDepth: spawn.depth,
      engaged: false,
      chewing: false,
      energy,
      alive: true,
      hits: 0,
      biteReadyTick: 0,
      biteTick: -1,
      hurtTick: -1,
      deathTick: -1,
      death: null,
      inertUntilTick:
        LIVE_RAID_ONSET_TICKS + i * LIVE_CLANKER_ACTIVATION_STAGGER_TICKS,
    });
  }
  const parts: LiveRaidPart[] = bunker.parts
    .filter((part) => {
      const def = BASE_PART_CATALOG[part.partId];
      return def.blocksClankers || part.partId === "floor-spikes";
    })
    .map((part) => ({
      partId: part.partId,
      col: part.col,
      row: part.row,
      depth: part.depth,
      durability: part.durability,
      slot: part.slot,
    }));
  const turrets: LiveRaidTurret[] = bunker.parts
    .filter((part) => part.partId === "basic-turret" && part.durability > 0)
    .map((part) => ({
      col: part.col,
      row: part.row,
      depth: part.depth,
      ammo: BASIC_TURRET_AMMO,
    }));
  return {
    version: BUNKER_RAID_LIVE_VERSION,
    raidId,
    tier: normalizedTier,
    tick: 0,
    durationTicks: LIVE_RAID_DURATION_TICKS,
    outcome: "active",
    minerKilled: false,
    playerHealth: LIVE_PLAYER_MAX_HEALTH,
    playerMaxHealth: LIVE_PLAYER_MAX_HEALTH,
    playerHurtTick: -1,
    strikeReadyTick: 0,
    strikesLanded: 0,
    breached: false,
    footprint: bunker.footprint,
    dug: bunker.dug.map((cell) => ({ ...cell })),
    clankers,
    parts,
    turrets,
    xpPickups: [],
  };
}

function livePartAt(
  state: LiveRaidState,
  col: number,
  row: number,
  depth: number,
): LiveRaidPart | undefined {
  return state.parts.find(
    (part) =>
      part.col === col &&
      part.row === row &&
      part.depth === depth &&
      part.durability > 0,
  );
}

function isDug(state: LiveRaidState, cell: LiveRaidCell): boolean {
  return state.dug.some(
    (d) => d.col === cell.col && d.row === cell.row && d.depth === cell.depth,
  );
}

function inApproach(
  footprint: BunkerFootprint,
  col: number,
  row: number,
  depth: number,
): boolean {
  if (depth !== 0) return false;
  if (containsBunkerCell(footprint, col, row)) return false;
  return (
    col >= footprint.col - APPROACH_MARGIN &&
    col < footprint.col + footprint.width + APPROACH_MARGIN &&
    row >= Math.max(0, footprint.row - APPROACH_MARGIN) &&
    row < footprint.row + footprint.height + APPROACH_MARGIN
  );
}

/**
 * Cost for a Clanker to enter a cell, or +Infinity if impassable. Open dug
 * cells and the mine approach cost 1; a still-standing blocking part costs
 * CHEW_PATH_WEIGHT (passable by chewing); undug claim rock and everything
 * outside the searched domain are impassable.
 */
function enterCost(
  state: LiveRaidState,
  col: number,
  row: number,
  depth: number,
): number {
  if (inApproach(state.footprint, col, row, depth)) return 1;
  if (!containsBunkerCell(state.footprint, col, row)) {
    return Number.POSITIVE_INFINITY;
  }
  if (depth < 0 || depth >= BUNKER_CLAIM_DEPTH) {
    return Number.POSITIVE_INFINITY;
  }
  if (!isDug(state, { col, row, depth })) return Number.POSITIVE_INFINITY;
  const part = livePartAt(state, col, row, depth);
  if (part && BASE_PART_CATALOG[part.partId].blocksClankers) {
    return CHEW_PATH_WEIGHT;
  }
  return 1;
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Dijkstra cost-to-player field over the searchable domain, keyed by cell.
 * The player cell is the source (0); every reachable cell gets its cheapest
 * cost to reach the player. Clankers descend this gradient each action
 * tick. Recomputed per action tick because the player moves.
 */
function playerCostField(
  state: LiveRaidState,
  player: LiveRaidCell,
): Map<string, number> {
  const dist = new Map<string, number>();
  const startKey = cellKey(player.col, player.row, player.depth);
  dist.set(startKey, 0);
  // Small domain (7x5x5 plus a depth-0 ring), so a sorted-frontier Dijkstra
  // is more than fast enough and matches the interim resolver's approach.
  const frontier: Array<{ cell: LiveRaidCell; key: string }> = [
    { cell: player, key: startKey },
  ];
  const settled = new Set<string>();
  while (frontier.length > 0) {
    frontier.sort((a, b) => {
      const diff = (dist.get(a.key) ?? 0) - (dist.get(b.key) ?? 0);
      return diff || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
    const current = frontier.shift();
    if (!current) break;
    if (settled.has(current.key)) continue;
    settled.add(current.key);
    const baseCost = dist.get(current.key) ?? 0;
    for (const [dc, dr, dd] of NEIGHBOR_OFFSETS) {
      const col = current.cell.col + dc;
      const row = current.cell.row + dr;
      const depth = current.cell.depth + dd;
      const key = cellKey(col, row, depth);
      if (settled.has(key)) continue;
      const step = enterCost(state, col, row, depth);
      if (!Number.isFinite(step)) continue;
      const next = baseCost + step;
      if (next < (dist.get(key) ?? Number.POSITIVE_INFINITY)) {
        dist.set(key, next);
        frontier.push({ cell: { col, row, depth }, key });
      }
    }
  }
  return dist;
}

function dropXpPickup(state: LiveRaidState, clanker: LiveRaidClanker): void {
  state.xpPickups.push({
    id: `${clanker.id}-xp`,
    col: clanker.col,
    row: clanker.row,
    depth: clanker.depth,
    defenseXp: clankerXpFor(clanker.kind),
    collected: false,
  });
}

function killClanker(
  state: LiveRaidState,
  clanker: LiveRaidClanker,
  death: LiveClankerDeath,
): void {
  clanker.alive = false;
  clanker.energy = 0;
  clanker.deathTick = state.tick;
  clanker.death = death;
  dropXpPickup(state, clanker);
}

/** Spend energy; returns true if the Clanker survives the spend. */
function spendEnergy(
  state: LiveRaidState,
  clanker: LiveRaidClanker,
  amount: number,
): boolean {
  clanker.energy -= amount;
  if (clanker.energy <= 0) {
    killClanker(state, clanker, "energy");
    return false;
  }
  return true;
}

/**
 * Action-tick decision for one Clanker: engage, chew, or aim at the next
 * hop down the cost-to-player gradient. Nothing relocates here; the body
 * walks toward whatever this leaves in the waypoint (or straight at the
 * player, when engaged) on every tick in {@link walkClankerBody}.
 */
function planOneClanker(
  state: LiveRaidState,
  clanker: LiveRaidClanker,
  field: Map<string, number>,
): void {
  // Close enough over open cells to stop following the route and hunt the
  // player's live position directly. This is what makes a Clanker chase a
  // fleeing miner across a room instead of trailing a cell behind. Only
  // ever inside the claim: a body still out in the approach has to take
  // the route in, because that is what records the breach and arms the
  // emergence hold (F-218), and a beeline from out there would just press
  // it into the shell rock.
  const here = field.get(cellKey(clanker.col, clanker.row, clanker.depth));
  if (
    here !== undefined &&
    here <= LIVE_CLANKER_ENGAGE_COST &&
    containsBunkerCell(state.footprint, clanker.col, clanker.row)
  ) {
    clanker.engaged = true;
    clanker.chewing = false;
    return;
  }
  clanker.engaged = false;

  // Choose the neighbor that most reduces cost-to-player.
  let bestCol = 0;
  let bestRow = 0;
  let bestDepth = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const [dc, dr, dd] of NEIGHBOR_OFFSETS) {
    const col = clanker.col + dc;
    const row = clanker.row + dr;
    const depth = clanker.depth + dd;
    if (!Number.isFinite(enterCost(state, col, row, depth))) continue;
    const cost = field.get(cellKey(col, row, depth));
    if (cost === undefined) continue;
    if (cost < bestCost) {
      bestCost = cost;
      bestCol = col;
      bestRow = row;
      bestDepth = depth;
    }
  }

  if (!Number.isFinite(bestCost)) {
    // Stalled (walled in by rock, or player unreachable): idle-drain so the
    // raid still terminates and a sealed fortress resolves to a survive.
    clanker.chewing = false;
    clanker.waypointCol = clanker.col;
    clanker.waypointRow = clanker.row;
    clanker.waypointDepth = clanker.depth;
    spendEnergy(state, clanker, LIVE_MOVE_ENERGY_COST);
    return;
  }

  const blocker = livePartAt(state, bestCol, bestRow, bestDepth);
  if (blocker && BASE_PART_CATALOG[blocker.partId].blocksClankers) {
    // Chew the wall instead of advancing; break it open when durability
    // runs out so the nav mid-raid opens up for the swarm.
    clanker.chewing = true;
    clanker.waypointCol = clanker.col;
    clanker.waypointRow = clanker.row;
    clanker.waypointDepth = clanker.depth;
    blocker.durability -= clankerBiteDamage(state.tier, clanker.kind);
    spendEnergy(state, clanker, LIVE_CHEW_ENERGY_COST);
    return;
  }

  clanker.chewing = false;
  clanker.waypointCol = bestCol;
  clanker.waypointRow = bestRow;
  clanker.waypointDepth = bestDepth;
}

/** A body may settle only in a genuinely open cell: enterCost returns 1
 * there, CHEW_PATH_WEIGHT where a wall still stands, and +Infinity in
 * rock. Keeps an engaged beeline from cutting through a corner the route
 * would have walked around. */
function clankerCanOccupy(
  state: LiveRaidState,
  col: number,
  row: number,
  depth: number,
): boolean {
  return enterCost(state, col, row, depth) === 1;
}

/** Apply everything that happens when a body's cell changes: the move's
 * energy, the breach flag and its emergence hold, and any spike it just
 * stepped onto. */
function enterCell(
  state: LiveRaidState,
  clanker: LiveRaidClanker,
  col: number,
  row: number,
  depth: number,
): void {
  const wasInside = containsBunkerCell(
    state.footprint,
    clanker.col,
    clanker.row,
  );
  clanker.col = col;
  clanker.row = row;
  clanker.depth = depth;
  // Entering the footprint counts as a breach, even if the Clanker dies on
  // the very cell it entered: the claim was no longer sealed. Recorded
  // before the move's energy is spent, because a Clanker whose last energy
  // goes on the entering hop still got in, and a missed flag here would
  // wrongly hand out the sealed verdict and the Buttoned Up stamp.
  const nowInside = containsBunkerCell(state.footprint, col, row);
  if (nowInside) state.breached = true;
  if (!spendEnergy(state, clanker, LIVE_MOVE_ENERGY_COST)) return;

  // Crossing a live spike drains extra energy and consumes a spike use.
  const spike = livePartAt(state, col, row, depth);
  if (spike && spike.partId === "floor-spikes") {
    spike.durability -= 1;
    if (!spendEnergy(state, clanker, LIVE_SPIKE_ENERGY_COST)) return;
  }

  // The hop that burrows into the claim is the emergence: the Clanker
  // holds there while it surfaces (F-218) and cannot bite on this hop, so
  // breaching through the floor under the player's feet is dodgeable
  // instead of an invisible same-tick death.
  if (nowInside && !wasInside) {
    clanker.inertUntilTick = state.tick + LIVE_CLANKER_BREACH_HOLD_TICKS;
  }
}

/**
 * Move the body to an exact position if the cell it lands in is open,
 * applying the cell-entry effects when it crosses into a new one.
 * Returns false and mutates nothing when the destination is rock or a
 * standing wall, so the caller can try a different step.
 */
function tryClankerStep(
  state: LiveRaidState,
  clanker: LiveRaidClanker,
  nextX: number,
  nextY: number,
  nextZ: number,
): boolean {
  const nextCol = Math.round(nextX);
  const nextRow = Math.round(nextY);
  const nextDepth = Math.round(nextZ);
  const changedCell =
    nextCol !== clanker.col ||
    nextRow !== clanker.row ||
    nextDepth !== clanker.depth;
  if (changedCell && !clankerCanOccupy(state, nextCol, nextRow, nextDepth)) {
    return false;
  }
  clanker.x = nextX;
  clanker.y = nextY;
  clanker.z = nextZ;
  if (changedCell) enterCell(state, clanker, nextCol, nextRow, nextDepth);
  return true;
}

/**
 * Walk one Clanker's body toward its steering target for `seconds` of
 * real time: the player's live position while engaged, otherwise its
 * waypoint cell centre. A chewing Clanker holds its ground.
 *
 * An engaged beeline is not axis-aligned, so it can aim diagonally
 * through a corner of rock. When the full step is refused the body slides
 * along whichever single axis is legal instead, which keeps it moving
 * around the obstacle rather than pressing into it forever.
 */
function walkClankerBody(
  state: LiveRaidState,
  clanker: LiveRaidClanker,
  player: LiveRaidCell,
  seconds: number,
): void {
  if (clanker.chewing) return;
  const targetX = clanker.engaged ? player.col : clanker.waypointCol;
  const targetY = clanker.engaged ? player.row : clanker.waypointRow;
  const targetZ = clanker.engaged ? player.depth : clanker.waypointDepth;
  const dx = targetX - clanker.x;
  const dy = targetY - clanker.y;
  const dz = targetZ - clanker.z;
  const distanceSq = dx * dx + dy * dy + dz * dz;
  if (distanceSq <= 0) return;
  const distance = Math.sqrt(distanceSq);
  const step = clankerChaseSpeed(clanker.kind) * seconds;
  const scale = step >= distance ? 1 : step / distance;
  const nextX = clanker.x + dx * scale;
  const nextY = clanker.y + dy * scale;
  const nextZ = clanker.z + dz * scale;

  if (tryClankerStep(state, clanker, nextX, nextY, nextZ)) return;
  if (tryClankerStep(state, clanker, nextX, clanker.y, clanker.z)) return;
  if (tryClankerStep(state, clanker, clanker.x, nextY, clanker.z)) return;
  tryClankerStep(state, clanker, clanker.x, clanker.y, nextZ);
}

/** Bite the miner if the body has closed to within reach and the bite
 * cooldown has expired. The bite that empties the health bar kills the
 * miner and self-destructs the Clanker that landed it (the GDD's death
 * fantasy, now the end of a fight rather than first contact). */
function maybeBitePlayer(
  state: LiveRaidState,
  clanker: LiveRaidClanker,
  player: LiveRaidCell,
): void {
  // Only a Clanker that is actually in the room may bite. Bite reach is
  // continuous, so without this a body still out in the approach could
  // reach a miner standing against the rock face, through a wall the
  // render layer deliberately does not draw it behind (F-218: nothing
  // invisible may hurt you).
  if (!containsBunkerCell(state.footprint, clanker.col, clanker.row)) return;
  if (state.tick < clanker.biteReadyTick) return;
  const dx = player.col - clanker.x;
  const dy = player.row - clanker.y;
  const dz = player.depth - clanker.z;
  if (
    dx * dx + dy * dy + dz * dz >
    LIVE_CLANKER_BITE_REACH * LIVE_CLANKER_BITE_REACH
  ) {
    return;
  }
  clanker.biteReadyTick = state.tick + LIVE_CLANKER_BITE_PERIOD_TICKS;
  clanker.biteTick = state.tick;
  state.playerHealth -= clankerPlayerBiteDamage(state.tier, clanker.kind);
  state.playerHurtTick = state.tick;
  if (state.playerHealth <= 0) {
    state.playerHealth = 0;
    state.minerKilled = true;
    killClanker(state, clanker, "reached-player");
  }
}

/** A cell blocks a turret's line of sight when it is undug rock or holds a
 * standing blocking part. Open dug cells, the mine approach, spikes, and
 * turrets do not block the shot. */
function blocksSight(
  state: LiveRaidState,
  col: number,
  row: number,
  depth: number,
): boolean {
  if (inApproach(state.footprint, col, row, depth)) return false;
  if (!containsBunkerCell(state.footprint, col, row)) return true;
  if (depth < 0 || depth >= BUNKER_CLAIM_DEPTH) return true;
  if (!isDug(state, { col, row, depth })) return true;
  const part = livePartAt(state, col, row, depth);
  return Boolean(part && BASE_PART_CATALOG[part.partId].blocksClankers);
}

/** Manhattan distance of an axis-aligned, in-range, unobstructed turret shot
 * at the Clanker, or null if the turret cannot see it. Axis-aligned means
 * exactly one coordinate differs, so the shot travels a cardinal line. */
function turretShotDistance(
  state: LiveRaidState,
  turret: LiveRaidTurret,
  clanker: LiveRaidClanker,
): number | null {
  const dCol = clanker.col - turret.col;
  const dRow = clanker.row - turret.row;
  const dDepth = clanker.depth - turret.depth;
  const axes =
    (dCol !== 0 ? 1 : 0) + (dRow !== 0 ? 1 : 0) + (dDepth !== 0 ? 1 : 0);
  if (axes !== 1) return null;
  const distance = Math.abs(dCol) + Math.abs(dRow) + Math.abs(dDepth);
  if (distance < 1 || distance > LIVE_TURRET_RANGE) return null;
  const stepCol = dCol === 0 ? 0 : dCol > 0 ? 1 : -1;
  const stepRow = dRow === 0 ? 0 : dRow > 0 ? 1 : -1;
  const stepDepth = dDepth === 0 ? 0 : dDepth > 0 ? 1 : -1;
  for (let i = 1; i < distance; i++) {
    if (
      blocksSight(
        state,
        turret.col + stepCol * i,
        turret.row + stepRow * i,
        turret.depth + stepDepth * i,
      )
    ) {
      return null;
    }
  }
  return distance;
}

function clankerShotsToStop(kind: ClankerKind): number {
  return kind === "tank" ? CLANKER_TANK_TURRET_SHOTS : 1;
}

/** Fire every turret with ammo at the nearest Clanker it can see (ties break
 * by Clanker id for determinism). A hit spends one ammo and adds to the
 * target's soak; a Clanker that has taken enough shots dies and drops its
 * XP. A standard or breacher falls to one shot, a tank to
 * CLANKER_TANK_TURRET_SHOTS. */
function fireTurrets(state: LiveRaidState): void {
  for (const turret of state.turrets) {
    if (turret.ammo <= 0) continue;
    let target: LiveRaidClanker | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const clanker of state.clankers) {
      if (!clanker.alive) continue;
      const distance = turretShotDistance(state, turret, clanker);
      if (distance === null) continue;
      if (
        distance < bestDistance ||
        (distance === bestDistance && target !== null && clanker.id < target.id)
      ) {
        bestDistance = distance;
        target = clanker;
      }
    }
    if (!target) continue;
    turret.ammo -= 1;
    target.hits += 1;
    if (target.hits >= clankerShotsToStop(target.kind)) {
      killClanker(state, target, "turret");
    }
  }
}

/** Reused cell scratch for the player's rounded position: the cost field
 * and pickup collection are cell-granular while the live position is
 * continuous. Written and consumed inside one call, so the module stays
 * free of cross-call state and the frame path allocates nothing. */
const playerCellScratch: LiveRaidCell = { col: 0, row: 0, depth: 0 };

function roundPlayerCell(player: LiveRaidCell): LiveRaidCell {
  playerCellScratch.col = Math.round(player.col);
  playerCellScratch.row = Math.round(player.row);
  playerCellScratch.depth = Math.round(player.depth);
  return playerCellScratch;
}

/**
 * Advance the raid one tick against the player's live position. Mutates
 * `state` in place and returns it. Every tick each active Clanker walks
 * its body toward its steering target and bites if it has closed to
 * reach; on action ticks the cost-to-player field is rebuilt and each
 * Clanker re-decides whether to engage, chew, or aim at a new waypoint.
 * The outcome settles to "lost" when a bite empties the miner's health,
 * and to "won" when the last Clanker dies or the duration elapses with
 * the miner alive.
 */
export function stepLiveRaid(
  state: LiveRaidState,
  player: LiveRaidCell,
): LiveRaidState {
  if (state.outcome !== "active") return state;
  state.tick += 1;

  // Turrets fire first so they can thin the wave before it advances.
  if (state.tick % LIVE_TURRET_SHOT_PERIOD_TICKS === 0) {
    fireTurrets(state);
  }

  const isActionTick = state.tick % LIVE_CLANKER_MOVE_PERIOD_TICKS === 0;
  const field = isActionTick
    ? playerCostField(state, roundPlayerCell(player))
    : null;
  for (const clanker of state.clankers) {
    if (!clanker.alive) continue;
    // Inert: still burrowing in (staged onset) or finishing its breach
    // emergence (F-218). It holds in place, spends nothing, and cannot
    // bite yet.
    if (state.tick < clanker.inertUntilTick) continue;
    if (field) planOneClanker(state, clanker, field);
    if (!clanker.alive) continue;
    walkClankerBody(state, clanker, player, LIVE_RAID_TICK_SECONDS);
    if (!clanker.alive) continue;
    // Re-read the hold: the step just taken may have burrowed into the
    // claim and armed the emergence window (F-218), and that arrival must
    // not also bite on the tick it lands.
    if (state.tick < clanker.inertUntilTick) continue;
    maybeBitePlayer(state, clanker, player);
    if (state.minerKilled) break;
  }

  if (state.minerKilled) {
    state.outcome = "lost";
    return state;
  }
  const anyAlive = state.clankers.some((clanker) => clanker.alive);
  if (!anyAlive || state.tick >= state.durationTicks) {
    state.outcome = "won";
  }
  return state;
}

/**
 * Land one pickaxe swing. Hits the single nearest live Clanker whose body
 * sits inside the aim cone within {@link LIVE_PLAYER_STRIKE_REACH}, and
 * only one, so wading into a pack cannot clear it with one swing. The
 * damage comes off the target's energy (its life force, the same pool
 * travel and chewing drain). Returns the Clanker hit, or null when the
 * swing was on cooldown, aimed at nothing, or the raid is over.
 *
 * `from` is the miner's live position and `dir` its aim direction, both
 * in grid space; `dir` need not be normalized.
 */
export function strikeLiveRaid(
  state: LiveRaidState,
  from: LiveRaidCell,
  dir: LiveRaidCell,
  damage: number,
): LiveRaidClanker | null {
  if (state.outcome !== "active") return null;
  if (state.tick < state.strikeReadyTick) return null;
  const dirLengthSq =
    dir.col * dir.col + dir.row * dir.row + dir.depth * dir.depth;
  if (dirLengthSq <= 0) return null;
  const dirLength = Math.sqrt(dirLengthSq);

  let target: LiveRaidClanker | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const clanker of state.clankers) {
    if (!clanker.alive) continue;
    // Only what the room draws can be struck, mirroring the same rule on
    // bites: a body still out in the approach is buried in the claim's
    // shell rock and must be neither a threat nor a target.
    if (!containsBunkerCell(state.footprint, clanker.col, clanker.row)) {
      continue;
    }
    const dx = clanker.x - from.col;
    const dy = clanker.y - from.row;
    const dz = clanker.z - from.depth;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > LIVE_PLAYER_STRIKE_REACH * LIVE_PLAYER_STRIKE_REACH) {
      continue;
    }
    if (distanceSq >= bestDistance) continue;
    // Point-blank (the body overlapping the miner) always connects; the
    // cone test would divide by zero there.
    if (distanceSq > 0) {
      const dot =
        (dx * dir.col + dy * dir.row + dz * dir.depth) /
        (Math.sqrt(distanceSq) * dirLength);
      if (dot < LIVE_PLAYER_STRIKE_DOT) continue;
    }
    bestDistance = distanceSq;
    target = clanker;
  }
  if (!target) return null;

  state.strikeReadyTick = state.tick + LIVE_PLAYER_STRIKE_COOLDOWN_TICKS;
  state.strikesLanded += 1;
  target.hurtTick = state.tick;
  target.energy -= damage;
  if (target.energy <= 0) killClanker(state, target, "pickaxe");
  if (!state.clankers.some((clanker) => clanker.alive)) {
    state.outcome = "won";
  }
  return target;
}

/** Mark the XP pickup at a position collected (the player walks over it in
 * first person). Pickups sit on cell centres and the live position is
 * continuous, so the position rounds to its cell here. Returns the XP
 * gained, or 0 if none/there already. Loss grants nothing because the raid
 * never reaches a collectible survive. */
export function collectLiveRaidPickup(
  state: LiveRaidState,
  position: LiveRaidCell,
): number {
  if (state.outcome === "lost") return 0;
  const cell = roundPlayerCell(position);
  const pickup = state.xpPickups.find(
    (p) =>
      !p.collected &&
      p.col === cell.col &&
      p.row === cell.row &&
      p.depth === cell.depth,
  );
  if (!pickup) return 0;
  pickup.collected = true;
  return pickup.defenseXp;
}

/** A sealed raid is a survive where no Clanker ever entered the footprint:
 * the claim held everything off. Drives the Buttoned Up stamp. A lost or
 * breached raid is never sealed. */
export function liveRaidSealed(state: LiveRaidState): boolean {
  return state.outcome === "won" && !state.breached;
}

/** Defense XP actually banked from a raid: the sum of collected pickups.
 * A lost raid returns 0 (no survival reward), matching interim raids. */
export function liveRaidDefenseXp(state: LiveRaidState): number {
  if (state.outcome === "lost") return 0;
  return state.xpPickups.reduce(
    (sum, pickup) => sum + (pickup.collected ? pickup.defenseXp : 0),
    0,
  );
}

/** Per-part durability the raid ended on, so the caller can persist wear
 * onto the real bunker parts. Only parts that could take damage (blocking
 * parts and spikes) are tracked; durability is clamped at 0. */
export function liveRaidPartWear(state: LiveRaidState): LiveRaidPart[] {
  return state.parts.map((part) => ({
    ...part,
    durability: Math.max(0, part.durability),
  }));
}

/** Grace ticks after the authored duration before an unresolved raid is
 * force-settled by the server (F-105). Also the upper bound the outcome
 * validator allows on a reported end tick. */
export const LIVE_RAID_EXPIRY_GRACE_TICKS = LIVE_RAID_TICKS_PER_SECOND * 60;

/** Clankers in a wave of the given tier. */
export function liveRaidWaveSize(tier: number): number {
  return 4 + Math.max(1, Math.floor(tier)) * 2;
}

/** Highest defense XP a tier's wave can be worth: the sum of every
 * Clanker's kill value. The server caps a reported reward by this. */
export function liveRaidMaxDefenseXp(tier: number): number {
  const normalizedTier = Math.max(1, Math.floor(tier));
  const count = liveRaidWaveSize(normalizedTier);
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += clankerXpFor(clankerKindFor(i, normalizedTier));
  }
  return total;
}

/**
 * The bounded outcome a client reports to the server after a raid settles.
 * Under Q-024 option D the server trusts this against the frozen start
 * snapshot instead of replaying the raid, so it is kept deliberately small
 * (F-110): a verdict, the wave attrition, the earned XP, and the surviving
 * part durability.
 */
export interface LiveRaidOutcomeReport {
  version: number;
  raidId: string;
  outcome: "won" | "lost";
  minerKilled: boolean;
  /** Survive with nothing ever entering the footprint (Buttoned Up). */
  sealed: boolean;
  endedTick: number;
  clankersKilled: number;
  defenseXp: number;
  partWear: LiveRaidPart[];
}

/** Derive the reportable outcome from a settled raid. Call only on a
 * finished raid; an "active" state reports as a win, which the validator's
 * consistency checks would still bound. */
export function liveRaidOutcomeReport(
  state: LiveRaidState,
): LiveRaidOutcomeReport {
  return {
    version: state.version,
    raidId: state.raidId,
    outcome: state.outcome === "lost" ? "lost" : "won",
    minerKilled: state.minerKilled,
    sealed: liveRaidSealed(state),
    endedTick: state.tick,
    clankersKilled: state.clankers.filter((clanker) => !clanker.alive).length,
    defenseXp: liveRaidDefenseXp(state),
    partWear: liveRaidPartWear(state),
  };
}

export type LiveRaidOutcomeRejection =
  | "version"
  | "outcome-shape"
  | "outcome-consistency"
  | "sealed-on-loss"
  | "tick-range"
  | "clankers-range"
  | "reward-on-loss"
  | "reward-range"
  | "part-wear";

/**
 * Light server-side bounds on a client-reported outcome (F-110). This is
 * not a replay: it only proves the report is internally consistent and no
 * better than the frozen snapshot and wave could possibly produce, so a
 * client cannot inflate a reward, under-report damage, or fabricate a
 * defense. `bunker` is the frozen start snapshot.
 */
export function validateLiveRaidOutcome(
  bunker: BunkerState,
  tier: number,
  report: LiveRaidOutcomeReport,
): { ok: true } | { ok: false; reason: LiveRaidOutcomeRejection } {
  if (report.version !== BUNKER_RAID_LIVE_VERSION) {
    return { ok: false, reason: "version" };
  }
  if (report.outcome !== "won" && report.outcome !== "lost") {
    return { ok: false, reason: "outcome-shape" };
  }
  // A loss is exactly a miner death; a win is exactly no miner death.
  if ((report.outcome === "lost") !== report.minerKilled) {
    return { ok: false, reason: "outcome-consistency" };
  }
  // A lost raid can never be sealed (a breach happened by definition). A
  // sealed win is trusted: it only gates a cosmetic stamp, so proving it
  // against the snapshot is not worth a replay.
  if (report.sealed && report.outcome !== "won") {
    return { ok: false, reason: "sealed-on-loss" };
  }
  if (
    !Number.isInteger(report.endedTick) ||
    report.endedTick < 0 ||
    report.endedTick > LIVE_RAID_DURATION_TICKS + LIVE_RAID_EXPIRY_GRACE_TICKS
  ) {
    return { ok: false, reason: "tick-range" };
  }
  const waveSize = liveRaidWaveSize(tier);
  if (
    !Number.isInteger(report.clankersKilled) ||
    report.clankersKilled < 0 ||
    report.clankersKilled > waveSize
  ) {
    return { ok: false, reason: "clankers-range" };
  }
  if (report.outcome === "lost" && report.defenseXp !== 0) {
    return { ok: false, reason: "reward-on-loss" };
  }
  if (
    !Number.isFinite(report.defenseXp) ||
    report.defenseXp < 0 ||
    report.defenseXp > liveRaidMaxDefenseXp(tier)
  ) {
    return { ok: false, reason: "reward-range" };
  }
  // The report must account for exactly the snapshot's blocking and spike
  // parts, each mapped to a distinct slot with durability only ever reduced,
  // so a client cannot fabricate a defense, claim it took no damage where it
  // did, or omit a damaged part to keep it pristine. Keyed by slot, not cell,
  // so two thin walls sharing a cell stay distinct (F-117). Turrets are not
  // durability-tracked and are absent by design.
  const snapshotParts = new Map<string, number>();
  for (const part of bunker.parts) {
    const def = BASE_PART_CATALOG[part.partId];
    if (!def.blocksClankers && part.partId !== "floor-spikes") continue;
    snapshotParts.set(
      partKey(part.col, part.row, part.depth, part.slot),
      part.durability,
    );
  }
  if (report.partWear.length !== snapshotParts.size) {
    return { ok: false, reason: "part-wear" };
  }
  const seen = new Set<string>();
  for (const worn of report.partWear) {
    const key = partKey(worn.col, worn.row, worn.depth, worn.slot);
    const original = snapshotParts.get(key);
    if (original === undefined || seen.has(key)) {
      return { ok: false, reason: "part-wear" };
    }
    seen.add(key);
    if (
      !Number.isFinite(worn.durability) ||
      worn.durability < 0 ||
      worn.durability > original
    ) {
      return { ok: false, reason: "part-wear" };
    }
  }
  return { ok: true };
}

export const LIVE_RAID_SURVIVE_VIBES_BASE = 20;
export const LIVE_RAID_SURVIVE_VIBES_PER_TIER = 10;

/** The result of settling a raid: the frozen snapshot with part wear
 * applied, plus the verdict and the reward to credit. */
export interface LiveRaidSettlement {
  bunker: BunkerState;
  survived: boolean;
  sealed: boolean;
  reward: { vibes: number; defenseXp: number };
}

/**
 * Settle a client-reported raid outcome against the frozen start snapshot
 * (F-105/F-108): validate the report, then compute the worn bunker and the
 * reward to grant, all purely so the resolve route only has to persist the
 * result. A survive grants vibes scaled by tier (mirroring the interim
 * raid) plus the collected defense XP the report carries; a loss grants
 * nothing (matching interim raids). `bunker` is the frozen snapshot.
 */
export function settleLiveRaidOutcome(
  bunker: BunkerState,
  tier: number,
  report: LiveRaidOutcomeReport,
):
  | { ok: true; settlement: LiveRaidSettlement }
  | { ok: false; reason: LiveRaidOutcomeRejection } {
  const valid = validateLiveRaidOutcome(bunker, tier, report);
  if (!valid.ok) return valid;
  const wearByPart = new Map<string, number>();
  for (const worn of report.partWear) {
    wearByPart.set(
      partKey(worn.col, worn.row, worn.depth, worn.slot),
      worn.durability,
    );
  }
  const parts = bunker.parts.map((part) => {
    const worn = wearByPart.get(
      partKey(part.col, part.row, part.depth, part.slot),
    );
    return worn === undefined ? part : { ...part, durability: worn };
  });
  const survived = report.outcome === "won";
  const normalizedTier = Math.max(1, Math.floor(tier));
  return {
    ok: true,
    settlement: {
      bunker: { ...bunker, parts },
      survived,
      sealed: report.sealed,
      reward: survived
        ? {
            vibes:
              LIVE_RAID_SURVIVE_VIBES_BASE +
              normalizedTier * LIVE_RAID_SURVIVE_VIBES_PER_TIER,
            defenseXp: report.defenseXp,
          }
        : { vibes: 0, defenseXp: 0 },
    },
  };
}
