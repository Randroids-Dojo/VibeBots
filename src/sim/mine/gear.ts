/**
 * Persistent gear tracks (REQ-013/REQ-014): part of the sim input, so a
 * trip replays identically from (seed, gear, moves). Level arrays are
 * indexed by level - 1; prices[i] upgrades from level i+1 to i+2.
 */
export interface MineGear {
  pickaxe: number;
  battery: number;
  /** Legacy saved snapshots used lamp for the robot battery track. */
  lamp?: number;
  cargo: number;
  lantern: number;
  /** Elevator rail depth in rows (REQ-028); 0 = no rail bought yet. */
  elevator: number;
  /**
   * Player-chosen elevator shaft column. Old snapshots omit this field,
   * so elevatorColumn falls back to the original shaft when rail exists.
   */
  elevatorColumn?: number | null;
  /** Warpcoil level (REQ-029): indexes WARP_RANGE. */
  warpcoil: number;
  /**
   * Highest unlocked dynamite tier. Absent or 1 is the base plus charge.
   * Higher tiers are one-time unlocks, not a radius upgrade ladder.
   */
  blast?: number;
  /**
   * Elevator car speed: rows travelled per ride (see elevatorSpeedRows).
   * Optional/back-compat like blast (absent reads as level 1, two rows).
   */
  elevatorSpeed?: number;
  /**
   * Fall harness level: how many unsupported cells the miner can free
   * fall before the landing kills the trip. Optional for old snapshots.
   */
  fall?: number;
  /**
   * Recall rope range level: how deep a paid rope can pull the miner
   * back from. Optional for old snapshots.
   */
  recall?: number;
}

export type MineGearSnapshot = Omit<MineGear, "battery"> & {
  battery?: number;
};

export const DEFAULT_GEAR: MineGear = {
  pickaxe: 1,
  battery: 1,
  cargo: 1,
  lantern: 1,
  elevator: 0,
  elevatorColumn: null,
  warpcoil: 1,
  blast: 1,
  elevatorSpeed: 1,
  fall: 1,
  recall: 1,
};

/** Original shaft column used by saved profiles that predate placement. */
export const LEGACY_ELEVATOR_COL = -5;

/** Target row for the current authored long-form mine economy. */
export const MINE_BALANCE_MAX_ROW = 1000;

/**
 * Resolve the placed shaft column while preserving old saved profiles.
 * New profiles have no shaft until their first rail purchase chooses one.
 */
export function elevatorColumn(
  gear: Pick<MineGear, "elevator" | "elevatorColumn">,
): number | null {
  if (gear.elevatorColumn != null) return Math.trunc(gear.elevatorColumn);
  return gear.elevator > 0 ? LEGACY_ELEVATOR_COL : null;
}

/**
 * Price of the next single rail row based on current installed depth.
 * Rail starts at more than twelve ladder purchases and steps up every
 * ten rows so the elevator remains a premium transport investment.
 */
export function elevatorRailPrice(currentDepth: number): number {
  const depth = Math.max(0, Math.floor(currentDepth));
  return 25 + Math.floor(depth / 10) * 5;
}

/** Max robot battery charge by battery-cell level. */
export const BATTERY_CHARGE = [
  60, 90, 130, 180, 240, 315, 405, 520, 660, 820,
] as const;
/** Visible rows below the miner by lantern level. */
export const LANTERN_RADIUS = [3, 5, 7, 9, 11, 13, 15, 17] as const;
/** Ore stack slots the hold carries by cargo level (parts ride free). */
export const CARGO_CAPACITY = [4, 6, 8, 11, 15, 20, 27, 35, 43, 50] as const;
/** Cells the miner can fall and survive by fall-harness level. */
export const SAFE_FALL_ROWS = [4, 6, 9, 13, 18, 24, 31, 39] as const;

export type MineGearTrack =
  | "pickaxe"
  | "battery"
  | "cargo"
  | "lantern"
  | "warpcoil"
  | "blast"
  | "elevatorSpeed"
  | "fall"
  | "recall";

export interface GearTrackDef {
  track: MineGearTrack;
  name: string;
  /** prices[i] is the cost to go from level i+1 to level i+2. */
  prices: readonly number[];
  /** minimum player level to buy prices[i]. */
  levelRequirements: readonly number[];
  /** deepest row reached to buy prices[i]. */
  depthRequirements: readonly number[];
  /** One-line shop copy for what the next level does. */
  blurb: string;
}

export interface GearUpgradeRequirements {
  playerLevel: number;
  maxDepth: number;
}

