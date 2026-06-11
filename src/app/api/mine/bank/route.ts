import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { MAX_TRIP_MOVES, replayTrip } from "@/sim/mine";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  seed: z.number().int().min(0).max(4294967295),
  moves: z
    .array(z.enum(["down", "up", "left", "right"]))
    .min(1)
    .max(MAX_TRIP_MOVES),
});

/**
 * Cash out a mining session. The mine is a pure function of (seed,
 * moves), so the server replays the submitted log and credits exactly
 * what an honest client banked; each seed is creditable once per player
 * (the unique key), so a log cannot be resubmitted.
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

  const trip = replayTrip(parsed.data.seed, parsed.data.moves);
  if (trip.bankedEmeralds === 0 && trip.bankedParts.length === 0) {
    return Response.json(
      { error: "nothing banked in this run" },
      { status: 422 },
    );
  }

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const inserted = (await sql`
    INSERT INTO mine_runs (player_id, seed, banked_emeralds, banked_parts)
    VALUES (${playerId}, ${parsed.data.seed}, ${trip.bankedEmeralds}, ${JSON.stringify(trip.bankedParts)}::jsonb)
    ON CONFLICT (player_id, seed) DO NOTHING
    RETURNING seed`) as Array<{ seed: string }>;
  if (inserted.length === 0) {
    return Response.json(
      { error: "this run was already cashed out" },
      { status: 409 },
    );
  }

  await sql`
    UPDATE players SET emeralds = emeralds + ${trip.bankedEmeralds} WHERE id = ${playerId}`;
  for (const partId of trip.bankedParts) {
    await sql`
      INSERT INTO player_parts (player_id, part_id, count)
      VALUES (${playerId}, ${partId}, 1)
      ON CONFLICT (player_id, part_id) DO UPDATE SET count = player_parts.count + 1`;
  }

  const balance = (await sql`
    SELECT emeralds FROM players WHERE id = ${playerId}`) as Array<{
    emeralds: number;
  }>;
  return Response.json({
    credited: { emeralds: trip.bankedEmeralds, parts: trip.bankedParts },
    balance: balance[0].emeralds,
  });
}
