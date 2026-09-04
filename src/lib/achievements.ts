export type AchievementCategory =
  | "depth"
  | "haul"
  | "tools"
  | "survival"
  | "battle";

export interface AchievementDefinition {
  id: string;
  category: AchievementCategory;
  title: string;
  description: string;
  stamp: string;
  metric: AchievementMetric;
  target: number;
}

export type AchievementMetric =
  | "deepestDepth"
  | "activeBiomePortals"
  | "sales"
  | "maxTripVibes"
  | "partsBanked"
  | "bagDrops"
  | "roofRescues"
  | "collapsesSurvived"
  | "depotPurchases"
  | "pickaxeLevel"
  | "batteryLevel"
  | "cargoLevel"
  | "lanternLevel"
  | "blastLevel"
  | "warpcoilLevel"
  | "elevatorDepth"
  | "elevatorSpeedLevel"
  | "laddersPlaced"
  | "planksPlaced"
  | "recallsWithLoot"
  | "recoveries"
  | "beaconsPlanted"
  | "elevatorRides"
  | "bunkerRaidsSurvived"
  | "raidsSurvivedSealed"
  | "bunkerSkinsBought"
  | "bunkerCellsDug"
  | "matchWins"
  | "chassisFought"
  | "sawMatchWins"
  | "designsPainted"
  | "ruleMatches";

export interface AchievementStats {
  sales: number;
  maxTripVibes: number;
  partsBanked: number;
  bagDrops: number;
  /** Condemned span roofs re-propped with a plank before they fell. */
  roofRescues: number;
  /** Span collapses that landed nearby while the miner walked away. */
  collapsesSurvived: number;
  depotPurchases: number;
  laddersPlaced: number;
  planksPlaced: number;
  recallsWithLoot: number;
  recoveries: number;
  beaconsPlanted: number;
  elevatorRides: number;
  bunkerRaidsSurvived: number;
  /** Raids survived with the player cell fully sealed (0.1.214+). */
  raidsSurvivedSealed: number;
  /** Paid bunker skins purchased (durable: bunkers.skins_owned). */
  bunkerSkinsBought: number;
  /** Bunker claim-rock cells excavated (durable: bunkers.dug). */
  bunkerCellsDug: number;
  /** Server-verified arena match wins (durable: match_records). */
  matchWins: number;
  /** Distinct core chassis fielded across official matches (0-3). */
  chassisFought: number;
  /** Verified wins by a design carrying a saw blade. */
  sawMatchWins: number;
  /** 1 once any saved design carries a paint job (G5). */
  designsPainted: number;
  /**
   * Verified matches fought with at least one bench rule on the player's
   * design (F-252). Durable: match_records.rule_count, never the bench.
   */
  ruleMatches: number;
}

export interface AchievementSnapshot {
  deepestDepth: number;
  activeBiomePortals: number;
  pickaxeLevel: number;
  batteryLevel: number;
  cargoLevel: number;
  lanternLevel: number;
  blastLevel: number;
  warpcoilLevel: number;
  elevatorDepth: number;
  elevatorSpeedLevel: number;
  stats: AchievementStats;
}

export interface AchievementProgress {
  current: number;
  target: number;
  label: string;
}

export interface PlayerAchievementView extends AchievementDefinition {
  unlocked: boolean;
  unlockedAt: string | null;
  progress: AchievementProgress;
}

export const DEFAULT_ACHIEVEMENT_STATS: AchievementStats = {
  sales: 0,
  maxTripVibes: 0,
  partsBanked: 0,
  bagDrops: 0,
  roofRescues: 0,
  collapsesSurvived: 0,
  depotPurchases: 0,
  laddersPlaced: 0,
  planksPlaced: 0,
  recallsWithLoot: 0,
  recoveries: 0,
  beaconsPlanted: 0,
  elevatorRides: 0,
  bunkerRaidsSurvived: 0,
  raidsSurvivedSealed: 0,
  bunkerSkinsBought: 0,
  bunkerCellsDug: 0,
  matchWins: 0,
  chassisFought: 0,
  sawMatchWins: 0,
  designsPainted: 0,
  ruleMatches: 0,
};

