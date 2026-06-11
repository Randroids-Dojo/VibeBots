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
  // Atomic conditional spend: no balance check/race outside the UPDATE.
  const spent = (await sql`
    UPDATE players
    SET emeralds = emeralds - ${part.priceEmeralds}
    WHERE id = ${playerId} AND emeralds >= ${part.priceEmeralds}
    RETURNING emeralds`) as Array<{ emeralds: number }>;
  if (spent.length === 0) {
    return Response.json({ error: "not enough emeralds" }, { status: 409 });
  }
  await sql`
    INSERT INTO player_parts (player_id, part_id, count)
    VALUES (${playerId}, ${part.id}, 1)
    ON CONFLICT (player_id, part_id) DO UPDATE SET count = player_parts.count + 1`;
  return Response.json({
    bought: part.id,
    emeralds: spent[0].emeralds,
  });
}
