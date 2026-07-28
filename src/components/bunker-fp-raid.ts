import type { BunkerState, ClankerKind } from "@/sim/bunker";
import {
  collectLiveRaidPickup,
  createLiveRaid,
  LIVE_CLANKER_MOVE_PERIOD_TICKS,
  LIVE_RAID_TICKS_PER_SECOND,
  type LiveRaidCell,
  type LiveRaidClanker,
  type LiveRaidOutcomeReport,
  type LiveRaidState,
  liveRaidOutcomeReport,
  pickaxeStrikeDamage,
  stepLiveRaid,
  strikeLiveRaid,
} from "@/sim/bunker-raid-live";

/**
 * Client driver for a live first-person raid (Q-024 option D). The pure
 * sim (`bunker-raid-live`) owns all raid logic; this wraps it with the
 * real-time bookkeeping the first-person canvas needs: it steps the sim
 * at a fixed 6 Hz against the player's live position, and exposes each
 * Clanker body's previous and current sim position plus a shared
 * interpolation factor, so the render layer can tween the 6 Hz motion up
 * to frame rate. No react/three imports, so it is unit-tested in node.
 */

export const FP_RAID_TICK_SECONDS = 1 / LIVE_RAID_TICKS_PER_SECOND;
/** The window Clanker route decisions land on. Bodies now move every
 * tick, so this only paces waypoint refreshes and wall chewing. */
export const FP_RAID_ACTION_SECONDS =
  FP_RAID_TICK_SECONDS * LIVE_CLANKER_MOVE_PERIOD_TICKS;

/** A backgrounded tab can hand `useFrame` a large delta; cap how many
 * sim ticks one advance may run so a single frame never stalls stepping
 * the whole raid at once. Dropped time just makes the raid tween slower
 * in wall clock, never changes the bounded outcome. */
const MAX_CATCHUP_TICKS = 8;

/** One Clanker's render state: where its body stood at the previous sim
 * tick (`from`) and where it stands now (`to`), in continuous mine-grid
 * coordinates. The render layer lerps from -> to by the shared factor to
 * carry 6 Hz sim motion up to frame rate. `justDied` is true only on the
 * advance where the Clanker was killed, so the layer can fire the
 * self-destruct burst exactly once; `biteTick` and `hurtTick` mirror the
 * sim so it can fire a lunge on each bite and a flinch on each pickaxe
 * hit the same way. */
export interface FpRaidClankerView {
  id: string;
  kind: ClankerKind;
  alive: boolean;
  fromCol: number;
  fromRow: number;
  fromDepth: number;
  toCol: number;
  toRow: number;
  toDepth: number;
  deathTick: number;
  justDied: boolean;
  /** Sim tick this Clanker last bit the miner, or -1. */
  biteTick: number;
  /** Sim tick a pickaxe strike last landed on it, or -1. */
  hurtTick: number;
}

export interface FpRaidRuntime {
  state: LiveRaidState;
  /** Seconds accumulated toward the next 6 Hz tick. */
  tickAccum: number;
  /** Per-Clanker interpolation endpoints, index-aligned to
   * `state.clankers` and allocated once, so `advanceFpRaid` never
   * allocates on the frame path. */
  views: FpRaidClankerView[];
}

/** Carry the current sim position into `from` before a tick, so the tick
 * that follows leaves a one-tick segment for the render layer to lerp. */
function syncFrom(view: FpRaidClankerView) {
  view.fromCol = view.toCol;
  view.fromRow = view.toRow;
  view.fromDepth = view.toDepth;
}

function syncTo(view: FpRaidClankerView, clanker: LiveRaidClanker) {
  view.toCol = clanker.x;
  view.toRow = clanker.y;
  view.toDepth = clanker.z;
  view.alive = clanker.alive;
  view.deathTick = clanker.deathTick;
  view.biteTick = clanker.biteTick;
  view.hurtTick = clanker.hurtTick;
}

export function createFpRaidRuntime(
  bunker: BunkerState,
  tier: number,
  raidId?: string,
): FpRaidRuntime {
  const state = createLiveRaid(bunker, tier, raidId);
  const views: FpRaidClankerView[] = state.clankers.map((clanker) => ({
    id: clanker.id,
    kind: clanker.kind,
    alive: clanker.alive,
    fromCol: clanker.x,
    fromRow: clanker.y,
    fromDepth: clanker.z,
    toCol: clanker.x,
    toRow: clanker.y,
    toDepth: clanker.z,
    deathTick: clanker.deathTick,
    justDied: false,
    biteTick: clanker.biteTick,
    hurtTick: clanker.hurtTick,
  }));
  return { state, tickAccum: 0, views };
}

