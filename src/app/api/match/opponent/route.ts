import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { botDesignSchema, validateDesign } from "@/sim/design";

export const runtime = "nodejs";

/**
 * A rival's saved design for an online vibe match (B5, REQ-010): the
 * most recently updated valid design from another player. Deterministic
 * ordering (no SQL randomness) so the same call is reproducible; the
 * rotation comes from players saving new designs. Falls back to 404
 * when no rival design exists yet; the client then offers stock bots.
 */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const sql = await db();
  const playerId = await getOrCreatePlayerId();
  const rows = (await sql`
    SELECT bd.design, bd.updated_at
    FROM bot_designs bd
    WHERE bd.player_id <> ${playerId}
    ORDER BY bd.updated_at DESC
    LIMIT 12`) as Array<{ design: unknown; updated_at: string }>;
  for (const row of rows) {
    const parsed = botDesignSchema.safeParse(row.design);
    if (!parsed.success) continue;
    if (!validateDesign(parsed.data).ok) continue;
    return Response.json({ design: parsed.data });
  }
  return Response.json({ error: "no rival designs yet" }, { status: 404 });
}
