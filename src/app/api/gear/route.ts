import { db, storageConfigured } from "@/server/db";
import {
  getMinePlayerProfile,
  getOrCreatePlayerId,
  mineConsumablesFromProfile,
} from "@/server/player";

export const runtime = "nodejs";

/** The player's persistent mining gear levels (REQ-013). */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const row = await getMinePlayerProfile(sql, playerId);
  return Response.json({
    gear: {
      pickaxe: row?.pickaxe_level ?? 1,
      battery: row?.lamp_level ?? 1,
      cargo: row?.cargo_level ?? 1,
      lantern: row?.lantern_level ?? 1,
      elevator: row?.elevator_depth ?? 0,
      warpcoil: row?.warpcoil_level ?? 1,
      blast: row?.blast_level ?? 1,
      elevatorSpeed: row?.elevator_speed_level ?? 1,
      fall: row?.fall_level ?? 1,
    },
    consumables: row
      ? mineConsumablesFromProfile(row)
      : { dynamite: 0, rope: 0, ladder: 0, plank: 0, beacon: 0 },
    balance: row?.emeralds ?? 0,
  });
}
