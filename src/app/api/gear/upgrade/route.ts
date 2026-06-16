import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { gearTrackDef, type MineGear, maxGearLevel } from "@/sim/mine";

export const runtime = "nodejs";

const bodySchema = z.object({
  track: z.enum(["pickaxe", "lamp", "cargo", "lantern", "warpcoil", "blast"]),
});

/**
 * Buys the next level of a gear track (REQ-013). The spend and the
 * level bump land in one conditional statement: the level guard makes
 * concurrent upgrades retry instead of double-charging, and the balance
 * guard prevents negative wallets.
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
  const track = parsed.data.track as keyof MineGear;

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const current = (await sql`
    SELECT pickaxe_level, lamp_level, cargo_level, lantern_level,
           warpcoil_level, blast_level
    FROM players WHERE id = ${playerId}`) as Array<Record<string, number>>;
  const level = current[0]?.[`${track}_level`] ?? 1;
  if (level >= maxGearLevel(track)) {
    return Response.json({ error: "already at max level" }, { status: 422 });
  }
  const price = gearTrackDef(track).prices[level - 1];

  // The column is selected by a whitelisted enum branch (no identifier
  // interpolation on the neon template tag).
  const upgraded = await (() => {
    switch (track) {
      case "pickaxe":
        return sql`
          UPDATE players
          SET emeralds = emeralds - ${price}, pickaxe_level = ${level + 1}
          WHERE id = ${playerId} AND emeralds >= ${price} AND pickaxe_level = ${level}
          RETURNING emeralds, pickaxe_level AS level`;
      case "lamp":
        return sql`
          UPDATE players
          SET emeralds = emeralds - ${price}, lamp_level = ${level + 1}
          WHERE id = ${playerId} AND emeralds >= ${price} AND lamp_level = ${level}
          RETURNING emeralds, lamp_level AS level`;
      case "cargo":
        return sql`
          UPDATE players
          SET emeralds = emeralds - ${price}, cargo_level = ${level + 1}
          WHERE id = ${playerId} AND emeralds >= ${price} AND cargo_level = ${level}
          RETURNING emeralds, cargo_level AS level`;
      case "lantern":
        return sql`
          UPDATE players
          SET emeralds = emeralds - ${price}, lantern_level = ${level + 1}
          WHERE id = ${playerId} AND emeralds >= ${price} AND lantern_level = ${level}
          RETURNING emeralds, lantern_level AS level`;
      case "warpcoil":
        return sql`
          UPDATE players
          SET emeralds = emeralds - ${price}, warpcoil_level = ${level + 1}
          WHERE id = ${playerId} AND emeralds >= ${price} AND warpcoil_level = ${level}
          RETURNING emeralds, warpcoil_level AS level`;
      case "blast":
        return sql`
          UPDATE players
          SET emeralds = emeralds - ${price}, blast_level = ${level + 1}
          WHERE id = ${playerId} AND emeralds >= ${price} AND blast_level = ${level}
          RETURNING emeralds, blast_level AS level`;
    }
  })();
  const rows = upgraded as Array<{ emeralds: number; level: number }>;
  if (rows.length === 0) {
    return Response.json(
      { error: "not enough vibes (or already upgraded)" },
      { status: 409 },
    );
  }
  return Response.json({
    track,
    level: rows[0].level,
    balance: rows[0].emeralds,
  });
}
