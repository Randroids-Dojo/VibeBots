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

export const STARTER_BASE_PART_INVENTORY: BasePartInventory = {
  "wall-panel": 2,
  "floor-panel": 3,
  "roof-panel": 3,
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

export interface ClankerState {
  id: string;
  col: number;
  row: number;
  targetCol: number;
  targetRow: number;
  path?: Array<{ col: number; row: number }>;
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
  breached: boolean;
  survived: boolean;
  reward: {
    vibes: number;
    defenseXp: number;
  };
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
  stampAwarded: boolean;
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
          ? 16
          : 12;
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

export function resolveBunkerRaid(
  bunker: BunkerState,
  tier: number,
  raidId = "raid-1",
  options: BunkerRaidPathingOptions = {},
): BunkerRaidSnapshot {
  const normalizedTier = Math.max(1, Math.floor(tier));
  const targets = candidateTargets(bunker);
  const clankerCount = 4 + normalizedTier * 2;
  const clankers: ClankerState[] = [];
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
    clankers.push({
      id: `${raidId}-clanker-${i + 1}`,
      col: start.col,
      row: start.row,
      targetCol: route.target.col,
      targetRow: route.target.row,
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
  const incomingDamage = Math.max(
    0,
    clankerCount * (18 + normalizedTier * 8) - turretDamage - spikeDamage,
  );
  const breached =
    incomingDamage >= totalPartDurability + bunker.core.durability;
  const survived = !breached;
  return {
    raidId,
    tier: normalizedTier,
    durationSeconds: BUNKER_RAID_DURATION_SECONDS,
    startedAtMs: options.startedAtMs,
    clankers,
    turretShots,
    turretDamage,
    spikeTriggers,
    spikeDamage,
    totalPartDurability,
    incomingDamage,
    breached,
    survived,
    reward: survived
      ? {
          vibes: 20 + normalizedTier * 10,
          defenseXp: 40 + normalizedTier * 20,
        }
      : { vibes: 0, defenseXp: 0 },
  };
}

export function applyBunkerRaidWear(
  bunker: BunkerState,
  raid: Pick<BunkerRaidSnapshot, "clankers" | "spikeTriggers" | "turretShots">,
): BunkerState {
  let remainingSpikeSteps = raid.spikeTriggers;
  let remainingTurretHits = Math.max(
    0,
    raid.clankers.length - raid.turretShots,
  );
  return {
    ...bunker,
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
      }),
  };
}
