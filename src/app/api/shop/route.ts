import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { PART_CATALOG } from "@/sim/parts";

export const runtime = "nodejs";

/** The shop: purchasable parts, the player's balance, and inventory. */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const players = (await sql`
    SELECT emeralds FROM players WHERE id = ${playerId}`) as Array<{
    emeralds: number;
  }>;
  const inventory = (await sql`
    SELECT part_id, count FROM player_parts WHERE player_id = ${playerId}`) as Array<{
    part_id: string;
    count: number;
  }>;
  const catalog = Object.values(PART_CATALOG)
    .filter((part) => part.priceEmeralds > 0)
    .map((part) => ({
      id: part.id,
      name: part.name,
      category: part.category,
      priceEmeralds: part.priceEmeralds,
    }));
  return Response.json({
    emeralds: players[0]?.emeralds ?? 0,
    inventory,
    catalog,
  });
}
