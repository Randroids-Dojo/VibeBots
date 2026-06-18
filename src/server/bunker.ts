import {
  BASE_PART_CATALOG,
  type BasePartId,
  type BasePartInventory,
  BUNKER_RAID_COOLDOWN_HOURS,
  BUNKER_RAID_DURATION_SECONDS,
  type BunkerFootprint,
  type BunkerRaidRewardReport,
  type BunkerRaidSnapshot,
  type BunkerState,
  createBunker,
  EMPTY_BASE_PART_INVENTORY,
  overallPlayerLevel,
  placeBasePart,
  playerLevelProgress,
  proposedBunkerFootprint,
  removeBasePart,
  resolveBunkerRaid,
  STARTER_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import {
  cellAt,
  createMine,
  DEFAULT_GEAR,
  NO_CONSUMABLES,
  type WorldDiff,
} from "@/sim/mine";
import { applyAchievementProgress } from "./achievements";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

export interface BunkerView {
  bunker: BunkerState | null;
  inventory: BasePartInventory;
  activeRaid: BunkerRaidSnapshot | null;
  player: {
    balance: number;
    trackXp: number;
    defenseXp: number;
    overallLevel: number;
    levelCap: number;
    progressXp: number;
    neededXp: number;
    nextLevelXp: number | null;
    beaconLimit: number;
  };
}

type BunkerOperationResult<T extends object = object> =
  | ({ ok: true; view: BunkerView } & T)
  | { ok: false; status: number; error: string };

function isBasePartId(value: string): value is BasePartId {
  return value === "wall-panel" || value === "door-panel";
}

function parseBasePartInventory(
  rows: Array<{ part_id: string; count: number }>,
) {
  const inventory = { ...EMPTY_BASE_PART_INVENTORY };
  for (const row of rows) {
    if (isBasePartId(row.part_id)) {
      inventory[row.part_id] = Math.max(0, Number(row.count) || 0);
    }
  }
  return inventory;
}

function parseBunkerState(
  row: {
    footprint: unknown;
    core: unknown;
    parts: unknown;
  } | null,
): BunkerState | null {
  if (!row) return null;
  const footprint = row.footprint as BunkerFootprint;
  const core = row.core as BunkerState["core"];
  const parts = Array.isArray(row.parts) ? row.parts : [];
  return {
    footprint,
    core,
    parts: parts.filter((part): part is BunkerState["parts"][number] => {
      if (!part || typeof part !== "object") return false;
      const candidate = part as Record<string, unknown>;
      return (
        typeof candidate.col === "number" &&
        typeof candidate.row === "number" &&
        typeof candidate.durability === "number" &&
        typeof candidate.partId === "string" &&
        isBasePartId(candidate.partId)
      );
    }),
  };
}

async function ensureStarterBaseParts(
  sql: Sql,
  playerId: string,
): Promise<BasePartInventory> {
  const rows = (await sql`
    SELECT part_id, count
    FROM player_base_parts
    WHERE player_id = ${playerId}`) as Array<{
    part_id: string;
    count: number;
  }>;
  if (rows.length > 0) return parseBasePartInventory(rows);
  for (const [partId, count] of Object.entries(STARTER_BASE_PART_INVENTORY)) {
    await sql`
      INSERT INTO player_base_parts (player_id, part_id, count)
      VALUES (${playerId}, ${partId}, ${count})`;
  }
  return { ...STARTER_BASE_PART_INVENTORY };
}

export async function loadBunkerView(
  sql: Sql,
  playerId: string,
): Promise<BunkerView> {
  const playerRows = (await sql`
    SELECT emeralds, track_xp, defense_xp
    FROM players
    WHERE id = ${playerId}`) as Array<{
    emeralds: number;
    track_xp: number;
    defense_xp: number;
  }>;
  const bunkerRows = (await sql`
    SELECT footprint, core, parts
    FROM bunkers
    WHERE player_id = ${playerId}`) as Array<{
    footprint: unknown;
    core: unknown;
    parts: unknown;
  }>;
  const raidRows = (await sql`
    SELECT snapshot
    FROM bunker_raids
    WHERE player_id = ${playerId}
      AND result IS NULL
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{ snapshot: unknown }>;
  const player = playerRows[0] ?? {
    emeralds: 0,
    track_xp: 0,
    defense_xp: 0,
  };
  const progress = playerLevelProgress(player.defense_xp);
  return {
    bunker: parseBunkerState(bunkerRows[0] ?? null),
    inventory: await ensureStarterBaseParts(sql, playerId),
    activeRaid:
      raidRows[0] && typeof raidRows[0].snapshot === "object"
        ? (raidRows[0].snapshot as BunkerRaidSnapshot)
        : null,
    player: {
      balance: player.emeralds,
      trackXp: player.track_xp,
      defenseXp: player.defense_xp,
      overallLevel: overallPlayerLevel(player.track_xp, player.defense_xp),
      levelCap: progress.cap,
      progressXp: progress.progressXp,
      neededXp: progress.neededXp,
      nextLevelXp: progress.nextLevelXp,
      beaconLimit: progress.beaconLimit,
    },
  };
}

function footprintIsCleared(
  seed: number,
  diff: WorldDiff,
  footprint: BunkerFootprint,
): boolean {
  if (footprint.row < 1) return false;
  const mine = createMine(seed, DEFAULT_GEAR, NO_CONSUMABLES, diff);
  for (let row = footprint.row; row < footprint.row + footprint.height; row++) {
    for (
      let col = footprint.col;
      col < footprint.col + footprint.width;
      col++
    ) {
      if (cellAt(mine, col, row)?.kind !== "empty") return false;
    }
  }
  return true;
}

export async function claimBunker(
  sql: Sql,
  playerId: string,
  centerCol: number,
  centerRow: number,
): Promise<BunkerOperationResult> {
  const existing = (await sql`
    SELECT player_id
    FROM bunkers
    WHERE player_id = ${playerId}`) as Array<{ player_id: string }>;
  if (existing.length > 0) {
    return { ok: false, status: 409, error: "bunker already claimed" };
  }
  const worlds = (await sql`
    SELECT seed, diff
    FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{
    seed: string | number;
    diff: unknown;
  }>;
  if (!worlds[0]) {
    return { ok: false, status: 409, error: "mine world is not ready" };
  }
  const footprint = proposedBunkerFootprint(centerCol, centerRow);
  const diff = Array.isArray(worlds[0].diff)
    ? (worlds[0].diff as WorldDiff)
    : [];
  if (!footprintIsCleared(Number(worlds[0].seed), diff, footprint)) {
    return { ok: false, status: 409, error: "clear the full 7x5 room first" };
  }
  const bunker = createBunker(footprint);
  await ensureStarterBaseParts(sql, playerId);
  await sql`
    INSERT INTO bunkers (player_id, footprint, core, parts)
    VALUES (
      ${playerId},
      ${JSON.stringify(bunker.footprint)}::jsonb,
      ${JSON.stringify(bunker.core)}::jsonb,
      ${JSON.stringify(bunker.parts)}::jsonb
    )`;
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function buyBasePart(
  sql: Sql,
  playerId: string,
  partId: BasePartId,
  quantity: number,
): Promise<BunkerOperationResult> {
  const count = Math.max(1, Math.min(99, Math.floor(quantity)));
  const price = BASE_PART_CATALOG[partId].price * count;
  const rows = (await sql`
    UPDATE players
    SET emeralds = emeralds - ${price}
    WHERE id = ${playerId}
      AND emeralds >= ${price}
    RETURNING id`) as Array<{ id: string }>;
  if (rows.length === 0) {
    return { ok: false, status: 409, error: "not enough vibes" };
  }
  await sql`
    INSERT INTO player_base_parts (player_id, part_id, count)
    VALUES (${playerId}, ${partId}, ${count})
    ON CONFLICT (player_id, part_id)
    DO UPDATE SET count = player_base_parts.count + ${count}`;
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function placeBunkerPart(
  sql: Sql,
  playerId: string,
  partId: BasePartId,
  col: number,
  row: number,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const placed = placeBasePart(view.bunker, view.inventory, partId, col, row);
  if (!placed.ok) {
    return { ok: false, status: 409, error: `cannot place: ${placed.reason}` };
  }
  await saveBunkerAndInventory(sql, playerId, placed.bunker, placed.inventory);
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function removeBunkerPart(
  sql: Sql,
  playerId: string,
  col: number,
  row: number,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const removed = removeBasePart(view.bunker, view.inventory, col, row);
  if (!removed.ok) {
    return {
      ok: false,
      status: 409,
      error: `cannot remove: ${removed.reason}`,
    };
  }
  await saveBunkerAndInventory(
    sql,
    playerId,
    removed.bunker,
    removed.inventory,
  );
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

async function saveBunkerAndInventory(
  sql: Sql,
  playerId: string,
  bunker: BunkerState,
  inventory: BasePartInventory,
): Promise<void> {
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(bunker.parts)}::jsonb,
        updated_at = now()
    WHERE player_id = ${playerId}`;
  for (const [partId, count] of Object.entries(inventory)) {
    await sql`
      INSERT INTO player_base_parts (player_id, part_id, count)
      VALUES (${playerId}, ${partId}, ${count})
      ON CONFLICT (player_id, part_id)
      DO UPDATE SET count = ${count}`;
  }
}

export async function startBunkerRaid(
  sql: Sql,
  playerId: string,
  tier: number,
): Promise<BunkerOperationResult<{ raid: BunkerRaidSnapshot }>> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  if (view.activeRaid)
    return { ok: false, status: 409, error: "raid already active" };
  const recentRows = (await sql`
    SELECT started_at
    FROM bunker_raids
    WHERE player_id = ${playerId}
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{ started_at: string | Date }>;
  const lastStartedAt = recentRows[0]?.started_at;
  if (lastStartedAt) {
    const cooldownMs = BUNKER_RAID_COOLDOWN_HOURS * 60 * 60 * 1000;
    const availableAt = new Date(lastStartedAt).getTime() + cooldownMs;
    const remainingMs = availableAt - Date.now();
    if (remainingMs > 0) {
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return {
        ok: false,
        status: 409,
        error: `raid cooldown active: ${remainingHours}h remaining`,
      };
    }
  }
  const raidId = `raid-${Date.now().toString(36)}`;
  const raid = resolveBunkerRaid(view.bunker, tier, raidId);
  await sql`
    INSERT INTO bunker_raids (
      player_id,
      raid_id,
      tier,
      snapshot,
      duration_seconds
    )
    VALUES (
      ${playerId},
      ${raid.raidId},
      ${raid.tier},
      ${JSON.stringify(raid)}::jsonb,
      ${BUNKER_RAID_DURATION_SECONDS}
    )`;
  return { ok: true, view: await loadBunkerView(sql, playerId), raid };
}

export async function finishBunkerRaid(
  sql: Sql,
  playerId: string,
): Promise<
  BunkerOperationResult<{
    raid: BunkerRaidSnapshot;
    reward: BunkerRaidRewardReport;
  }>
> {
  const rows = (await sql`
    SELECT raid_id, snapshot, started_at, duration_seconds
    FROM bunker_raids
    WHERE player_id = ${playerId}
      AND result IS NULL
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{
    raid_id: string;
    snapshot: unknown;
    started_at: string;
    duration_seconds: number;
  }>;
  const row = rows[0];
  if (!row || typeof row.snapshot !== "object") {
    return { ok: false, status: 409, error: "no active raid" };
  }
  const raid = row.snapshot as BunkerRaidSnapshot;
  const elapsed = Date.now() - new Date(row.started_at).getTime();
  if (elapsed < row.duration_seconds * 1000) {
    return { ok: false, status: 409, error: "raid still in progress" };
  }
  const rewarded = (await sql`
    UPDATE bunker_raids
    SET result = ${JSON.stringify(raid)}::jsonb,
        rewarded_at = now()
    WHERE player_id = ${playerId}
      AND raid_id = ${row.raid_id}
      AND result IS NULL
    RETURNING raid_id`) as Array<{ raid_id: string }>;
  if (rewarded.length === 0) {
    return { ok: false, status: 409, error: "raid already finished" };
  }
  const beforeRows = (await sql`
    SELECT track_xp, defense_xp
    FROM players
    WHERE id = ${playerId}`) as Array<{
    track_xp: number;
    defense_xp: number;
  }>;
  const before = beforeRows[0] ?? { track_xp: 0, defense_xp: 0 };
  const beforeProgress = playerLevelProgress(before.defense_xp);
  let defenseXpAfter = before.defense_xp;
  let stampAwarded = false;
  if (raid.survived) {
    const firstDefenseRows = (await sql`
      SELECT achievement_id
      FROM player_achievements
      WHERE player_id = ${playerId}
        AND achievement_id = 'survival-first-defense'
      LIMIT 1`) as Array<{ achievement_id: string }>;
    const firstDefenseAlreadyUnlocked = firstDefenseRows.length > 0;
    const playerRows = (await sql`
      UPDATE players
      SET emeralds = emeralds + ${raid.reward.vibes},
          defense_xp = defense_xp + ${raid.reward.defenseXp}
      WHERE id = ${playerId}
      RETURNING defense_xp`) as Array<{ defense_xp: number }>;
    defenseXpAfter = playerRows[0]?.defense_xp ?? defenseXpAfter;
    try {
      await applyAchievementProgress(sql, playerId, {
        bunkerRaidsSurvived: 1,
      });
      stampAwarded = !firstDefenseAlreadyUnlocked;
    } catch {
      stampAwarded = false;
    }
  }
  const afterProgress = playerLevelProgress(defenseXpAfter);
  return {
    ok: true,
    view: await loadBunkerView(sql, playerId),
    raid,
    reward: {
      survived: raid.survived,
      vibesGained: raid.reward.vibes,
      xpGained: raid.reward.defenseXp,
      defenseXpBefore: before.defense_xp,
      defenseXpAfter,
      levelBefore: beforeProgress.level,
      levelAfter: afterProgress.level,
      leveledUp: afterProgress.level > beforeProgress.level,
      beaconLimitBefore: beforeProgress.beaconLimit,
      beaconLimitAfter: afterProgress.beaconLimit,
      stampAwarded,
    },
  };
}
