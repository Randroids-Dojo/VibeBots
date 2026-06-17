import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

/** The player's persistent mining gear levels (REQ-013). */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const rows = (await sql`
    SELECT pickaxe_level, lamp_level, cargo_level, lantern_level,
           warpcoil_level, elevator_depth, blast_level, elevator_speed_level,
           fall_level, dynamite_count, rope_count, ladder_count, plank_count,
           beacon_count, emeralds
    FROM players WHERE id = ${playerId}`) as Array<{
    pickaxe_level: number;
    lamp_level: number;
    cargo_level: number;
    lantern_level: number;
    dynamite_count: number;
    rope_count: number;
    ladder_count: number;
    plank_count: number;
    beacon_count: number;
    elevator_depth: number;
    warpcoil_level: number;
    blast_level: number;
    elevator_speed_level: number;
    fall_level: number;
    emeralds: number;
  }>;
  const row = rows[0];
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
    consumables: {
      dynamite: row?.dynamite_count ?? 0,
      rope: row?.rope_count ?? 0,
      ladder: row?.ladder_count ?? 0,
      plank: row?.plank_count ?? 0,
      beacon: row?.beacon_count ?? 0,
    },
    balance: row?.emeralds ?? 0,
  });
}
