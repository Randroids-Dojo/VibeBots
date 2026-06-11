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
    SELECT pickaxe_level, lamp_level, cargo_level, lantern_level, emeralds
    FROM players WHERE id = ${playerId}`) as Array<{
    pickaxe_level: number;
    lamp_level: number;
    cargo_level: number;
    lantern_level: number;
    emeralds: number;
  }>;
  const row = rows[0];
  return Response.json({
    gear: {
      pickaxe: row?.pickaxe_level ?? 1,
      lamp: row?.lamp_level ?? 1,
      cargo: row?.cargo_level ?? 1,
      lantern: row?.lantern_level ?? 1,
    },
    balance: row?.emeralds ?? 0,
  });
}
