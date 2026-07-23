import type {
  BasePartInventory,
  BunkerRaidRewardReport,
  BunkerState,
} from "@/sim/bunker";

export interface BunkerPlayerProgress {
  balance: number;
  trackXp: number;
  defenseXp: number;
  overallLevel: number;
  levelCap: number;
  progressXp: number;
  neededXp: number;
  nextLevelXp: number | null;
  beaconLimit: number;
}

/**
 * A live first-person raid in flight (Q-024 option D). The client runs the
 * raid in real time against this frozen bunker snapshot and reports a bounded
 * outcome, which the server settles against the same snapshot.
 */
export interface LiveRaidActiveView {
  raidId: string;
  tier: number;
  /** Server clock at start; the client bounds the raid to duration + grace. */
  startedAtMs: number;
  durationSeconds: number;
  graceSeconds: number;
  /** The frozen defenses the client runs the raid against. */
  bunker: BunkerState;
}

export interface BunkerView {
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  /**
   * A live raid in flight, or null when none is active or the active row has
   * run past its authored duration plus server grace (an expired raid never
   * blocks later bunker operations, F-105). Optional for wire-compat with
   * clients built before live raids landed.
   */
  activeLiveRaid?: LiveRaidActiveView | null;
  /**
   * Server clock (ms) when the raid cooldown ends and the next raid may
   * start, or null when one may start now. The cooldown runs from the last
   * raid's start (including one still in flight), mirroring the start
   * route's own gate, so the HUD can show a countdown instead of a Start
   * button that silently 409s. Optional for wire-compat with clients built
   * before the cooldown was exposed.
   */
  nextRaidAvailableAtMs?: number | null;
  player: BunkerPlayerProgress;
  /**
   * Optimistic-concurrency counter for banked bunker edits (F-122). Every
   * successful mutation returns the bumped value; the client echoes it as
   * `expectedRevision` on the next edit so a stale or reordered write is
   * rejected with HTTP 409 instead of clobbering newer state. Zero when
   * there is no banked bunker yet.
   */
  revision: number;
}

export interface BunkerRouteResponse extends BunkerView {
  /** The frozen snapshot returned when a live raid is started. */
  liveRaid?: LiveRaidActiveView | null;
  reward?: BunkerRaidRewardReport;
  /** Achievement ids newly unlocked by this mutation (e.g. a skin buy). */
  newStamps?: string[];
}
