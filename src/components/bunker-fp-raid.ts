import type { BunkerState, ClankerKind } from "@/sim/bunker";
import {
  collectLiveRaidPickup,
  createLiveRaid,
  LIVE_CLANKER_MOVE_PERIOD_TICKS,
  LIVE_RAID_TICKS_PER_SECOND,
  type LiveRaidCell,
  type LiveRaidOutcomeReport,
  type LiveRaidState,
  liveRaidOutcomeReport,
  stepLiveRaid,
} from "@/sim/bunker-raid-live";

/**
 * Client driver for a live first-person raid (Q-024 option D). The pure
 * sim (`bunker-raid-live`) owns all raid logic; this wraps it with the
 * real-time bookkeeping the first-person canvas needs: it steps the sim
 * at a fixed 6 Hz against the player's live cell, and exposes each
 * Clanker's move as a from/to pair plus a shared interpolation factor so
 * the render layer can tween the discrete sim hops into smooth motion.
 * No react/three imports, so it is unit-tested in node.
 */

export const FP_RAID_TICK_SECONDS = 1 / LIVE_RAID_TICKS_PER_SECOND;
/** Clankers only relocate on action ticks; a hop is tweened across this
 * longer window so movement reads smoothly instead of snapping. */
export const FP_RAID_ACTION_SECONDS =
  FP_RAID_TICK_SECONDS * LIVE_CLANKER_MOVE_PERIOD_TICKS;

/** A backgrounded tab can hand `useFrame` a large delta; cap how many
 * sim ticks one advance may run so a single frame never stalls stepping
 * the whole raid at once. Dropped time just makes the raid tween slower
 * in wall clock, never changes the bounded outcome. */
const MAX_CATCHUP_TICKS = 8;

/** One Clanker's render state: the sim cell it is leaving (`from`) and
 * the sim cell it is moving to (`to`), in mine-grid coordinates. Between
 * action ticks the render layer lerps from -> to by the shared factor.
 * `justDied` is true only on the advance where the Clanker was killed,
 * so the layer can fire the self-destruct burst exactly once. */
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

function syncFrom(
  view: FpRaidClankerView,
  state: LiveRaidState,
  index: number,
) {
  const clanker = state.clankers[index];
  view.fromCol = clanker.col;
  view.fromRow = clanker.row;
  view.fromDepth = clanker.depth;
}

function syncTo(view: FpRaidClankerView, state: LiveRaidState, index: number) {
  const clanker = state.clankers[index];
  view.toCol = clanker.col;
  view.toRow = clanker.row;
  view.toDepth = clanker.depth;
  view.alive = clanker.alive;
  view.deathTick = clanker.deathTick;
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
    fromCol: clanker.col,
    fromRow: clanker.row,
    fromDepth: clanker.depth,
    toCol: clanker.col,
    toRow: clanker.row,
    toDepth: clanker.depth,
    deathTick: clanker.deathTick,
    justDied: false,
  }));
  return { state, tickAccum: 0, views };
}

/**
 * Advance the raid by real time. Runs whole 6 Hz ticks out of the
 * accumulator (bounded by {@link MAX_CATCHUP_TICKS}), stepping the sim
 * against the player's current cell. On each action tick it snapshots
 * every Clanker's leaving cell into `from` before the hop and its new
 * cell into `to` after, so the render layer can tween between them.
 * Returns how many sim ticks ran (0 on a between-tick frame).
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
    const willAct =
      (runtime.state.tick + 1) % LIVE_CLANKER_MOVE_PERIOD_TICKS === 0;
    if (willAct) {
      for (let index = 0; index < runtime.views.length; index += 1) {
        syncFrom(runtime.views[index], runtime.state, index);
      }
    }
    stepLiveRaid(runtime.state, player);
    if (willAct) {
      for (let index = 0; index < runtime.views.length; index += 1) {
        const view = runtime.views[index];
        const wasAlive = view.alive;
        syncTo(view, runtime.state, index);
        if (wasAlive && !view.alive) view.justDied = true;
      }
    }
    ticks += 1;
  }
  // If we hit the catch-up cap there is stale time we deliberately drop,
  // so the next frame starts clean instead of chasing a growing debt.
  if (ticks >= MAX_CATCHUP_TICKS) runtime.tickAccum = 0;
  return ticks;
}

/**
 * The shared [0, 1] tween factor for the current action window, derived
 * purely from the sim tick phase plus the sub-tick accumulator, so a
 * Clanker sits on `from` right after it hops and reaches `to` just as the
 * next hop fires. Dead Clankers ignore this (they hold their death cell).
 */
export function fpRaidInterpFactor(runtime: FpRaidRuntime): number {
  const phase = runtime.state.tick % LIVE_CLANKER_MOVE_PERIOD_TICKS;
  const elapsed = phase * FP_RAID_TICK_SECONDS + runtime.tickAccum;
  const factor = elapsed / FP_RAID_ACTION_SECONDS;
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
 * Milliseconds until the next raid may start, clamped at zero. Null
 * deadline (no prior raid, or the server predates the cooldown field)
 * means a raid can start now.
 */
export function raidCooldownMsLeft(
  nextAvailableAtMs: number | null | undefined,
  nowMs: number,
): number {
  if (typeof nextAvailableAtMs !== "number") return 0;
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
