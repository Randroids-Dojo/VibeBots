import {
  type AchievementSnapshot,
  type AchievementStats,
  achievementIdsUnlockedBy,
  buildAchievementViews,
  mergeAchievementStats,
  normalizeAchievementStats,
  type PlayerAchievementView,
} from "@/lib/achievements";
import type { BunkerFootprint } from "@/sim/bunker";
import { bunkerSpawnPocketCells } from "@/sim/bunker-blocks";
import { countActiveBiomePortalsInDiff, type WorldDiff } from "@/sim/mine";
import type { db } from "./db";
import { matchAchievementCounters } from "./match-records";

type Sql = Awaited<ReturnType<typeof db>>;

/** A stored footprint jsonb, validated to the shape the pocket helper
 * needs. Returns null when a row cannot prove its footprint. */
function footprintFromUnknown(value: unknown): BunkerFootprint | null {
  if (!value || typeof value !== "object") return null;
  const fp = value as Record<string, unknown>;
  if (
    typeof fp.col !== "number" ||
    typeof fp.row !== "number" ||
    typeof fp.width !== "number" ||
    typeof fp.height !== "number"
  ) {
    return null;
  }
  return { col: fp.col, row: fp.row, width: fp.width, height: fp.height };
}

/**
 * Player-dug bunker cells for the Groundbreaker metric (F-133): the
 * durable <code>bunkers.dug</code> set includes the authored pre-mined
 * spawn pocket, which is not player behavior. Count only cells the
 * player actually excavated by excluding the footprint's own spawn
 * pocket (derived deterministically, never a magic size), so a fresh
 * claim with no dig reports zero and the first real dig reports one. A
 * row that cannot prove its footprint keeps the raw count rather than
 * subtracting a pocket it cannot locate.
 */
function playerDugCellCount(dug: unknown, footprint: unknown): number {
  if (!Array.isArray(dug) || dug.length === 0) return 0;
  const fp = footprintFromUnknown(footprint);
  if (!fp) return dug.length;
  const pocket = new Set(
    bunkerSpawnPocketCells(fp).map(
      (cell) => `${cell.col},${cell.row},${cell.depth}`,
    ),
  );
  let count = 0;
  for (const cell of dug) {
    if (!cell || typeof cell !== "object") continue;
    const c = cell as Record<string, unknown>;
    if (
      typeof c.col !== "number" ||
      typeof c.row !== "number" ||
      typeof c.depth !== "number"
    ) {
      continue;
    }
    if (!pocket.has(`${c.col},${c.row},${c.depth}`)) count++;
  }
  return count;
}

interface PlayerAchievementRow {
  achievement_id: string;
  unlocked_at: string | Date;
}

interface PlayerAchievementStatsRow {
  stats: unknown;
}

interface AchievementProfileRow {
  deepest_depth: number;
  emeralds: number;
  pickaxe_level: number;
  lamp_level: number;
  cargo_level: number;
  lantern_level: number;
  blast_level: number;
  warpcoil_level: number;
  elevator_depth: number;
  elevator_speed_level: number;
  parts_owned: number;
  has_maxed_design: boolean;
  has_painted_design: boolean;
  bunker_dug: unknown;
  bunker_footprint: unknown;
  mine_diff: unknown;
}

function statsFromUnknown(value: unknown): AchievementStats {
  if (!value || typeof value !== "object") return normalizeAchievementStats({});
  const partial = value as Partial<Record<keyof AchievementStats, unknown>>;
  const numeric: Partial<AchievementStats> = {};
  for (const key of Object.keys(normalizeAchievementStats({})) as Array<
    keyof AchievementStats
  >) {
    const valueForKey = partial[key];
    if (typeof valueForKey === "number") numeric[key] = valueForKey;
  }
  return normalizeAchievementStats(numeric);
}

async function readAchievementStats(
  sql: Sql,
  playerId: string,
): Promise<AchievementStats> {
  const rows = (await sql`
    SELECT stats FROM player_achievement_stats
    WHERE player_id = ${playerId}`) as Array<PlayerAchievementStatsRow>;
  return statsFromUnknown(rows[0]?.stats);
}

async function writeAchievementStats(
  sql: Sql,
  playerId: string,
  stats: AchievementStats,
): Promise<void> {
  await sql`
    INSERT INTO player_achievement_stats (player_id, stats, updated_at)
    VALUES (${playerId}, ${JSON.stringify(stats)}::jsonb, now())
    ON CONFLICT (player_id)
    DO UPDATE SET stats = EXCLUDED.stats, updated_at = now()`;
}

