export const BUNKER_CLAIM_WIDTH = 7;
export const BUNKER_CLAIM_HEIGHT = 5;
export const BUNKER_RAID_DURATION_SECONDS = 180;
export const BUNKER_RAID_COOLDOWN_HOURS = 4;
export const DEFENSE_XP_PER_LEVEL = 100;
export const PLAYER_LEVEL_CAP = 100;
export const LEVEL_ONE_BEACON_LIMIT = 2;
export const LEVEL_TWO_BEACON_LIMIT = 3;
export const BASIC_TURRET_AMMO = 3;
export const BASIC_TURRET_DAMAGE = 18;
export const FLOOR_SPIKES_DURABILITY = 3;
export const FLOOR_SPIKES_DAMAGE = 16;
export const BASIC_TURRET_MIN_LEVEL = 2;
export const BASIC_TURRET_OWNED_LIMIT = 1;
export const FLOOR_SPIKES_LEVEL_ONE_LIMIT = 4;
export const FLOOR_SPIKES_LEVEL_TWO_LIMIT = 6;
export const CLANKER_BASE_BATTERY_STEPS = 7;
export const CLANKER_BATTERY_STEPS_PER_TIER = 2;
export const CLANKER_BASE_BITE_DAMAGE = 24;
export const CLANKER_BITE_DAMAGE_PER_TIER = 8;
export const CLANKER_SELF_DESTRUCT_XP = 25;
export const CLANKER_BREACHER_XP = 40;
export const CLANKER_TANK_XP = 50;
/** Bite multiplier a breacher applies to blocker parts. */
export const CLANKER_BREACHER_BITE_FACTOR = 2;
/** Turret shots needed to stop a tank. */
export const CLANKER_TANK_TURRET_SHOTS = 2;
export const BUNKER_RAID_PICKUP_COLLECTION_RADIUS = 1;

export const BASE_PART_IDS = [
  "wall-panel",
  "floor-panel",
  "roof-panel",
  "door-panel",
  "basic-turret",
  "floor-spikes",
] as const;
export type BasePartId = (typeof BASE_PART_IDS)[number];

export interface BasePartDef {
  id: BasePartId;
  name: string;
  blurb: string;
  price: number;
  durability: number;
  blocksClankers: boolean;
  ammo?: number;
  stepDamage?: number;
}

export const BASE_PART_CATALOG: Record<BasePartId, BasePartDef> = {
  "wall-panel": {
    id: "wall-panel",
    name: "Wall",
    blurb: "starter side wall for small bunker rooms",
    price: 6,
    durability: 90,
    blocksClankers: true,
  },
  "floor-panel": {
    id: "floor-panel",
    name: "Floor",
    blurb: "walkable room floor plate",
    price: 5,
    durability: 70,
    blocksClankers: true,
  },
  "roof-panel": {
    id: "roof-panel",
    name: "Roof",
    blurb: "overhead room cap",
    price: 5,
    durability: 70,
    blocksClankers: true,
  },
  "door-panel": {
    id: "door-panel",
    name: "Door",
    blurb: "basic entry blocker",
    price: 10,
    durability: 60,
    blocksClankers: true,
  },
  "basic-turret": {
    id: "basic-turret",
    name: "Basic Turret",
    blurb: "autofires at Clankers",
    price: 160,
    durability: 5,
    blocksClankers: false,
    ammo: BASIC_TURRET_AMMO,
  },
  "floor-spikes": {
    id: "floor-spikes",
    name: "Floor Spikes",
    blurb: "damages Clankers that step over it",
    price: 16,
    durability: FLOOR_SPIKES_DURABILITY,
    blocksClankers: false,
    stepDamage: FLOOR_SPIKES_DAMAGE,
  },
};

export type BasePartInventory = Record<BasePartId, number>;

export const EMPTY_BASE_PART_INVENTORY: BasePartInventory = {
  "wall-panel": 0,
  "floor-panel": 0,
  "roof-panel": 0,
  "door-panel": 0,
  "basic-turret": 0,
  "floor-spikes": 0,
};

/**
 * Enough to fully enclose the player cell on day one: a sealed 3x3
 * room around the core takes 3 floors, 3 roofs, 1 wall, and the door,
 * which leaves spare walls for layering or a roomier shape. Every
 * granted part blocks Clankers, so a sealed starter room genuinely
 * survives a raid (see "the starter kit seals the player cell").
 */
