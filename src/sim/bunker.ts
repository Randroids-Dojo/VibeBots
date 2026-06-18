export const BUNKER_CLAIM_WIDTH = 7;
export const BUNKER_CLAIM_HEIGHT = 5;
export const BUNKER_RAID_DURATION_SECONDS = 180;
export const DEFENSE_XP_PER_LEVEL = 100;

export type BasePartId = "wall-panel" | "door-panel";

export interface BasePartDef {
  id: BasePartId;
  name: string;
  price: number;
  durability: number;
  blocksClankers: boolean;
}

export const BASE_PART_CATALOG: Record<BasePartId, BasePartDef> = {
  "wall-panel": {
    id: "wall-panel",
    name: "Wall Panel",
    price: 6,
    durability: 90,
    blocksClankers: true,
  },
  "door-panel": {
    id: "door-panel",
    name: "Door Panel",
    price: 10,
    durability: 60,
    blocksClankers: true,
  },
};

export type BasePartInventory = Record<BasePartId, number>;

export const EMPTY_BASE_PART_INVENTORY: BasePartInventory = {
  "wall-panel": 0,
  "door-panel": 0,
};

export const STARTER_BASE_PART_INVENTORY: BasePartInventory = {
  "wall-panel": 4,
  "door-panel": 1,
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
  totalPartDurability: number;
  incomingDamage: number;
  breached: boolean;
  survived: boolean;
  reward: {
    vibes: number;
    defenseXp: number;
  };
}

export function overallPlayerLevel(trackXp: number, defenseXp: number): number {
  return (
    1 + Math.floor(Math.max(0, trackXp + defenseXp) / DEFENSE_XP_PER_LEVEL)
  );
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
    return sum + Math.max(0, part.durability);
  }, 0);
  const incomingDamage = clankerCount * (18 + normalizedTier * 8);
  const breached =
    incomingDamage >= totalPartDurability + bunker.core.durability;
  const survived = !breached;
  return {
    raidId,
    tier: normalizedTier,
    durationSeconds: BUNKER_RAID_DURATION_SECONDS,
    clankers,
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