/**
 * Advance the raid by real time. Runs whole 6 Hz ticks out of the
 * accumulator (bounded by {@link MAX_CATCHUP_TICKS}), stepping the sim
 * against the player's live position. Each tick carries the last
 * position into `from` and the freshly stepped one into `to`, so the
 * render layer always has a one-tick segment to tween. Returns how many
 * sim ticks ran (0 on a between-tick frame).
 */
export function advanceFpRaid(
  runtime: FpRaidRuntime,
  player: LiveRaidCell,
  deltaSeconds: number,
): number {
  for (let index = 0; index < runtime.views.length; index += 1) {
    runtime.views[index].justDied = false;
  }
  if (runtime.state.outcome !== "active") return 0;
  runtime.tickAccum += deltaSeconds;
  let ticks = 0;
  while (
    runtime.tickAccum >= FP_RAID_TICK_SECONDS &&
    runtime.state.outcome === "active" &&
    ticks < MAX_CATCHUP_TICKS
  ) {
    runtime.tickAccum -= FP_RAID_TICK_SECONDS;
    for (let index = 0; index < runtime.views.length; index += 1) {
      syncFrom(runtime.views[index]);
    }
    stepLiveRaid(runtime.state, player);
    for (let index = 0; index < runtime.views.length; index += 1) {
      const view = runtime.views[index];
      const wasAlive = view.alive;
      syncTo(view, runtime.state.clankers[index]);
      if (wasAlive && !view.alive) view.justDied = true;
    }
    ticks += 1;
  }
  // If we hit the catch-up cap there is stale time we deliberately drop,
  // so the next frame starts clean instead of chasing a growing debt.
  if (ticks >= MAX_CATCHUP_TICKS) runtime.tickAccum = 0;
  return ticks;
}

/**
 * Land one pickaxe swing against the wave, scaled by the miner's mine
 * gear pickaxe level. `from` is the miner's live position and `dir` its
 * aim direction, both in mine-grid coordinates. Returns the Clanker hit,
 * or null when the swing was on cooldown or connected with nothing, so
 * the caller can spark a hit effect only on a real connection.
 */
export function strikeFpRaid(
  runtime: FpRaidRuntime,
  from: LiveRaidCell,
  dir: LiveRaidCell,
  pickaxeLevel: number,
): LiveRaidClanker | null {
  return strikeLiveRaid(
    runtime.state,
    from,
    dir,
    pickaxeStrikeDamage(pickaxeLevel),
  );
}

/**
 * The shared [0, 1] tween factor across the current sim tick, derived
 * purely from the sub-tick accumulator, so a Clanker sits on `from` right
 * after a tick and reaches `to` just as the next one fires. Dead Clankers
 * ignore this (they hold their death position).
 */
export function fpRaidInterpFactor(runtime: FpRaidRuntime): number {
  const factor = runtime.tickAccum / FP_RAID_TICK_SECONDS;
  if (factor <= 0) return 0;
  if (factor >= 1) return 1;
  return factor;
}

/** Collect an XP pickup the player walked onto, marking it collected in
 * the sim so the settled report credits its defense XP. Returns the XP
 * granted (0 when the cell holds no uncollected pickup). */
export function collectFpRaidPickup(
  runtime: FpRaidRuntime,
  cell: LiveRaidCell,
): number {
  return collectLiveRaidPickup(runtime.state, cell);
}

export function fpRaidEnded(runtime: FpRaidRuntime): boolean {
  return runtime.state.outcome !== "active";
}

/** The bounded outcome report to submit to the resolve route. */
export function fpRaidReport(runtime: FpRaidRuntime): LiveRaidOutcomeReport {
  return liveRaidOutcomeReport(runtime.state);
}

/**
 * Milliseconds until the next raid may start, clamped at zero. A null
 * deadline (no prior raid) means a raid can start now.
 */
export function raidCooldownMsLeft(
  nextAvailableAtMs: number | null,
  nowMs: number,
): number {
  if (nextAvailableAtMs === null) return 0;
  return Math.max(0, nextAvailableAtMs - nowMs);
}

/**
 * Compact label for the raid-cooldown chip: the two largest nonzero
 * units, seconds-only under a minute. Seconds are rounded up so the chip
 * never reads a zero while time actually remains.
 */
export function formatRaidCooldown(msLeft: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msLeft / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