async function achievementSnapshot(
  sql: Sql,
  playerId: string,
  stats: AchievementStats,
): Promise<AchievementSnapshot> {
  const rows = (await sql`
    SELECT p.deepest_depth,
           p.emeralds,
           p.pickaxe_level,
           p.lamp_level,
           p.cargo_level,
           p.lantern_level,
           p.blast_level,
           p.warpcoil_level,
           p.elevator_depth,
           p.elevator_speed_level,
           COALESCE((
             SELECT SUM(pp.count)::int
             FROM player_parts pp
             WHERE pp.player_id = p.id
           ), 0) AS parts_owned,
           EXISTS (
             SELECT 1
             FROM bot_designs bd
             WHERE bd.player_id = p.id
               AND bd.design ? 'paint'
           ) AS has_painted_design,
           bk.dug AS bunker_dug,
           bk.footprint AS bunker_footprint,
           mw.diff AS mine_diff
    FROM players p
    LEFT JOIN mine_worlds mw ON mw.player_id = p.id
    LEFT JOIN bunkers bk ON bk.player_id = p.id
    WHERE p.id = ${playerId}`) as Array<AchievementProfileRow>;
  const row = rows[0];
  const worldDiff = Array.isArray(row?.mine_diff)
    ? (row.mine_diff as WorldDiff)
    : [];
  const matchCounters = await matchAchievementCounters(sql, playerId);
  const retroStats = normalizeAchievementStats({
    ...stats,
    matchWins: Math.max(stats.matchWins, matchCounters.matchWins),
    sawMatchWins: Math.max(stats.sawMatchWins, matchCounters.sawMatchWins),
    chassisFought: Math.max(stats.chassisFought, matchCounters.chassisFought),
    // Custom Job (G5) derives from the saved design itself, so it backfills
    // for any profile that painted a bot before the stamp existed.
    designsPainted: Math.max(
      stats.designsPainted,
      row?.has_painted_design ? 1 : 0,
    ),
    // Backfill from the durable record: bunkers.dug proves every
    // player-excavated cell even for profiles that dug before the stamp.
    // The authored spawn pocket is excluded so a fresh claim is not
    // counted as digging (F-133). Math.max keeps any stamp already
    // earned, so an alpha profile never loses Groundbreaker.
    bunkerCellsDug: Math.max(
      stats.bunkerCellsDug,
      playerDugCellCount(row?.bunker_dug, row?.bunker_footprint),
    ),
    sales: Math.max(
      stats.sales,
      row && (row.emeralds > 0 || row.parts_owned > 0) ? 1 : 0,
    ),
    partsBanked: Math.max(stats.partsBanked, row?.parts_owned ?? 0),
  });
  return {
    deepestDepth: row?.deepest_depth ?? 0,
    activeBiomePortals: countActiveBiomePortalsInDiff(worldDiff),
    pickaxeLevel: row?.pickaxe_level ?? 1,
    batteryLevel: row?.lamp_level ?? 1,
    cargoLevel: row?.cargo_level ?? 1,
    lanternLevel: row?.lantern_level ?? 1,
    blastLevel: row?.blast_level ?? 1,
    warpcoilLevel: row?.warpcoil_level ?? 1,
    elevatorDepth: row?.elevator_depth ?? 0,
    elevatorSpeedLevel: row?.elevator_speed_level ?? 1,
    stats: retroStats,
  };
}

async function unlockedMap(
  sql: Sql,
  playerId: string,
): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT achievement_id, unlocked_at
    FROM player_achievements
    WHERE player_id = ${playerId}`) as Array<PlayerAchievementRow>;
  return new Map(
    rows.map((row) => [
      row.achievement_id,
      row.unlocked_at instanceof Date
        ? row.unlocked_at.toISOString()
        : String(row.unlocked_at),
    ]),
  );
}

/** Returns the ids whose rows were actually inserted by this call. */
async function unlockAchievements(
  sql: Sql,
  playerId: string,
  ids: readonly string[],
): Promise<string[]> {
  const newlyUnlocked: string[] = [];
  for (const id of ids) {
    const inserted = (await sql`
      INSERT INTO player_achievements (player_id, achievement_id, metadata)
      VALUES (${playerId}, ${id}, '{}'::jsonb)
      ON CONFLICT (player_id, achievement_id) DO NOTHING
      RETURNING achievement_id`) as Array<{ achievement_id: string }>;
    if (inserted.length > 0) newlyUnlocked.push(id);
  }
  return newlyUnlocked;
}

export interface PlayerAchievementRefresh {
  achievements: PlayerAchievementView[];
  /** Ids first unlocked by THIS refresh, in catalog order (stamp alerts). */
  newlyUnlocked: string[];
}

export async function refreshPlayerAchievements(
  sql: Sql,
  playerId: string,
): Promise<PlayerAchievementRefresh> {
  const stats = await readAchievementStats(sql, playerId);
  const snapshot = await achievementSnapshot(sql, playerId, stats);
  const newlyUnlocked = await unlockAchievements(
    sql,
    playerId,
    achievementIdsUnlockedBy(snapshot),
  );
  return {
    achievements: buildAchievementViews(
      snapshot,
      await unlockedMap(sql, playerId),
    ),
    newlyUnlocked,
  };
}

export async function applyAchievementProgress(
  sql: Sql,
  playerId: string,
  patch: Partial<AchievementStats>,
): Promise<string[]> {
  const stats = mergeAchievementStats(
    await readAchievementStats(sql, playerId),
    patch,
  );
  await writeAchievementStats(sql, playerId, stats);
  return (await refreshPlayerAchievements(sql, playerId)).newlyUnlocked;
}
