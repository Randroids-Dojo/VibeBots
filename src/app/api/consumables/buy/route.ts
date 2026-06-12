import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { CONSUMABLE_PRICES } from "@/sim/mine";

export const runtime = "nodejs";

const bodySchema = z.object({
  item: z.enum(["dynamite", "rope", "ladder", "plank"]),
});

/**
 * Buys one consumable (REQ-016). One conditional statement: the spend
 * and the grant land together, and the balance guard prevents negative
 * wallets under concurrency.
 */
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
  const item = parsed.data.item;
  const price = CONSUMABLE_PRICES[item];

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const rows = (await (item === "dynamite"
    ? sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, dynamite_count = dynamite_count + 1
        WHERE id = ${playerId} AND emeralds >= ${price}
        RETURNING emeralds, dynamite_count AS count`
    : item === "rope"
      ? sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, rope_count = rope_count + 1
        WHERE id = ${playerId} AND emeralds >= ${price}
        RETURNING emeralds, rope_count AS count`
      : item === "ladder"
        ? sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, ladder_count = ladder_count + 1
        WHERE id = ${playerId} AND emeralds >= ${price}
        RETURNING emeralds, ladder_count AS count`
        : sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, plank_count = plank_count + 1
        WHERE id = ${playerId} AND emeralds >= ${price}
        RETURNING emeralds, plank_count AS count`)) as Array<{
    emeralds: number;
    count: number;
  }>;
  if (rows.length === 0) {
    return Response.json({ error: "not enough credits" }, { status: 409 });
  }
  return Response.json({
    item,
    count: rows[0].count,
    balance: rows[0].emeralds,
  });
}
