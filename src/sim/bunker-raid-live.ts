/**
 * Live first-person bunker raid sim (Q-024 option D).
 *
 * This is the client-run, movement-matters raid model. The player walks
 * the bunker in first person while a wave of Clankers flows toward the
 * player's live 3D cell, chewing through placed blocking parts to get in,
 * spending energy to move, chew, and cross spikes, and dying when their
 * energy runs out. If even one Clanker reaches the player's cell the miner
 * dies and the raid is lost. Survive by using the layout and dodging to
 * drain every Clanker before one touches you.
 *
 * Authority: the client steps this sim in real time against the rig's cell
 * and reports a bounded outcome; the server trusts it against a frozen
 * start snapshot (no server replay, no cross-engine determinism, per
 * Q-024). This module is nonetheless deterministic given the same
 * (snapshot, tier, per-tick player-cell sequence): spawns and tie-breaks
 * are index-ordered, so no rng is needed.
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

/** Total ticks in a raid; a timeout with the player alive is a survive. */
export const LIVE_RAID_DURATION_TICKS =
  BUNKER_RAID_DURATION_SECONDS * LIVE_RAID_TICKS_PER_SECOND;

/** Clankers act (move or chew) once per this many ticks; between action
 * ticks the client interpolates their motion. */
export const LIVE_CLANKER_MOVE_PERIOD_TICKS = 2;

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
export type LiveClankerDeath = "energy" | "reached-player" | "turret";

export interface LiveRaidCell {
  col: number;
  row: number;
  depth: number;
}

export interface LiveRaidClanker {
  id: string;
  kind: ClankerKind;
  col: number;
  row: number;
  depth: number;
  energy: number;
  alive: boolean;
  /** Turret shots absorbed so far (tanks soak more than one). */
  hits: number;
  /** Tick the Clanker died on, or -1 while alive (for death animation). */
  deathTick: number;
  death: LiveClankerDeath | null;
}

/** A turret defending the bunker: fixed cell and remaining ammo. */
export interface LiveRaidTurret {
  col: number;
  row: number;
  depth: number;
  ammo: number;
}

/** Working copy of a part whose durability the raid mutates. Spikes carry
 * their remaining uses in `durability` too. */
export interface LiveRaidPart {
  partId: BasePartId;
  col: number;
  row: number;
  depth: number;
  durability: number;
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

function clankerBiteDamage(tier: number, kind: ClankerKind): number {
  const base = CLANKER_BASE_BITE_DAMAGE + tier * CLANKER_BITE_DAMAGE_PER_TIER;
  return kind === "breacher" ? base * CLANKER_BREACHER_BITE_FACTOR : base;
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
      energy,
      alive: true,
      hits: 0,
      deathTick: -1,
      death: null,
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

function stepOneClanker(
  state: LiveRaidState,
  clanker: LiveRaidClanker,
  player: LiveRaidCell,
  field: Map<string, number>,
): void {
  // Already touching the player: contact kills the miner.
  if (
    clanker.col === player.col &&
    clanker.row === player.row &&
    clanker.depth === player.depth
  ) {
    state.minerKilled = true;
    killClanker(state, clanker, "reached-player");
    return;
  }

  // Choose the neighbor that most reduces cost-to-player.
  let best: { col: number; row: number; depth: number; key: string } | null =
    null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const [dc, dr, dd] of NEIGHBOR_OFFSETS) {
    const col = clanker.col + dc;
    const row = clanker.row + dr;
    const depth = clanker.depth + dd;
    if (!Number.isFinite(enterCost(state, col, row, depth))) continue;
    const key = cellKey(col, row, depth);
    const cost = field.get(key);
    if (cost === undefined) continue;
    if (cost < bestCost) {
      bestCost = cost;
      best = { col, row, depth, key };
    }
  }

  if (!best) {
    // Stalled (walled in by rock, or player unreachable): idle-drain so the
    // raid still terminates and a sealed fortress resolves to a survive.
    spendEnergy(state, clanker, LIVE_MOVE_ENERGY_COST);
    return;
  }

  const blocker = livePartAt(state, best.col, best.row, best.depth);
  if (blocker && BASE_PART_CATALOG[blocker.partId].blocksClankers) {
    // Chew the wall instead of moving; break it open when durability runs
    // out so the nav mid-raid opens up for the swarm.
    blocker.durability -= clankerBiteDamage(state.tier, clanker.kind);
    spendEnergy(state, clanker, LIVE_CHEW_ENERGY_COST);
    return;
  }

  // Move into the open cell.
  if (!spendEnergy(state, clanker, LIVE_MOVE_ENERGY_COST)) return;
  clanker.col = best.col;
  clanker.row = best.row;
  clanker.depth = best.depth;
  // Entering the footprint counts as a breach, even if the Clanker dies to
  // a spike on the very cell it entered: the claim was no longer sealed.
  if (containsBunkerCell(state.footprint, best.col, best.row)) {
    state.breached = true;
  }

  // Crossing a live spike drains extra energy and consumes a spike use.
  const spike = livePartAt(state, best.col, best.row, best.depth);
  if (spike && spike.partId === "floor-spikes") {
    spike.durability -= 1;
    if (!spendEnergy(state, clanker, LIVE_SPIKE_ENERGY_COST)) return;
  }

  if (
    clanker.col === player.col &&
    clanker.row === player.row &&
    clanker.depth === player.depth
  ) {
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

/**
 * Advance the raid one tick against the player's current cell. Mutates
 * `state` in place and returns it. On action ticks each alive Clanker moves
 * or chews one step down the cost-to-player gradient; between action ticks
 * only the tick counter advances (the client interpolates motion). The
 * outcome settles to "lost" the instant a Clanker reaches the player, and
 * to "won" when the last Clanker dies or the duration elapses with the
 * player alive.
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
  if (isActionTick) {
    const field = playerCostField(state, player);
    for (const clanker of state.clankers) {
      if (!clanker.alive) continue;
      stepOneClanker(state, clanker, player, field);
      if (state.minerKilled) break;
    }
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

/** Mark the XP pickup at a cell collected (the player walks over it in
 * first person). Returns the XP gained, or 0 if none/there already. Loss
 * grants nothing because the raid never reaches a collectible survive. */
export function collectLiveRaidPickup(
  state: LiveRaidState,
  cell: LiveRaidCell,
): number {
  if (state.outcome === "lost") return 0;
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
  // parts, each mapped to a distinct cell with durability only ever reduced,
  // so a client cannot fabricate a defense, claim it took no damage where it
  // did, or omit a damaged part to keep it pristine. Turrets are not
  // durability-tracked and are absent by design.
  const snapshotParts = new Map<string, number>();
  for (const part of bunker.parts) {
    const def = BASE_PART_CATALOG[part.partId];
    if (!def.blocksClankers && part.partId !== "floor-spikes") continue;
    snapshotParts.set(cellKey(part.col, part.row, part.depth), part.durability);
  }
  if (report.partWear.length !== snapshotParts.size) {
    return { ok: false, reason: "part-wear" };
  }
  const seen = new Set<string>();
  for (const worn of report.partWear) {
    const key = cellKey(worn.col, worn.row, worn.depth);
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
  const wearByCell = new Map<string, number>();
  for (const worn of report.partWear) {
    wearByCell.set(cellKey(worn.col, worn.row, worn.depth), worn.durability);
  }
  const parts = bunker.parts.map((part) => {
    const worn = wearByCell.get(cellKey(part.col, part.row, part.depth));
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
