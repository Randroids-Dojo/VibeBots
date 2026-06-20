import { db, storageConfigured } from "@/server/db";
import {
  getMinePlayerProfile,
  getOrCreatePlayerId,
  mineConsumablesFromProfile,
  mineGearFromProfile,
} from "@/server/player";
import { playerLevelProgress } from "@/sim/bunker";

export const runtime = "nodejs";

/** The player's persistent mining gear levels (REQ-013). */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const row = await getMinePlayerProfile(sql, playerId);
  const progress = playerLevelProgress(row?.defense_xp ?? 0);
  return Response.json({
    gear: row
      ? mineGearFromProfile(row)
      : {
          pickaxe: 1,
          battery: 1,
          cargo: 1,
          lantern: 1,
          elevator: 0,
          warpcoil: 1,
          blast: 1,
          elevatorSpeed: 1,
          fall: 1,
        },
    consumables: row
      ? mineConsumablesFromProfile(row)
      : { dynamite: 0, rope: 0, ladder: 0, plank: 0, beacon: 0 },
    balance: row?.emeralds ?? 0,
    playerLevel: progress.level,
    defenseXp: progress.currentXp,
    deepestDepth: row?.deepest_depth ?? 0,
  });
}
