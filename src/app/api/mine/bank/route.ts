import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import {
  LADDER_PROVISION,
  MAX_TRIP_MOVES,
  MINE_ACTIONS,
  MINE_VERSION,
  maxGearLevel,
  replayTrip,
  STRATA,
} from "@/sim/mine";

export const runtime = "nodejs";
export const maxDuration = 60;

const gearLevel = (track: "pickaxe" | "lamp" | "cargo" | "lantern") =>
  z.number().int().min(1).max(maxGearLevel(track));

const bodySchema = z.object({
  seed: z.number().int().min(0).max(4294967295),
  moves: z.array(z.enum(MINE_ACTIONS)).min(1).max(MAX_TRIP_MOVES),
  mineVersion: z.number().int(),
  // The gear snapshot the session was played with (Q-007 default B):
  // replay must match what the player saw, validated against ownership.
  gear: z.object({
    pickaxe: gearLevel("pickaxe"),
    lamp: gearLevel("lamp"),
    cargo: gearLevel("cargo"),
    lantern: gearLevel("lantern"),
  }),
  // Consumables held at session start; spent ones decrement at cash-out.
  consumables: z.object({
    dynamite: z.number().int().min(0).max(999),
    rope: z.number().int().min(0).max(999),
    ladder: z.number().int().min(0).max(999),
  }),
});

/**
 * Cash out a mining session. The mine is a pure function of (seed,
 * moves), so the server replays the submitted log and credits exactly
 * what an honest client banked, plus first-reach stratum bonuses
 * against the player's persistent deepest-depth record (REQ-012); each
 * seed is creditable once per player (the unique key), so a log cannot
 * be resubmitted.
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
  if (parsed.data.mineVersion !== MINE_VERSION) {
    // Generation rules changed under a live session; re-pricing the old
    // log would not match what the player saw.
    return Response.json(
      { error: "the mine has shifted since this trip started; start fresh" },
      { status: 409 },
    );
  }

  const playerId = await getOrCreatePlayerId();
  const sql = await db();

  // Gear ownership check: claiming better gear than you own is the only
  // way the snapshot could inflate a payout.
  const owned = (await sql`
    SELECT pickaxe_level, lamp_level, cargo_level, lantern_level,
           dynamite_count, rope_count, ladder_count
    FROM players WHERE id = ${playerId}`) as Array<Record<string, number>>;
  const gear = parsed.data.gear;
  for (const track of ["pickaxe", "lamp", "cargo", "lantern"] as const) {
    if (gear[track] > (owned[0]?.[`${track}_level`] ?? 1)) {
      return Response.json(
        { error: `gear not owned: ${track} level ${gear[track]}` },
        { status: 422 },
      );
    }
  }
  const consumables = parsed.data.consumables;
  if (
    consumables.dynamite > (owned[0]?.dynamite_count ?? 0) ||
    consumables.rope > (owned[0]?.rope_count ?? 0) ||
    consumables.ladder > (owned[0]?.ladder_count ?? 0)
  ) {
    return Response.json({ error: "consumables not owned" }, { status: 422 });
  }

  const trip = replayTrip(
    parsed.data.seed,
    parsed.data.moves,
    gear,
    consumables,
  );
  if (trip.bankedCredits === 0 && trip.bankedParts.length === 0) {
    return Response.json(
      { error: "nothing banked in this run" },
      { status: 422 },
    );
  }
  // One statement = atomic on the neon HTTP driver (no cross-statement
  // transactions): consume the seed, compute the first-reach stratum
  // bonus against the stored record, credit the wallet, advance the
  // record, and grant the parts together, or not at all. STRATA rides
  // in as jsonb so the sim table and the SQL can never drift.
  const rows = (await sql`
    WITH prev AS (
      SELECT deepest_depth FROM players WHERE id = ${playerId}
    ), ins AS (
      INSERT INTO mine_runs (player_id, seed, banked_emeralds, banked_parts)
      VALUES (${playerId}, ${parsed.data.seed}, ${trip.bankedCredits}, ${JSON.stringify(trip.bankedParts)}::jsonb)
      ON CONFLICT (player_id, seed) DO NOTHING
      RETURNING banked_emeralds, banked_parts
    ), bonus AS (
      SELECT COALESCE(SUM((s ->> 'firstReachBonus')::int), 0)::int AS amount
      FROM prev, jsonb_array_elements(${JSON.stringify(STRATA)}::jsonb) AS s
      WHERE EXISTS (SELECT 1 FROM ins)
        AND (s ->> 'startRow')::int > prev.deepest_depth
        AND (s ->> 'startRow')::int <= ${trip.maxDepth}
    ), upd AS (
      UPDATE players
      SET emeralds = emeralds
            + (SELECT banked_emeralds FROM ins)
            + (SELECT amount FROM bonus),
          deepest_depth = GREATEST(deepest_depth, ${trip.maxDepth}),
          dynamite_count = GREATEST(0, dynamite_count - ${trip.used.dynamite}),
          rope_count = GREATEST(0, rope_count - ${trip.used.rope}),
          ladder_count = GREATEST(0, ladder_count
            - ${Math.max(0, trip.used.ladder - LADDER_PROVISION)})
      WHERE id = ${playerId} AND EXISTS (SELECT 1 FROM ins)
      RETURNING emeralds, deepest_depth
    ), granted AS (
      INSERT INTO player_parts (player_id, part_id, count)
      SELECT ${playerId}, value, count(*)::int
      FROM ins, jsonb_array_elements_text(ins.banked_parts)
      GROUP BY value
      ON CONFLICT (player_id, part_id)
      DO UPDATE SET count = player_parts.count + EXCLUDED.count
    )
    SELECT
      (SELECT emeralds FROM upd) AS emeralds,
      (SELECT deepest_depth FROM upd) AS deepest_depth,
      (SELECT amount FROM bonus) AS bonus`) as Array<{
    emeralds: number | null;
    deepest_depth: number | null;
    bonus: number | null;
  }>;
  if (rows[0]?.emeralds === null || rows[0]?.emeralds === undefined) {
    return Response.json(
      { error: "this run was already cashed out" },
      { status: 409 },
    );
  }
  return Response.json({
    credited: {
      credits: trip.bankedCredits,
      parts: trip.bankedParts,
      milestoneBonus: rows[0].bonus ?? 0,
    },
    balance: rows[0].emeralds,
    deepestDepth: rows[0].deepest_depth,
  });
}
