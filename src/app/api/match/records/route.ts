import { db, storageConfigured } from "@/server/db";
import { loadMatchRecordSummary } from "@/server/match-records";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

/** The player's verified arena record (B4): totals plus recent fights. */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const sql = await db();
  const playerId = await getOrCreatePlayerId();
  return Response.json(await loadMatchRecordSummary(sql, playerId));
}
