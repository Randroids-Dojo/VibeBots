import { z } from "zod";
import { applyAchievementProgress } from "@/server/achievements";
import { db, storageConfigured } from "@/server/db";
import { getMinePlayerProfile, getOrCreatePlayerId } from "@/server/player";
import {
  CONSUMABLE_PRICES,
  countPlacedBeaconsInDiff,
  MAX_BEACONS,
  type WorldDiff,
} from "@/sim/mine";

export const runtime = "nodejs";

const bodySchema = z.object({
  item: z.enum(["dynamite", "rope", "ladder", "plank", "beacon"]),
  quantity: z.number().int().min(1).max(99).optional().default(1),
});

/**
 * Buys consumables (REQ-016). One conditional statement: the spend
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
  const quantity = parsed.data.quantity;
  const price = CONSUMABLE_PRICES[item] * quantity;
  let beaconSlotsAvailable = MAX_BEACONS;

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const profile = await getMinePlayerProfile(sql, playerId);
  if (item === "beacon") {
    const worlds = (await sql`
      SELECT diff FROM mine_worlds
      WHERE player_id = ${playerId}`) as Array<{ diff: unknown }>;
    const placed = countPlacedBeaconsInDiff(
      (worlds[0]?.diff ?? []) as WorldDiff,
    );
    const owned = (profile?.beacon_count ?? 0) + placed;
    beaconSlotsAvailable = Math.max(0, MAX_BEACONS - placed);
    if (owned + quantity > MAX_BEACONS) {
      return Response.json(
        { error: `beacon limit ${MAX_BEACONS} total` },
        { status: 409 },
      );
    }
  }
  const rows = (await (item === "dynamite"
    ? sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, dynamite_count = dynamite_count + ${quantity}
        WHERE id = ${playerId} AND emeralds >= ${price}
        RETURNING emeralds, dynamite_count AS count`
    : item === "rope"
      ? sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, rope_count = rope_count + ${quantity}
        WHERE id = ${playerId} AND emeralds >= ${price}
        RETURNING emeralds, rope_count AS count`
      : item === "ladder"
        ? sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, ladder_count = ladder_count + ${quantity}
        WHERE id = ${playerId} AND emeralds >= ${price}
        RETURNING emeralds, ladder_count AS count`
        : item === "plank"
          ? sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, plank_count = plank_count + ${quantity}
        WHERE id = ${playerId} AND emeralds >= ${price}
        RETURNING emeralds, plank_count AS count`
          : sql`
        UPDATE players
        SET emeralds = emeralds - ${price}, beacon_count = beacon_count + ${quantity}
        WHERE id = ${playerId} AND emeralds >= ${price}
          AND beacon_count + ${quantity} <= ${beaconSlotsAvailable}
        RETURNING emeralds, beacon_count AS count`)) as Array<{
    emeralds: number;
    count: number;
  }>;
  if (rows.length === 0) {
    return Response.json({ error: "not enough vibes" }, { status: 409 });
  }
  try {
    await applyAchievementProgress(sql, playerId, { depotPurchases: quantity });
  } catch {
    // Stamps are cosmetic and must never block a successful depot purchase.
  }
  return Response.json({
    item,
    quantity,
    count: rows[0].count,
    balance: rows[0].emeralds,
  });
}