export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  {
    id: "depth-first-chip",
    category: "depth",
    title: "First Chip",
    description: "Reach depth 1.",
    stamp: "D1",
    metric: "deepestDepth",
    target: 1,
  },
  {
    id: "depth-clay-boots",
    category: "depth",
    title: "Clay Boots",
    description: "Reach Clay Beds at depth 12.",
    stamp: "D12",
    metric: "deepestDepth",
    target: 12,
  },
  {
    id: "depth-granite-nerves",
    category: "depth",
    title: "Granite Nerves",
    description: "Reach Old Granite at depth 24.",
    stamp: "D24",
    metric: "deepestDepth",
    target: 24,
  },
  {
    id: "depth-glow-guide",
    category: "depth",
    title: "Glow Guide",
    description: "Reach Glow Caverns at depth 36.",
    stamp: "D36",
    metric: "deepestDepth",
    target: 36,
  },
  {
    id: "depth-magma-hello",
    category: "depth",
    title: "Magma Hello",
    description: "Reach Magma Verge at depth 48.",
    stamp: "D48",
    metric: "deepestDepth",
    target: 48,
  },
  {
    id: "depth-ashfall-claim",
    category: "depth",
    title: "Ashfall Claim",
    description: "Reach Ashfall Galleries at depth 64.",
    stamp: "D64",
    metric: "deepestDepth",
    target: 64,
  },
  {
    id: "depth-black-seam",
    category: "depth",
    title: "Black Seam",
    description: "Reach The Black Seam at depth 84.",
    stamp: "D84",
    metric: "deepestDepth",
    target: 84,
  },
  {
    id: "depth-echo-vault",
    category: "depth",
    title: "Echo Vault Visitor",
    description: "Reach Echo Vaults at depth 110.",
    stamp: "D110",
    metric: "deepestDepth",
    target: 110,
  },
  {
    id: "depth-core-approach",
    category: "depth",
    title: "Core Approach",
    description: "Reach Core Approach at depth 140.",
    stamp: "D140",
    metric: "deepestDepth",
    target: 140,
  },
  {
    id: "depth-biome-scout",
    category: "depth",
    title: "Biome Scout",
    description: "Activate one distant biome portal.",
    stamp: "B1",
    metric: "activeBiomePortals",
    target: 1,
  },
  {
    id: "depth-portal-network",
    category: "depth",
    title: "Portal Network",
    description: "Activate both biome portals.",
    stamp: "B2",
    metric: "activeBiomePortals",
    target: 2,
  },
  {
    id: "haul-first-sale",
    category: "haul",
    title: "First Sale",
    description: "Sell any banked loot.",
    stamp: "H1",
    metric: "sales",
    target: 1,
  },
  {
    id: "haul-clean-pocket",
    category: "haul",
    title: "Clean Pocket",
    description: "Sell 25 vibes in one trip.",
    stamp: "H25",
    metric: "maxTripVibes",
    target: 25,
  },
  {
    id: "haul-heavy-hold",
    category: "haul",
    title: "Heavy Hold",
    description: "Sell 100 vibes in one trip.",
    stamp: "H100",
    metric: "maxTripVibes",
    target: 100,
  },
  {
    id: "haul-big-haul",
    category: "haul",
    title: "Big Haul",
    description: "Sell 500 vibes in one trip.",
    stamp: "H500",
    metric: "maxTripVibes",
    target: 500,
  },
  {
    id: "haul-cache-cracked",
    category: "haul",
    title: "Cache Cracked",
    description: "Bank one mine part.",
    stamp: "P1",
    metric: "partsBanked",
    target: 1,
  },
  {
    id: "haul-parts-prospector",
    category: "haul",
    title: "Parts Prospector",
    description: "Bank 5 mine parts total.",
    stamp: "P5",
    metric: "partsBanked",
    target: 5,
  },
  {
    id: "haul-bag-sorter",
    category: "haul",
    title: "Bag Sorter",
    description: "Drop selected ore from the bag once.",
    stamp: "BG",
    metric: "bagDrops",
    target: 1,
  },
  {
    id: "haul-pack-light",
    category: "haul",
    title: "Pack Light",
    description: "Drop selected ore from the bag 5 times.",
    stamp: "B5",
    metric: "bagDrops",
    target: 5,
  },
  {
    id: "tool-depot-regular",
    category: "tools",
    title: "Depot Regular",
    description: "Buy any consumable.",
    stamp: "T1",
    metric: "depotPurchases",
    target: 1,
  },
  {
    id: "tool-better-pick",
    category: "tools",
    title: "Better Pick",
    description: "Own Pickaxe level 2.",
    stamp: "PK2",
    metric: "pickaxeLevel",
    target: 2,
  },
  {
    id: "tool-battery-upgrade",
    category: "tools",
    title: "Battery Upgrade",
    description: "Own Battery Cell level 2.",
    stamp: "BC2",
    metric: "batteryLevel",
    target: 2,
  },
  {
    id: "tool-roomy-hold",
    category: "tools",
    title: "Roomy Hold",
    description: "Own Cargo Hold level 2.",
    stamp: "CG2",
    metric: "cargoLevel",
    target: 2,
  },
  {
    id: "tool-long-beam",
    category: "tools",
    title: "Long Beam",
    description: "Own Lantern level 2.",
    stamp: "LN2",
    metric: "lanternLevel",
    target: 2,
  },
  {
    id: "tool-blast-ring",
    category: "tools",
    title: "Blast Ring",
    description: "Own Blast Charge level 2.",
    stamp: "BL2",
    metric: "blastLevel",
    target: 2,
  },
  {
    id: "tool-warp-ready",
    category: "tools",
    title: "Warp Ready",
    description: "Own Warpcoil level 2.",
    stamp: "WP2",
    metric: "warpcoilLevel",
    target: 2,
  },
  {
    id: "tool-winch-builder",
    category: "tools",
    title: "Winch Builder",
    description: "Buy the first elevator rail.",
    stamp: "EL1",
    metric: "elevatorDepth",
    target: 1,
  },
  {
    id: "tool-fast-car",
    category: "tools",
    title: "Fast Car",
    description: "Own Elevator Speed level 2.",
    stamp: "ES2",
    metric: "elevatorSpeedLevel",
    target: 2,
  },
  {
    id: "survival-ladder-home",
    category: "survival",
    title: "Ladder Home",
    description: "Place 10 ladders lifetime.",
    stamp: "L10",
    metric: "laddersPlaced",
    target: 10,
  },
  {
    id: "survival-bridge-builder",
    category: "survival",
    title: "Bridge Builder",
    description: "Place 5 planks lifetime.",
    stamp: "BR5",
    metric: "planksPlaced",
    target: 5,
  },
  {
    id: "survival-rope-save",
    category: "survival",
    title: "Rope Save",
    description: "Recall home with loot.",
    stamp: "RP",
    metric: "recallsWithLoot",
    target: 1,
  },
  {
    id: "survival-close-call",
    category: "survival",
    title: "Close Call",
    description: "Recover from a cave-in or crush.",
    stamp: "CC",
    metric: "recoveries",
    target: 1,
  },
  {
    id: "survival-beacon-planted",
    category: "survival",
    title: "Beacon Planted",
    description: "Plant a beacon.",
    stamp: "BP",
    metric: "beaconsPlanted",
    target: 1,
  },
  {
    id: "survival-ride-rail",
    category: "survival",
    title: "Ride the Rail",
    description: "Take an elevator ride.",
    stamp: "RR",
    metric: "elevatorRides",
    target: 1,
  },
  {
    id: "survival-first-defense",
    category: "survival",
    title: "First Defense",
    description: "Survive a Clanker attack on your bunker.",
    stamp: "BD",
    metric: "bunkerRaidsSurvived",
    target: 1,
  },
  {
    id: "survival-roof-rescue",
    category: "survival",
    title: "Hold the Ceiling",
    description: "Re-prop a condemned roof with a plank before it falls.",
    stamp: "HC",
    metric: "roofRescues",
    target: 1,
  },
  {
    id: "survival-walked-away",
    category: "survival",
    title: "Walked Away",
    description: "Walk away from a roof collapse that crashed down beside you.",
    stamp: "WA",
    metric: "collapsesSurvived",
    target: 1,
  },
  {
    id: "survival-buttoned-up",
    category: "survival",
    title: "Buttoned Up",
    description: "Survive a raid with the player cell fully sealed.",
    stamp: "BU",
    metric: "raidsSurvivedSealed",
    target: 1,
  },
  {
    id: "tools-fresh-coat",
    category: "tools",
    title: "Fresh Coat",
    description: "Buy a cosmetic skin for your bunker.",
    stamp: "FC",
    metric: "bunkerSkinsBought",
    target: 1,
  },
  {
    id: "bunker-groundbreaker",
    category: "survival",
    title: "Groundbreaker",
    description: "Dig your first cell into the bunker's claim rock.",
    stamp: "GB",
    metric: "bunkerCellsDug",
    target: 1,
  },
  {
    id: "battle-chassis-tour",
    category: "battle",
    title: "Chassis Tour",
    description: "Fight an official match with every core chassis.",
    stamp: "CT",
    metric: "chassisFought",
    target: 3,
  },
  {
    id: "tools-custom-job",
    category: "tools",
    title: "Custom Job",
    description: "Save a bot wearing your own paint.",
    stamp: "CJ",
    metric: "designsPainted",
    target: 1,
  },
  {
    id: "battle-first-blood",
    category: "battle",
    title: "First Blood",
    description: "Win a server-verified arena match.",
    stamp: "W1",
    metric: "matchWins",
    target: 1,
  },
  {
    id: "battle-veteran",
    category: "battle",
    title: "Pit Veteran",
    description: "Win ten server-verified arena matches.",
    stamp: "W10",
    metric: "matchWins",
    target: 10,
  },
  {
    id: "battle-buzzkill",
    category: "battle",
    title: "Buzzkill",
    description: "Win a verified match with a saw blade mounted.",
    stamp: "SAW",
    metric: "sawMatchWins",
    target: 1,
  },
  {
    id: "battle-first-orders",
    category: "battle",
    title: "First Orders",
    description: "Fight a verified match with a bench rule on your bot.",
    stamp: "RUL",
    metric: "ruleMatches",
    target: 1,
  },
];