export const STARTER_BASE_PART_INVENTORY: BasePartInventory = {
  "wall-panel": 6,
  "floor-panel": 4,
  "roof-panel": 4,
  "door-panel": 1,
  "basic-turret": 0,
  "floor-spikes": 0,
};

export interface BunkerFootprint {
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface BunkerCore {
  col: number;
  row: number;
  durability: number;
}

export interface PlacedBasePart {
  partId: BasePartId;
  col: number;
  row: number;
  durability: number;
}

export interface BunkerState {
  footprint: BunkerFootprint;
  core: BunkerCore;
  parts: PlacedBasePart[];
}

export interface PendingBunkerBuild {
  claimCol: number;
  claimRow: number;
  claimedAtMoveCount: number;
  bunker: BunkerState;
  inventory: BasePartInventory;
}

export interface PendingBunkerClaimPayload {
  claimCol: number;
  claimRow: number;
  claimedAtMoveCount: number;
  parts: PlacedBasePart[];
}

export type ClankerKind = "standard" | "breacher" | "tank";

export interface ClankerState {
  id: string;
  /** Specialist behavior (F-085): breachers bite blockers twice as hard,
   * tanks soak two turret shots. Old snapshots normalize to standard. */
  kind: ClankerKind;
  col: number;
  row: number;
  targetCol: number;
  targetRow: number;
  path?: Array<{ col: number; row: number }>;
  batterySteps: number;
  deathStep: number;
  status: "turret-destroyed" | "self-destructed" | "battery-drained";
}

/** Deterministic specialist assignment: tier 2 unlocks breachers (every
 * third slot), tier 3 unlocks tanks (every fourth slot, checked first so
 * the mix stays stable as waves grow). */
export function clankerKindFor(index: number, tier: number): ClankerKind {
  if (tier >= 3 && index % 4 === 3) return "tank";
  if (tier >= 2 && index % 3 === 2) return "breacher";
  return "standard";
}

/** Specialists drop more XP: they are harder to stop. */
export function clankerXpFor(kind: ClankerKind): number {
  if (kind === "tank") return CLANKER_TANK_XP;
  if (kind === "breacher") return CLANKER_BREACHER_XP;
  return CLANKER_SELF_DESTRUCT_XP;
}

export interface BunkerRaidDamageEvent {
  clankerId: string;
  col: number;
  row: number;
  target: "part" | "core";
  partId?: BasePartId;
  damage: number;
}

export interface BunkerRaidSnapshot {
  raidId: string;
  tier: number;
  durationSeconds: number;
  startedAtMs?: number;
  clankers: ClankerState[];
  turretShots: number;
  turretDamage: number;
  spikeTriggers: number;
  spikeDamage: number;
  totalPartDurability: number;
  incomingDamage: number;
  partDamage: BunkerRaidDamageEvent[];
  coreDamage: number;
  xpPickups: Array<{
    id: string;
    col: number;
    row: number;
    defenseXp: number;
    collected: boolean;
  }>;
  allClankersDead: boolean;
  breached: boolean;
  minerKilled: boolean;
  survived: boolean;
  /**
   * True when the raid was survived AND no clanker could even target
   * the player cell: the enclosure held. Absent on snapshots stored
   * before 0.1.214 (treated as false; old raids cannot prove a seal).
   */
  sealed: boolean;
  reward: {
    vibes: number;
    defenseXp: number;
  };
}

export function canCollectBunkerRaidPickupFrom(
  pickup: { col: number; row: number; collected: boolean },
  minerCol: number,
  minerRow: number,
): boolean {
  return (
    !pickup.collected &&
    Math.abs(pickup.col - minerCol) <= BUNKER_RAID_PICKUP_COLLECTION_RADIUS &&
    Math.abs(pickup.row - minerRow) <= BUNKER_RAID_PICKUP_COLLECTION_RADIUS
  );
}

export type BunkerRaidTerrainKind =
  | "empty"
  | "dirt"
  | "ore"
  | "part-cache"
  | "rock"
  | "boulder"
  | "gas"
  | "magma"
  | "metal";

export interface BunkerRaidPathingOptions {
  startedAtMs?: number;
  terrainAt?: (col: number, row: number) => BunkerRaidTerrainKind;
}

export interface BunkerRaidRewardReport {
  survived: boolean;
  vibesGained: number;
  xpGained: number;
  defenseXpBefore: number;
  defenseXpAfter: number;
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
  beaconLimitBefore: number;
  beaconLimitAfter: number;
  /** Every stamp first unlocked by this raid's reward pass. */
  newStamps: string[];
}

export interface PlayerLevelProgress {
  level: number;
  currentXp: number;
  cap: number;
  nextLevelXp: number | null;
  progressXp: number;
  neededXp: number;
  beaconLimit: number;
}

/** Hard ceiling on raid difficulty tiers regardless of level. */
export const BUNKER_RAID_TIER_CAP = 5;

/** Highest raid tier a player may start: one tier per player level,
 * capped. Tier scales the wave (4 + 2/tier Clankers), their battery
 * reach, and their bite damage; more Clankers also mean more XP
 * pickups, so reward scales with the count by construction (F-084). */
export function maxBunkerRaidTier(playerLevel: number): number {
  return Math.max(1, Math.min(BUNKER_RAID_TIER_CAP, Math.floor(playerLevel)));
}

export function overallPlayerLevel(trackXp: number, defenseXp: number): number {
  void trackXp;
  return playerLevelProgress(defenseXp).level;
}

export function playerLevelProgress(defenseXp: number): PlayerLevelProgress {
  const currentXp = Math.max(0, Math.floor(defenseXp));
  const uncappedLevel = 1 + Math.floor(currentXp / DEFENSE_XP_PER_LEVEL);
  const level = Math.min(PLAYER_LEVEL_CAP, uncappedLevel);
  const capped = level >= PLAYER_LEVEL_CAP;
  const nextLevelXp = capped ? null : level * DEFENSE_XP_PER_LEVEL;
  return {
    level,
    currentXp,
    cap: PLAYER_LEVEL_CAP,
    nextLevelXp,
    progressXp: capped
      ? DEFENSE_XP_PER_LEVEL
      : currentXp - (level - 1) * DEFENSE_XP_PER_LEVEL,
    neededXp: capped ? 0 : Math.max(0, (nextLevelXp ?? 0) - currentXp),
    beaconLimit: level >= 2 ? LEVEL_TWO_BEACON_LIMIT : LEVEL_ONE_BEACON_LIMIT,
  };
}

export function addBasePartInventory(
  inventory: BasePartInventory,
  partId: BasePartId,
  count: number,
): BasePartInventory {
  return {
    ...inventory,
    [partId]: Math.max(0, inventory[partId] + count),
  };
}

export function basePartMinimumLevel(partId: BasePartId): number {
  return partId === "basic-turret" ? BASIC_TURRET_MIN_LEVEL : 1;
}

export function basePartOwnedLimit(
  partId: BasePartId,
  playerLevel: number,
): number {
  if (partId === "basic-turret") {
    return playerLevel >= BASIC_TURRET_MIN_LEVEL ? BASIC_TURRET_OWNED_LIMIT : 0;
  }
  if (partId === "floor-spikes") {
    return playerLevel >= 2
      ? FLOOR_SPIKES_LEVEL_TWO_LIMIT
      : FLOOR_SPIKES_LEVEL_ONE_LIMIT;
  }
  return Number.POSITIVE_INFINITY;
}

export function basePartOwnedCount(
  partId: BasePartId,
  bunker: BunkerState | null,
  inventory: BasePartInventory,
): number {
  const deployed =
    bunker?.parts.filter((part) => part.partId === partId).length ?? 0;
  return (inventory[partId] ?? 0) + deployed;
}

export function canBuyBasePart(
  partId: BasePartId,
  playerLevel: number,
  bunker: BunkerState | null,
  inventory: BasePartInventory,
  quantity: number,
):
  | { ok: true }
  | {
      ok: false;
      reason: "level" | "limit";
      minLevel?: number;
      limit?: number;
    } {
  const minLevel = basePartMinimumLevel(partId);
  if (playerLevel < minLevel) {
    return { ok: false, reason: "level", minLevel };
  }
  const limit = basePartOwnedLimit(partId, playerLevel);
  if (basePartOwnedCount(partId, bunker, inventory) + quantity > limit) {
    return { ok: false, reason: "limit", limit };
  }
  return { ok: true };
}

export function proposedBunkerFootprint(
  minerCol: number,
  minerRow: number,
): BunkerFootprint {
  return {
    col: minerCol - Math.floor(BUNKER_CLAIM_WIDTH / 2),
    row: minerRow - BUNKER_CLAIM_HEIGHT + 1,
    width: BUNKER_CLAIM_WIDTH,
    height: BUNKER_CLAIM_HEIGHT,
  };
}

export function bunkerCells(footprint: BunkerFootprint): Array<{
  col: number;
  row: number;
}> {
  const cells = [];
  for (let row = footprint.row; row < footprint.row + footprint.height; row++) {
    for (
      let col = footprint.col;
      col < footprint.col + footprint.width;
      col++
    ) {
      cells.push({ col, row });
    }
  }
  return cells;
}

export function containsBunkerCell(
  footprint: BunkerFootprint,
  col: number,
  row: number,
): boolean {
  return (
    col >= footprint.col &&
    col < footprint.col + footprint.width &&
    row >= footprint.row &&
    row < footprint.row + footprint.height
  );
}

export function isBunkerPerimeterCell(
  footprint: BunkerFootprint,
  col: number,
  row: number,
): boolean {
  return (
    containsBunkerCell(footprint, col, row) &&
    (col === footprint.col ||
      col === footprint.col + footprint.width - 1 ||
      row === footprint.row ||
      row === footprint.row + footprint.height - 1)
  );
}

export function createBunker(footprint: BunkerFootprint): BunkerState {
  return {
    footprint,
    core: {
      col: footprint.col + Math.floor(footprint.width / 2),
      row: footprint.row + Math.floor(footprint.height / 2),
      durability: 160,
    },
    parts: [],
  };
}

export function placeBasePart(
  bunker: BunkerState,
  inventory: BasePartInventory,
  partId: BasePartId,
  col: number,
  row: number,
):
  | { ok: true; bunker: BunkerState; inventory: BasePartInventory }
  | {
      ok: false;
      reason: "outside" | "core" | "occupied" | "stock";
    } {
  if (!containsBunkerCell(bunker.footprint, col, row)) {
    return { ok: false, reason: "outside" };
  }
  if (bunker.core.col === col && bunker.core.row === row) {
    return { ok: false, reason: "core" };
  }
  if (bunker.parts.some((part) => part.col === col && part.row === row)) {
    return { ok: false, reason: "occupied" };
  }
  if (inventory[partId] <= 0) return { ok: false, reason: "stock" };
  const def = BASE_PART_CATALOG[partId];
  return {
    ok: true,
    bunker: {
      ...bunker,
      parts: [
        ...bunker.parts,
        { partId, col, row, durability: def.durability },
      ],
    },
    inventory: addBasePartInventory(inventory, partId, -1),
  };
}

export function removeBasePart(
  bunker: BunkerState,
  inventory: BasePartInventory,
  col: number,
  row: number,
):
  | { ok: true; bunker: BunkerState; inventory: BasePartInventory }
  | {
      ok: false;
      reason: "missing" | "damaged";
    } {
  const part = bunker.parts.find((candidate) => {
    return candidate.col === col && candidate.row === row;
  });
  if (!part) return { ok: false, reason: "missing" };
  const def = BASE_PART_CATALOG[part.partId];
  if (part.durability < def.durability) return { ok: false, reason: "damaged" };
  return {
    ok: true,
    bunker: {
      ...bunker,
      parts: bunker.parts.filter((candidate) => candidate !== part),
    },
    inventory: addBasePartInventory(inventory, part.partId, 1),
  };
}

export function moveBasePart(
  bunker: BunkerState,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
):
  | { ok: true; bunker: BunkerState }
  | {
      ok: false;
      reason: "missing" | "outside" | "core" | "occupied";
    } {
  const part = bunker.parts.find((candidate) => {
    return candidate.col === fromCol && candidate.row === fromRow;
  });
  if (!part) return { ok: false, reason: "missing" };
  if (!containsBunkerCell(bunker.footprint, toCol, toRow)) {
    return { ok: false, reason: "outside" };
  }
  if (bunker.core.col === toCol && bunker.core.row === toRow) {
    return { ok: false, reason: "core" };
  }
  if (
    bunker.parts.some((candidate) => {
      return (
        candidate !== part && candidate.col === toCol && candidate.row === toRow
      );
    })
  ) {
    return { ok: false, reason: "occupied" };
  }
  if (fromCol === toCol && fromRow === toRow) return { ok: true, bunker };
  return {
    ok: true,
    bunker: {
      ...bunker,
      parts: bunker.parts.map((candidate) =>
        candidate === part
          ? { ...candidate, col: toCol, row: toRow }
          : candidate,
      ),
    },
  };
}

function perimeterTargets(footprint: BunkerFootprint): Array<{
  col: number;
  row: number;
}> {
  return bunkerCells(footprint).filter((cell) =>
    isBunkerPerimeterCell(footprint, cell.col, cell.row),
  );
}

const coordKey = (col: number, row: number) => `${col},${row}`;

function terrainCost(kind: BunkerRaidTerrainKind): number {
  if (kind === "empty") return 1;
  if (kind === "dirt" || kind === "ore") return 8;
  return Number.POSITIVE_INFINITY;
}

function findPartAt(
  bunker: BunkerState,
  col: number,
  row: number,
): PlacedBasePart | undefined {
  return bunker.parts.find((part) => part.col === col && part.row === row);
}

function bunkerCellCost(
  bunker: BunkerState,
  col: number,
  row: number,
  target: { col: number; row: number },
): number {
  if (bunker.core.col === col && bunker.core.row === row) {
    return target.col === col && target.row === row
      ? 12
      : Number.POSITIVE_INFINITY;
  }
  const part = findPartAt(bunker, col, row);
  if (!part) return 1;
  const def = BASE_PART_CATALOG[part.partId];
  if (!def.blocksClankers) return 1;
  return target.col === col && target.row === row
    ? 10
    : Number.POSITIVE_INFINITY;
}

function candidateTargets(
  bunker: BunkerState,
): Array<{ col: number; row: number }> {
  const targets = perimeterTargets(bunker.footprint);
  const blockingParts = bunker.parts
    .filter((part) => BASE_PART_CATALOG[part.partId].blocksClankers)
    .filter((part) =>
      isBunkerPerimeterCell(bunker.footprint, part.col, part.row),
    )
    .map((part) => ({ col: part.col, row: part.row }));
  return [...blockingParts, ...targets, bunker.core];
}

function chooseClankerSpawn(
  bunker: BunkerState,
  index: number,
  options: BunkerRaidPathingOptions,
  reservations: Set<string>,
): { col: number; row: number } {
  const sideIndex = Math.floor(index / 2);
  const left = index % 2 === 0;
  const idealCol = left
    ? bunker.footprint.col - 3 - sideIndex
    : bunker.footprint.col + bunker.footprint.width + 2 + sideIndex;
  const idealRow = Math.max(0, bunker.footprint.row - 1);
  const candidates: Array<{ col: number; row: number; score: number }> = [];
  const maxRowLift = idealRow;
  const maxSideStep = 6 + sideIndex;
  for (let rowLift = 0; rowLift <= maxRowLift; rowLift++) {
    const row = idealRow - rowLift;
    for (let sideStep = 0; sideStep <= maxSideStep; sideStep++) {
      const col = idealCol + (left ? -sideStep : sideStep);
      if (containsBunkerCell(bunker.footprint, col, row)) continue;
      if ((options.terrainAt?.(col, row) ?? "empty") !== "empty") continue;
      const reservationPenalty = reservations.has(coordKey(col, row)) ? 100 : 0;
      candidates.push({
        col,
        row,
        score: rowLift * 3 + sideStep + reservationPenalty,
      });
    }
  }
  candidates.sort((a, b) => {
    return a.score - b.score || a.row - b.row || a.col - b.col;
  });
  return candidates[0] ?? { col: idealCol, row: 0 };
}

function routeToTarget(
  bunker: BunkerState,
  start: { col: number; row: number },
  target: { col: number; row: number },
  options: BunkerRaidPathingOptions,
  reservations: Map<string, number>,
): { path: Array<{ col: number; row: number }>; score: number } | null {
  const margin = 10 + Math.max(bunker.footprint.width, bunker.footprint.height);
  const minCol = bunker.footprint.col - margin;
  const maxCol = bunker.footprint.col + bunker.footprint.width + margin;
  const minRow = Math.max(0, bunker.footprint.row - margin);
  const maxRow = bunker.footprint.row + bunker.footprint.height + margin;
  const startKey = coordKey(start.col, start.row);
  const targetKey = coordKey(target.col, target.row);
  const costs = new Map<string, number>([[startKey, 0]]);
  const parents = new Map<string, string>();
  const open = [startKey];

  while (open.length > 0) {
    open.sort((a, b) => {
      const costDiff = (costs.get(a) ?? 0) - (costs.get(b) ?? 0);
      return costDiff || a.localeCompare(b);
    });
    const currentKey = open.shift();
    if (!currentKey) break;
    if (currentKey === targetKey) break;
    const [col, row] = currentKey.split(",").map(Number);
    for (const next of [
      { col: col + 1, row },
      { col: col - 1, row },
      { col, row: row + 1 },
      { col, row: row - 1 },
    ]) {
      if (
        next.col < minCol ||
        next.col > maxCol ||
        next.row < minRow ||
        next.row > maxRow
      ) {
        continue;
      }
      let stepCost = terrainCost(
        options.terrainAt?.(next.col, next.row) ?? "empty",
      );
      if (containsBunkerCell(bunker.footprint, next.col, next.row)) {
        stepCost = bunkerCellCost(bunker, next.col, next.row, target);
      }
      if (!Number.isFinite(stepCost)) continue;
      const reservationPenalty =
        (reservations.get(coordKey(next.col, next.row)) ?? 0) * 6;
      const nextCost =
        (costs.get(currentKey) ?? 0) + stepCost + reservationPenalty;
      const key = coordKey(next.col, next.row);
      if (nextCost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(key, nextCost);
      parents.set(key, currentKey);
      if (!open.includes(key)) open.push(key);
    }
  }

  const score = costs.get(targetKey);
  if (score === undefined) return null;
  const path: Array<{ col: number; row: number }> = [];
  let current = targetKey;
  while (current) {
    const [col, row] = current.split(",").map(Number);
    path.unshift({ col, row });
    if (current === startKey) break;
    const parent = parents.get(current);
    if (!parent) return null;
    current = parent;
  }
  return { path, score };
}

function planClankerRoute(
  bunker: BunkerState,
  start: { col: number; row: number },
  targets: Array<{ col: number; row: number }>,
  options: BunkerRaidPathingOptions,
  reservations: Map<string, number>,
): {
  target: { col: number; row: number };
  path: Array<{ col: number; row: number }>;
} {
  const coreRoute = routeToTarget(
    bunker,
    start,
    bunker.core,
    options,
    reservations,
  );
  if (coreRoute) return { target: bunker.core, path: coreRoute.path };

  let best: {
    target: { col: number; row: number };
    path: Array<{ col: number; row: number }>;
    score: number;
  } | null = null;
  for (const target of targets) {
    const route = routeToTarget(bunker, start, target, options, reservations);
    if (!route) continue;
    const finalPenalty =
      (reservations.get(coordKey(target.col, target.row)) ?? 0) * 20;
    const part = findPartAt(bunker, target.col, target.row);
    const targetPriority =
      part && BASE_PART_CATALOG[part.partId].blocksClankers
        ? 0
        : bunker.core.col === target.col && bunker.core.row === target.row
          ? 6
          : 50;
    const score = route.score + finalPenalty + targetPriority;
    if (
      !best ||
      score < best.score ||
      (score === best.score &&
        (target.row < best.target.row ||
          (target.row === best.target.row && target.col < best.target.col)))
    ) {
      best = { target, path: route.path, score };
    }
  }
  if (best) return { target: best.target, path: best.path };
  return { target: bunker.core, path: [start, bunker.core] };
}

function reservePath(
  reservations: Map<string, number>,
  path: Array<{ col: number; row: number }>,
): void {
  for (const cell of path) {
    const key = coordKey(cell.col, cell.row);
    reservations.set(key, (reservations.get(key) ?? 0) + 1);
  }
}

function clankerBatterySteps(tier: number): number {
  return CLANKER_BASE_BATTERY_STEPS + tier * CLANKER_BATTERY_STEPS_PER_TIER;
}

function clankerBiteDamage(tier: number): number {
  return CLANKER_BASE_BITE_DAMAGE + tier * CLANKER_BITE_DAMAGE_PER_TIER;
}

function clankerBlockerAttackCount(
  batterySteps: number,
  routeSteps: number,
): number {
  return Math.max(1, batterySteps - routeSteps + 1);
}

function extendPathForBlockerAttack(
  path: Array<{ col: number; row: number }>,
  attackCount: number,
): Array<{ col: number; row: number }> {
  const finalCell = path.at(-1);
  if (!finalCell || attackCount <= 1) return path;
  const extended = [...path];
  for (let i = 1; i < attackCount; i++) {
    extended.push(finalCell);
  }
  return extended;
}

function reachableDropCellBeforeTarget(
  path: Array<{ col: number; row: number }>,
): { col: number; row: number } {
  return path[Math.max(0, path.length - 2)] ?? path[0] ?? { col: 0, row: 0 };
}

export function resolveBunkerRaid(
  bunker: BunkerState,
  tier: number,
  raidId = "raid-1",
  options: BunkerRaidPathingOptions = {},
): BunkerRaidSnapshot {
  const normalizedTier = Math.max(1, Math.floor(tier));
  const targets = candidateTargets(bunker);
  const clankerCount = 4 + normalizedTier * 2;
  const plannedRoutes: Array<{
    id: string;
    start: { col: number; row: number };
    target: { col: number; row: number };
    path: Array<{ col: number; row: number }>;
  }> = [];
  const reservations = new Map<string, number>();
  const spawnReservations = new Set<string>();
  for (let i = 0; i < clankerCount; i++) {
    const start = chooseClankerSpawn(bunker, i, options, spawnReservations);
    spawnReservations.add(coordKey(start.col, start.row));
    const route = planClankerRoute(
      bunker,
      start,
      targets,
      options,
      reservations,
    );
    reservePath(reservations, route.path);
    plannedRoutes.push({
      id: `${raidId}-clanker-${i + 1}`,
      start,
      target: route.target,
      path: route.path,
    });
  }
  const totalPartDurability = bunker.parts.reduce((sum, part) => {
    const def = BASE_PART_CATALOG[part.partId];
    if (!def.blocksClankers) return sum;
    return sum + Math.max(0, part.durability);
  }, 0);
  const turretAmmo = bunker.parts.reduce((sum, part) => {
    if (part.partId !== "basic-turret") return sum;
    return sum + (BASE_PART_CATALOG["basic-turret"].ammo ?? 0);
  }, 0);
  const turretShots = Math.min(clankerCount, turretAmmo);
  const turretDamage = turretShots * BASIC_TURRET_DAMAGE;
  const liveSpikeCount = bunker.parts.filter(
    (part) => part.partId === "floor-spikes" && part.durability > 0,
  ).length;
  const spikeTriggers = Math.min(clankerCount, liveSpikeCount);
  const spikeDamage = spikeTriggers * FLOOR_SPIKES_DAMAGE;
  const clankers: ClankerState[] = [];
  const partDamage: BunkerRaidDamageEvent[] = [];
  const xpPickups: BunkerRaidSnapshot["xpPickups"] = [];
  const biteDamage = clankerBiteDamage(normalizedTier);
  const batterySteps = clankerBatterySteps(normalizedTier);
  let coreDamage = 0;
  let remainingTurretShots = turretShots;
  let minerDeathStep: number | null = null;

  let routeIndex = -1;
  for (const route of plannedRoutes) {
    routeIndex++;
    const kind = clankerKindFor(routeIndex, normalizedTier);
    const shotsToStop = kind === "tank" ? CLANKER_TANK_TURRET_SHOTS : 1;
    if (remainingTurretShots >= shotsToStop) {
      remainingTurretShots -= shotsToStop;
      const deathCell = route.path[0] ?? route.start;
      clankers.push({
        id: route.id,
        kind,
        col: route.start.col,
        row: route.start.row,
        targetCol: route.target.col,
        targetRow: route.target.row,
        path: route.path,
        batterySteps,
        deathStep: 0,
        status: "turret-destroyed",
      });
      xpPickups.push({
        id: `${route.id}-xp`,
        col: deathCell.col,
        row: deathCell.row,
        defenseXp: clankerXpFor(kind),
        collected: false,
      });
      continue;
    }

    const routeSteps = Math.max(0, route.path.length - 1);
    const reachedTarget = routeSteps <= batterySteps;
    const deathStep = reachedTarget ? routeSteps : batterySteps;
    const deathCell =
      route.path[Math.min(deathStep, Math.max(0, route.path.length - 1))] ??
      route.start;
    const targetIsCore =
      reachedTarget &&
      route.target.col === bunker.core.col &&
      route.target.row === bunker.core.row;
    const targetPart = reachedTarget
      ? findPartAt(bunker, route.target.col, route.target.row)
      : undefined;
    let clankerPath = route.path;
    let clankerDeathStep = deathStep;
    let status: ClankerState["status"] = "self-destructed";

    if (targetPart) {
      const attackCount = clankerBlockerAttackCount(batterySteps, routeSteps);
      const kindBite =
        kind === "breacher"
          ? biteDamage * CLANKER_BREACHER_BITE_FACTOR
          : biteDamage;
      const damage = kindBite * attackCount;
      const pickupCell =
        damage >= targetPart.durability
          ? deathCell
          : reachableDropCellBeforeTarget(route.path);
      clankerPath = extendPathForBlockerAttack(route.path, attackCount);
      clankerDeathStep = batterySteps;
      status = "battery-drained";
      partDamage.push({
        clankerId: route.id,
        col: targetPart.col,
        row: targetPart.row,
        target: "part",
        partId: targetPart.partId,
        damage,
      });
      xpPickups.push({
        id: `${route.id}-xp`,
        col: pickupCell.col,
        row: pickupCell.row,
        defenseXp: clankerXpFor(kind),
        collected: false,
      });
    } else if (targetIsCore) {
      coreDamage += biteDamage;
      minerDeathStep = Math.min(minerDeathStep ?? deathStep, deathStep);
      partDamage.push({
        clankerId: route.id,
        col: bunker.core.col,
        row: bunker.core.row,
        target: "core",
        damage: biteDamage,
      });
    }

    if (!targetIsCore && !targetPart) {
      xpPickups.push({
        id: `${route.id}-xp`,
        col: deathCell.col,
        row: deathCell.row,
        defenseXp: clankerXpFor(kind),
        collected: false,
      });
    }

    clankers.push({
      id: route.id,
      kind,
      col: route.start.col,
      row: route.start.row,
      targetCol: route.target.col,
      targetRow: route.target.row,
      path: clankerPath,
      batterySteps,
      deathStep: clankerDeathStep,
      status,
    });
  }

  const incomingDamage = partDamage.reduce((sum, event) => {
    return sum + event.damage;
  }, 0);
  const lastDeathStep = clankers.reduce((maxStep, clanker) => {
    return Math.max(maxStep, clanker.deathStep);
  }, 0);
  const terminalStep = minerDeathStep ?? lastDeathStep;
  const durationSeconds = Math.min(
    BUNKER_RAID_DURATION_SECONDS,
    Math.max(3, terminalStep),
  );
  const minerKilled = minerDeathStep !== null;
  const breached = minerKilled || coreDamage >= bunker.core.durability;
  const survived = !breached;
  // The enclosure held outright: nobody could even target the core.
  const sealed =
    survived &&
    clankers.every(
      (clanker) =>
        clanker.targetCol !== bunker.core.col ||
        clanker.targetRow !== bunker.core.row,
    );
  const finalXpPickups = survived ? xpPickups : [];
  const pickupXp = finalXpPickups.reduce((sum, pickup) => {
    return sum + pickup.defenseXp;
  }, 0);
  return {
    raidId,
    tier: normalizedTier,
    durationSeconds,
    startedAtMs: options.startedAtMs,
    clankers,
    turretShots,
    turretDamage,
    spikeTriggers,
    spikeDamage,
    totalPartDurability,
    incomingDamage,
    partDamage,
    coreDamage,
    xpPickups: finalXpPickups,
    allClankersDead: true,
    breached,
    minerKilled,
    survived,
    sealed,
    reward: survived
      ? {
          vibes: 20 + normalizedTier * 10,
          defenseXp: pickupXp,
        }
      : { vibes: 0, defenseXp: 0 },
  };
}

export function applyBunkerRaidWear(
  bunker: BunkerState,
  raid: {
    clankers: readonly unknown[];
    spikeTriggers: number;
    turretShots: number;
    partDamage?: BunkerRaidDamageEvent[];
    coreDamage?: number;
  },
): BunkerState {
  let remainingSpikeSteps = raid.spikeTriggers;
  let remainingTurretHits = Math.max(
    0,
    raid.clankers.length - raid.turretShots,
  );
  const damageByPartCell = new Map<string, number>();
  for (const event of raid.partDamage ?? []) {
    if (event.target !== "part") continue;
    const key = coordKey(event.col, event.row);
    damageByPartCell.set(key, (damageByPartCell.get(key) ?? 0) + event.damage);
  }
  return {
    ...bunker,
    core: {
      ...bunker.core,
      durability: Math.max(0, bunker.core.durability - (raid.coreDamage ?? 0)),
    },
    parts: bunker.parts
      .flatMap((part) => {
        if (part.partId !== "floor-spikes" || remainingSpikeSteps <= 0) {
          return [part];
        }
        remainingSpikeSteps--;
        const nextDurability = Math.max(0, part.durability - 1);
        if (nextDurability <= 0) return [];
        return [{ ...part, durability: nextDurability }];
      })
      .flatMap((part) => {
        if (part.partId !== "basic-turret" || remainingTurretHits <= 0) {
          return [part];
        }
        const damage = Math.min(part.durability, remainingTurretHits);
        remainingTurretHits -= damage;
        const nextDurability = Math.max(0, part.durability - damage);
        if (nextDurability <= 0) return [];
        return [{ ...part, durability: nextDurability }];
      })
      .flatMap((part) => {
        const damage = damageByPartCell.get(coordKey(part.col, part.row)) ?? 0;
        if (damage <= 0) return [part];
        const nextDurability = Math.max(0, part.durability - damage);
        if (nextDurability <= 0) return [];
        return [{ ...part, durability: nextDurability }];
      }),
  };
}
