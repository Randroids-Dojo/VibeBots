import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { PART_CATALOG } from "@/sim/parts";

export const runtime = "nodejs";

const bodySchema = z.object({ partId: z.string().min(1) });

/** Converts banked emeralds into a robot part (REQ-008). */
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
  const part = PART_CATALOG[parsed.data.partId];
  if (!part || part.priceEmeralds <= 0) {
    return Response.json({ error: "part not sold here" }, { status: 422 });
  }

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  // One statement = atomic on the neon HTTP driver: the spend and the
  // inventory grant land together, or not at all (and the conditional
  // UPDATE prevents negative balances under concurrency).
  const rows = (await sql`
    WITH spent AS (
      UPDATE players
      SET emeralds = emeralds - ${part.priceEmeralds}
      WHERE id = ${playerId} AND emeralds >= ${part.priceEmeralds}
      RETURNING emeralds
    ), granted AS (
      INSERT INTO player_parts (player_id, part_id, count)
      SELECT ${playerId}, ${part.id}, 1 FROM spent
      ON CONFLICT (player_id, part_id)
      DO UPDATE SET count = player_parts.count + 1
    )
    SELECT emeralds FROM spent`) as Array<{ emeralds: number }>;
  if (rows.length === 0) {
    return Response.json({ error: "not enough emeralds" }, { status: 409 });
  }
  return Response.json({
    bought: part.id,
    emeralds: rows[0].emeralds,
  });
}