/** The catalog keyed by achievement id (art, alerts, and validation). */
export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, AchievementDefinition> =
  new Map(
    ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition]),
  );

export function normalizeAchievementStats(
  value: Partial<AchievementStats> | null | undefined,
): AchievementStats {
  return { ...DEFAULT_ACHIEVEMENT_STATS, ...(value ?? {}) };
}

export function mergeAchievementStats(
  current: AchievementStats,
  patch: Partial<AchievementStats>,
): AchievementStats {
  return {
    ...current,
    sales: current.sales + (patch.sales ?? 0),
    maxTripVibes: Math.max(current.maxTripVibes, patch.maxTripVibes ?? 0),
    partsBanked: current.partsBanked + (patch.partsBanked ?? 0),
    bagDrops: current.bagDrops + (patch.bagDrops ?? 0),
    roofRescues: current.roofRescues + (patch.roofRescues ?? 0),
    collapsesSurvived:
      current.collapsesSurvived + (patch.collapsesSurvived ?? 0),
    depotPurchases: current.depotPurchases + (patch.depotPurchases ?? 0),
    laddersPlaced: current.laddersPlaced + (patch.laddersPlaced ?? 0),
    planksPlaced: current.planksPlaced + (patch.planksPlaced ?? 0),
    recallsWithLoot: current.recallsWithLoot + (patch.recallsWithLoot ?? 0),
    recoveries: current.recoveries + (patch.recoveries ?? 0),
    beaconsPlanted: current.beaconsPlanted + (patch.beaconsPlanted ?? 0),
    elevatorRides: current.elevatorRides + (patch.elevatorRides ?? 0),
    bunkerRaidsSurvived:
      current.bunkerRaidsSurvived + (patch.bunkerRaidsSurvived ?? 0),
    raidsSurvivedSealed:
      current.raidsSurvivedSealed + (patch.raidsSurvivedSealed ?? 0),
    bunkerSkinsBought:
      current.bunkerSkinsBought + (patch.bunkerSkinsBought ?? 0),
    bunkerCellsDug: current.bunkerCellsDug + (patch.bunkerCellsDug ?? 0),
    matchWins: current.matchWins + (patch.matchWins ?? 0),
    // Derived levels, not event counts: the server recomputes them from
    // durable records at snapshot time, so merging takes the high water.
    chassisFought: Math.max(current.chassisFought, patch.chassisFought ?? 0),
    sawMatchWins: current.sawMatchWins + (patch.sawMatchWins ?? 0),
    // Derived from the saved designs (a painted design exists or not), so
    // it merges as a high-water mark rather than a sum.
    designsPainted: Math.max(current.designsPainted, patch.designsPainted ?? 0),
    // Derived from the match records at snapshot time (F-252): high water.
    ruleMatches: Math.max(current.ruleMatches, patch.ruleMatches ?? 0),
  };
}

