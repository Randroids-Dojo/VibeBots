import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import {
  LADDER_PROVISION,
  MAX_TRIP_MOVES,
  MINE_ACTIONS,
  MINE_VERSION,
  maxGearLevel,
  PLANK_PROVISION,
  replayTrip,
  STRATA,
  type WorldDiff,
} from "@/sim/mine";

export const runtime = "nodejs";
export const maxDuration = 60;

const gearLevel = (
  track: "pickaxe" | "lamp" | "cargo" | "lantern" | "warpcoil",
) => z.number().int().min(1).max(maxGearLevel(track));

const bodySchema = z.object({
  seed: z.number().int().min(0).max(4294967295),
  // Replay-protection: must match the stored world's trip counter.
  tripIndex: z.number().int().min(0),
  moves: z.array(z.enum(MINE_ACTIONS)).min(1).max(MAX_TRIP_MOVES),
  mineVersion: z.number().int(),
  // The gear snapshot the session was played with (Q-007 default B):
  // replay must match what the player saw, validated against ownership.
  gear: z.object({
    pickaxe: gearLevel("pickaxe"),
    lamp: gearLevel("lamp"),
    cargo: gearLevel("cargo"),
    lantern: gearLevel("lantern"),
    elevator: z.number().int().min(0).max(100000),
    warpcoil: gearLevel("warpcoil"),
  }),
  // Consumables held at session start; spent ones decrement at cash-out.
  consumables: z.object({
    dynamite: z.number().int().min(0).max(999),
    rope: z.number().int().min(0).max(999),
    ladder: z.number().int().min(0).max(999),
    plank: z.number().int().min(0).max(999),
    beacon: z.number().int().min(0).max(999),
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

  // The persistent world checkpoint (REQ-026): the trip replays on top
  // of the stored diff; seed and trip counter must match.
  const worlds = (await sql`
    SELECT seed, diff, trip_count FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{
    seed: string | number;
    diff: unknown;
    trip_count: number;
  }>;
  if (worlds.length === 0) {
    return Response.json({ error: "no claim on file" }, { status: 409 });
  }
  if (Number(worlds[0].seed) !== parsed.data.seed) {
    return Response.json({ error: "wrong claim seed" }, { status: 422 });
  }
  if (worlds[0].trip_count !== parsed.data.tripIndex) {
    return Response.json(
      { error: "this trip was already cashed out; reload the mine" },
      { status: 409 },
    );
  }

  // Gear ownership check: claiming better gear than you own is the only
  // way the snapshot could inflate a payout.
  const owned = (await sql`
    SELECT pickaxe_level, lamp_level, cargo_level, lantern_level,
           warpcoil_level, elevator_depth,
           dynamite_count, rope_count, ladder_count, plank_count,
           beacon_count
    FROM players WHERE id = ${playerId}`) as Array<Record<string, number>>;
  const gear = parsed.data.gear;
  for (const track of [
    "pickaxe",
    "lamp",
    "cargo",
    "lantern",
    "warpcoil",
  ] as const) {
    if (gear[track] > (owned[0]?.[`${track}_level`] ?? 1)) {
      return Response.json(
        { error: `gear not owned: ${track} level ${gear[track]}` },
        { status: 422 },
      );
    }
  }
  if (gear.elevator > (owned[0]?.elevator_depth ?? 0)) {
    return Response.json(
      { error: `rail not owned: depth ${gear.elevator}` },
      { status: 422 },
    );
  }
  const consumables = parsed.data.consumables;
  if (
    consumables.dynamite > (owned[0]?.dynamite_count ?? 0) ||
    consumables.rope > (owned[0]?.rope_count ?? 0) ||
    consumables.ladder > (owned[0]?.ladder_count ?? 0) ||
    consumables.plank > (owned[0]?.plank_count ?? 0) ||
    consumables.beacon > (owned[0]?.beacon_count ?? 0)
  ) {
    return Response.json({ error: "consumables not owned" }, { status: 422 });
  }

  const trip = replayTrip(
    parsed.data.seed,
    parsed.data.moves,
    gear,
    consumables,
    (worlds[0].diff ?? []) as WorldDiff,
  );
  // Zero-bank trips are legitimate now: carving and laddering are
  // world investments worth checkpointing even with an empty hold.
  // One statement = atomic on the neon HTTP driver (no cross-statement
  // transactions): consume the seed, compute the first-reach stratum
  // bonus against the stored record, credit the wallet, advance the
  // record, and grant the parts together, or not at all. STRATA rides
  // in as jsonb so the sim table and the SQL can never drift.
  const rows = (await sql`
    WITH prev AS (
      SELECT deepest_depth FROM players WHERE id = ${playerId}
    ), world AS (
      UPDATE mine_worlds
      SET diff = ${JSON.stringify(trip.diff)}::jsonb,
          trip_count = trip_count + 1,
          updated_at = now()
      WHERE player_id = ${playerId}
        AND trip_count = ${parsed.data.tripIndex}
      RETURNING trip_count
    ), bonus AS (
      SELECT COALESCE(SUM((s ->> 'firstReachBonus')::int), 0)::int AS amount
      FROM prev, jsonb_array_elements(${JSON.stringify(STRATA)}::jsonb) AS s
      WHERE EXISTS (SELECT 1 FROM world)
        AND (s ->> 'startRow')::int > prev.deepest_depth
        AND (s ->> 'startRow')::int <= ${trip.maxDepth}
    ), upd AS (
      UPDATE players
      SET emeralds = emeralds
            + ${trip.bankedCredits}
            + (SELECT amount FROM bonus),
          deepest_depth = GREATEST(deepest_depth, ${trip.maxDepth}),
          dynamite_count = GREATEST(0, dynamite_count - ${trip.used.dynamite}),
          rope_count = GREATEST(0, rope_count - ${trip.used.rope}),
          ladder_count = GREATEST(0, ladder_count
            - ${Math.max(0, trip.used.ladder - LADDER_PROVISION)}),
          plank_count = GREATEST(0, plank_count
            - ${Math.max(0, trip.used.plank - PLANK_PROVISION)}),
          beacon_count = GREATEST(0, beacon_count - ${trip.used.beacon})
      WHERE id = ${playerId} AND EXISTS (SELECT 1 FROM world)
      RETURNING emeralds, deepest_depth
    ), granted AS (
      INSERT INTO player_parts (player_id, part_id, count)
      SELECT ${playerId}, value, count(*)::int
      FROM jsonb_array_elements_text(${JSON.stringify(trip.bankedParts)}::jsonb)
      WHERE EXISTS (SELECT 1 FROM world)
      GROUP BY value
      ON CONFLICT (player_id, part_id)
      DO UPDATE SET count = player_parts.count + EXCLUDED.count
    )
    SELECT
      (SELECT emeralds FROM upd) AS emeralds,
      (SELECT deepest_depth FROM upd) AS deepest_depth,
      (SELECT amount FROM bonus) AS bonus,
      (SELECT trip_count FROM world) AS trip_count`) as Array<{
    emeralds: number | null;
    deepest_depth: number | null;
    bonus: number | null;
    trip_count: number | null;
  }>;
  if (rows[0]?.emeralds === null || rows[0]?.emeralds === undefined) {
    return Response.json(
      { error: "this trip was already cashed out" },
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
    tripIndex: rows[0].trip_count ?? parsed.data.tripIndex + 1,
  });
}
