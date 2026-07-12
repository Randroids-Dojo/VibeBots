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
}

export interface BunkerRouteResponse extends BunkerView {
  raid?: BunkerRaidSnapshot;
  reward?: BunkerRaidRewardReport;
  /** Achievement ids newly unlocked by this mutation (e.g. a skin buy). */
  newStamps?: string[];
}