export function achievementMetricValue(
  snapshot: AchievementSnapshot,
  metric: AchievementMetric,
): number {
  switch (metric) {
    case "deepestDepth":
      return snapshot.deepestDepth;
    case "activeBiomePortals":
      return snapshot.activeBiomePortals;
    case "pickaxeLevel":
      return snapshot.pickaxeLevel;
    case "batteryLevel":
      return snapshot.batteryLevel;
    case "cargoLevel":
      return snapshot.cargoLevel;
    case "lanternLevel":
      return snapshot.lanternLevel;
    case "blastLevel":
      return snapshot.blastLevel;
    case "warpcoilLevel":
      return snapshot.warpcoilLevel;
    case "elevatorDepth":
      return snapshot.elevatorDepth;
    case "elevatorSpeedLevel":
      return snapshot.elevatorSpeedLevel;
    default:
      return snapshot.stats[metric];
  }
}

export function achievementProgress(
  definition: AchievementDefinition,
  snapshot: AchievementSnapshot,
): AchievementProgress {
  const current = achievementMetricValue(snapshot, definition.metric);
  return {
    current,
    target: definition.target,
    label: `${Math.min(current, definition.target)}/${definition.target}`,
  };
}

export function achievementIdsUnlockedBy(
  snapshot: AchievementSnapshot,
): string[] {
  return ACHIEVEMENT_DEFINITIONS.filter(
    (definition) =>
      achievementMetricValue(snapshot, definition.metric) >= definition.target,
  ).map((definition) => definition.id);
}

export function buildAchievementViews(
  snapshot: AchievementSnapshot,
  unlocked: ReadonlyMap<string, string>,
): PlayerAchievementView[] {
  return ACHIEVEMENT_DEFINITIONS.map((definition) => ({
    ...definition,
    unlocked: unlocked.has(definition.id),
    unlockedAt: unlocked.get(definition.id) ?? null,
    progress: achievementProgress(definition, snapshot),
  }));
}
