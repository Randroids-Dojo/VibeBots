import { z } from "zod";
import { applyAchievementProgress } from "@/server/achievements";
import { db, storageConfigured } from "@/server/db";
import { getMinePlayerProfile, getOrCreatePlayerId } from "@/server/player";
import { playerLevelProgress } from "@/sim/bunker";
import {
  CONSUMABLE_PRICES,
  countPlacedBeaconsInDiff,
  type WorldDiff,
} from "@/sim/mine";

export const runtime = "nodejs";

const bodySchema = z.object({
  item: z.enum(["dynamite", "rope", "ladder", "plank", "beacon"]),
  quantity: z.number().int().min(1).max(99).optional().default(1),
});

function beaconLimitResponse(
  level: number,
  beaconLimit: number,
  ownedTotal: number,
): Response {
  return Response.json(
    {
      error: `beacon limit reached: level ${level} allows ${beaconLimit} total`,
      code: "beacon_limit",
      level,
      beaconLimit,
      ownedTotal,
    },
    { status: 409 },
  );
}

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
  let beaconSlotsAvailable = 0;
  let beaconLimitState: { level: number; beaconLimit: number } | null = null;

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
    const progress = playerLevelProgress(profile?.defense_xp ?? 0);
    const owned = (profile?.beacon_count ?? 0) + placed;
    beaconSlotsAvailable = Math.max(0, progress.beaconLimit - placed);
    beaconLimitState = {
      level: progress.level,
      beaconLimit: progress.beaconLimit,
    };
    if (owned + quantity > progress.beaconLimit) {
      return beaconLimitResponse(progress.level, progress.beaconLimit, owned);
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
    if (
      item === "beacon" &&
      beaconLimitState &&
      (profile?.emeralds ?? 0) >= price
    ) {
      return beaconLimitResponse(
        beaconLimitState.level,
        beaconLimitState.beaconLimit,
        beaconLimitState.beaconLimit,
      );
    }
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
