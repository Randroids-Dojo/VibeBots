import { accountJson, storageUnavailable } from "@/server/account-response";
import { db, storageConfigured } from "@/server/db";
import { currentPlayerId } from "@/server/player";

export const runtime = "nodejs";

/**
 * Freshness probe for multi-device save sync (REQ-042): the client compares
 * the returned seed and tripCount against the world its in-flight trip runs
 * on to learn another device advanced the save. One primary-key SELECT; the
 * no-store header keeps every probe live.
 */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  const playerId = await currentPlayerId();
  if (!playerId) return accountJson({ world: null });
  const sql = await db();
  const rows = (await sql`
    SELECT seed, trip_count
    FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{
    // Neon surfaces the bigint seed column as a string.
    seed: number | string;
    trip_count: number;
  }>;
  const row = rows[0];
  return accountJson({
    world: row ? { seed: Number(row.seed), tripCount: row.trip_count } : null,
  });
}
