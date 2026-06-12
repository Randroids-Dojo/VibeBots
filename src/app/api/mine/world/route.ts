import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

/**
 * The player's persistent claim (REQ-026): seed, world diff, and the
 * trip counter. Created on first visit with a server-issued seed (which
 * also closes the client-seed search exploit from F-011 for worlds).
 */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const seed = Math.floor(Math.random() * 4294967296);
  const rows = (await sql`
    INSERT INTO mine_worlds (player_id, seed)
    VALUES (${playerId}, ${seed})
    ON CONFLICT (player_id) DO UPDATE SET player_id = mine_worlds.player_id
    RETURNING seed, diff, trip_count`) as Array<{
    seed: string | number;
    diff: unknown;
    trip_count: number;
  }>;
  return Response.json({
    seed: Number(rows[0].seed),
    diff: rows[0].diff ?? [],
    tripIndex: rows[0].trip_count,
  });
}
