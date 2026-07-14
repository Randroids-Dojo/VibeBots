import type {
  BasePartInventory,
  BunkerRaidRewardReport,
  BunkerRaidSnapshot,
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

export interface BunkerView {
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  activeRaid: BunkerRaidSnapshot | null;
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
  raid?: BunkerRaidSnapshot;
  reward?: BunkerRaidRewardReport;
  /** Achievement ids newly unlocked by this mutation (e.g. a skin buy). */
  newStamps?: string[];
}
