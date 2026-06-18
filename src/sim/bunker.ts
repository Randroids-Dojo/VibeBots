export const BUNKER_CLAIM_WIDTH = 7;
export const BUNKER_CLAIM_HEIGHT = 5;
export const BUNKER_RAID_DURATION_SECONDS = 180;
export const BUNKER_RAID_COOLDOWN_HOURS = 4;
export const DEFENSE_XP_PER_LEVEL = 100;
export const PLAYER_LEVEL_CAP = 2;
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
    name: "Panel",
    blurb: "cheap filler for bunker rooms",
    price: 6,
    durability: 90,
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
  "door-panel": 0,
  "basic-turret": 0,
  "floor-spikes": 0,
};

export const STARTER_BASE_PART_INVENTORY: BasePartInventory = {
  "wall-panel": 4,
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
}

export interface BunkerRaidSnapshot {
  raidId: string;
  tier: number;
  durationSeconds: number;
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
  centerCol: number,
  centerRow: number,
): BunkerFootprint {
  return {
    col: centerCol - Math.floor(BUNKER_CLAIM_WIDTH / 2),
    row: centerRow - Math.floor(BUNKER_CLAIM_HEIGHT / 2),
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

function perimeterTargets(footprint: BunkerFootprint): Array<{
  col: number;
  row: number;
}> {
  return bunkerCells(footprint).filter((cell) =>
    isBunkerPerimeterCell(footprint, cell.col, cell.row),
  );
}

export function resolveBunkerRaid(
  bunker: BunkerState,
  tier: number,
  raidId = "raid-1",
): BunkerRaidSnapshot {
  const normalizedTier = Math.max(1, Math.floor(tier));
  const targets = perimeterTargets(bunker.footprint);
  const clankerCount = 4 + normalizedTier * 2;
  const clankers: ClankerState[] = [];
  for (let i = 0; i < clankerCount; i++) {
    const target = targets[i % targets.length] ?? bunker.core;
    clankers.push({
      id: `${raidId}-clanker-${i + 1}`,
      col:
        i % 2 === 0
          ? bunker.footprint.col - 3 - Math.floor(i / 2)
          : bunker.footprint.col +
            bunker.footprint.width +
            2 +
            Math.floor(i / 2),
      row: target.row,
      targetCol: target.col,
      targetRow: target.row,
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
