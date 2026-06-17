import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

const bodySchema = z.object({
  cost: z.number().int().min(1).max(99),
});

/** Spend vibes for a surface return to the village center. */
export async function POST(request: Request): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const rows = (await sql`
    UPDATE players
    SET emeralds = emeralds - ${parsed.data.cost}
    WHERE id = ${playerId} AND emeralds >= ${parsed.data.cost}
    RETURNING emeralds`) as Array<{ emeralds: number }>;
  if (rows.length === 0) {
    return Response.json({ error: "not enough vibes" }, { status: 409 });
  }
  return Response.json({ balance: rows[0].emeralds });
}