export const GEAR_TRACKS: readonly GearTrackDef[] = [
  {
    track: "pickaxe",
    name: "Pickaxe",
    prices: [45, 140, 420, 1200, 3200, 8200, 19000, 42000, 90000],
    levelRequirements: [1, 5, 12, 25, 40, 55, 70, 85, 100],
    depthRequirements: [0, 18, 45, 90, 150, 260, 420, 620, 820],
    blurb: "breaks tougher rock and ore faster",
  },
  {
    track: "battery",
    name: "Battery Cell",
    prices: [35, 110, 340, 950, 2400, 5600, 12500, 28000, 62000],
    levelRequirements: [1, 4, 10, 20, 35, 50, 65, 80, 92],
    depthRequirements: [0, 16, 45, 90, 150, 240, 380, 560, 760],
    blurb: "longer trips before shutdown",
  },
  {
    track: "cargo",
    name: "Cargo Hold",
    prices: [80, 220, 600, 1650, 4600, 12500, 34000, 78000, 170000],
    levelRequirements: [1, 5, 12, 24, 40, 56, 72, 88, 100],
    depthRequirements: [0, 20, 55, 110, 190, 300, 450, 650, 850],
    blurb: "adds ore stack slots",
  },
  {
    track: "lantern",
    name: "Lantern",
    prices: [55, 180, 520, 1400, 3600, 9000, 22000],
    levelRequirements: [1, 6, 14, 28, 44, 62, 80],
    depthRequirements: [0, 20, 55, 115, 210, 360, 600],
    blurb: "lights more rows and zooms farther out",
  },
  {
    track: "warpcoil",
    name: "Warpcoil",
    prices: [180, 700, 2600, 9000, 26000, 70000],
    levelRequirements: [8, 22, 40, 60, 80, 100],
    depthRequirements: [50, 130, 260, 450, 650, 850],
    blurb: "reaches deeper planted beacons",
  },
  {
    track: "blast",
    name: "Blast Charge",
    prices: [250, 800, 2500],
    levelRequirements: [12, 35, 70],
    depthRequirements: [60, 180, 420],
    blurb: "unlocks larger dynamite blasts",
  },
  {
    track: "elevatorSpeed",
    name: "Elevator Speed",
    prices: [100, 260, 680, 1750, 4500, 11000, 26000, 62000],
    levelRequirements: [1, 8, 18, 32, 48, 62, 76, 90],
    depthRequirements: [0, 30, 80, 150, 260, 400, 560, 760],
    blurb: "moves more rail rows per step",
  },
  {
    track: "fall",
    name: "Fall Harness",
    prices: [80, 220, 620, 1700, 4300, 10500, 25000],
    levelRequirements: [1, 8, 18, 32, 48, 64, 80],
    depthRequirements: [0, 30, 75, 140, 230, 360, 540],
    blurb: "survive deeper drops",
  },
  {
    track: "recall",
    name: "Recall Rope",
    prices: [75, 240, 850, 3200, 12000],
    levelRequirements: [1, 10, 26, 48, 74],
    depthRequirements: [0, 25, 70, 160, 360],
    blurb: "recall from deeper rows",
  },
];

/** Beacon warp reach in rows by warpcoil level (REQ-029). */
export const WARP_RANGE = [60, 150, 400, 650, 800, 925, 999] as const;

export function warpRange(gear: MineGear): number {
  return WARP_RANGE[Math.min(gear.warpcoil, WARP_RANGE.length) - 1];
}

/** Max row a recall rope can pull from by Recall Rope level. */
export const RECALL_ROPE_RANGE = [12, 30, 75, 180, 420, 1000] as const;

export function recallRopeRange(gear: MineGear): number {
  return RECALL_ROPE_RANGE[
    Math.min(gear.recall ?? 1, RECALL_ROPE_RANGE.length) - 1
  ];
}

export function gearTrackDef(track: MineGearTrack): GearTrackDef {
  const def = GEAR_TRACKS.find((t) => t.track === track);
  if (!def) throw new Error(`unknown gear track: ${track}`);
  return def;
}

export function maxGearLevel(track: MineGearTrack): number {
  return gearTrackDef(track).prices.length + 1;
}

export function gearUpgradeRequirements(
  track: MineGearTrack,
  currentLevel: number,
): GearUpgradeRequirements {
  const def = gearTrackDef(track);
  const index = Math.max(0, currentLevel - 1);
  return {
    playerLevel: def.levelRequirements[index] ?? 1,
    maxDepth: def.depthRequirements[index] ?? 0,
  };
}

function batteryLevel(gear: MineGearSnapshot): number {
  return gear.battery ?? gear.lamp ?? 1;
}

export type DynamiteTier = 1 | 2 | 3 | 4;

export const DYNAMITE_TIERS = [1, 2, 3, 4] as const;

export function dynamiteTier(gear: Pick<MineGear, "blast">): DynamiteTier {
  const level = Math.floor(gear.blast ?? 1);
  if (level <= 1) return 1;
  if (level >= 4) return 4;
  return level as DynamiteTier;
}

/** Fill the current battery field for legacy gear snapshots. */
export function normalizeGear(gear: MineGearSnapshot): MineGear {
  return {
    ...gear,
    battery: batteryLevel(gear),
    blast: dynamiteTier(gear),
    elevatorColumn: elevatorColumn(gear),
    elevatorSpeed: gear.elevatorSpeed ?? 1,
    fall: gear.fall ?? 1,
    recall: gear.recall ?? 1,
  };
}

/** Max robot battery charge for the session's gear. */
export function maxEnergy(gear: MineGear): number {
  return BATTERY_CHARGE[
    Math.min(batteryLevel(gear), BATTERY_CHARGE.length) - 1
  ];
}

/** Lantern reach for the session's gear. */
export function lightRadius(gear: MineGear): number {
  return LANTERN_RADIUS[Math.min(gear.lantern, LANTERN_RADIUS.length) - 1];
}

/** Ore stack slots the hold takes for the session's gear. */
export function cargoCapacity(gear: MineGear): number {
  return CARGO_CAPACITY[Math.min(gear.cargo, CARGO_CAPACITY.length) - 1];
}

/** Unsupported fall distance the miner can survive before the landing kills. */
export function safeFallRows(gear: MineGear): number {
  return SAFE_FALL_ROWS[Math.min(gear.fall ?? 1, SAFE_FALL_ROWS.length) - 1];
}

/** Back-compat helper for older callers that only need the unlocked tier. */
export function blastRadius(gear: MineGear): number {
  return dynamiteTier(gear);
}

export function dynamiteOreHarvestUnits(tier: DynamiteTier): number {
  return 8 * tier;
}
