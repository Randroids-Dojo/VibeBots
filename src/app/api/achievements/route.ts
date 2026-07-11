import {
  ACHIEVEMENT_DEFINITIONS,
  buildAchievementViews,
  DEFAULT_ACHIEVEMENT_STATS,
} from "@/lib/achievements";
import { refreshPlayerAchievements } from "@/server/achievements";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    const achievements = buildAchievementViews(
      {
        deepestDepth: 0,
        activeBiomePortals: 0,
        pickaxeLevel: 1,
        batteryLevel: 1,
        cargoLevel: 1,
        lanternLevel: 1,
        blastLevel: 1,
        warpcoilLevel: 1,
        elevatorDepth: 0,
        elevatorSpeedLevel: 1,
        stats: DEFAULT_ACHIEVEMENT_STATS,
      },
      new Map(),
    );
    return Response.json({
      offline: true,
      achievements,
      total: ACHIEVEMENT_DEFINITIONS.length,
      collected: 0,
    });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const { achievements } = await refreshPlayerAchievements(sql, playerId);
  return Response.json({
    offline: false,
    achievements,
    total: ACHIEVEMENT_DEFINITIONS.length,
    collected: achievements.filter((achievement) => achievement.unlocked)
      .length,
  });
}
