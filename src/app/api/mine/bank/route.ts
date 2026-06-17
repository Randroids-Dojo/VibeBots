import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { logMineCashOutEvent } from "@/server/monitoring";
import {
  getMinePlayerProfile,
  getOrCreatePlayerId,
  type MinePlayerProfile,
  mineConsumablesFromProfile,
} from "@/server/player";
import {
  isMineAction,
  LADDER_RECOVERY_FLOOR,
  MAX_TRIP_MOVES,
  MINE_VERSION,
  type MineAction,
  type MineConsumables,
  type MineGear,
  type MineGearTrack,
  maxGearLevel,
  normalizeGear,
  PLANK_RECOVERY_FLOOR,
  replayTrip,
  STRATA,
  type TripResult,
  type WorldDiff,
} from "@/sim/mine";

export const runtime = "nodejs";
export const maxDuration = 60;

const gearLevel = (
  track:
    | "pickaxe"
    | "battery"
    | "cargo"
    | "lantern"
    | "warpcoil"
    | "blast"
    | "elevatorSpeed"
    | "fall",
) => z.number().int().min(1).max(maxGearLevel(track));

const bodySchema = z.object({
  seed: z.number().int().min(0).max(4294967295),
  // Replay-protection: must match the stored world's trip counter.
  tripIndex: z.number().int().min(0),
  moves: z
    .array(z.string().refine(isMineAction, { message: "invalid mine action" }))
    .min(1)
    .max(MAX_TRIP_MOVES),
  mineVersion: z.number().int(),
  // The gear snapshot the session was played with (Q-007 default B):
  // replay must match what the player saw, validated against ownership.
  gear: z
    .object({
      pickaxe: gearLevel("pickaxe"),
      battery: gearLevel("battery").optional(),
      lamp: gearLevel("battery").optional(),
      cargo: gearLevel("cargo"),
      lantern: gearLevel("lantern"),
      elevator: z.number().int().min(0).max(100000),
      warpcoil: gearLevel("warpcoil"),
      // Optional: gear snapshots that predate these tracks replay as 1.
      blast: gearLevel("blast").optional(),
      elevatorSpeed: gearLevel("elevatorSpeed").optional(),
      fall: gearLevel("fall").optional(),
    })
    .transform((gear) => normalizeGear(gear)),
  // Client snapshot used as an ownership upper bound. The server derives
  // replay stock from the normalized player row before crediting payout.
  consumables: z.object({
    dynamite: z.number().int().min(0).max(999),
    rope: z.number().int().min(0).max(999),
    ladder: z.number().int().min(0).max(999),
    plank: z.number().int().min(0).max(999),
    beacon: z.number().int().min(0).max(999),
  }),
});

const PROFILE_LEVEL_KEYS = [
  ["pickaxe", "pickaxe_level"],
  ["battery", "lamp_level"],
  ["cargo", "cargo_level"],
  ["lantern", "lantern_level"],
  ["warpcoil", "warpcoil_level"],
  ["blast", "blast_level"],
] as const satisfies ReadonlyArray<
  readonly [
    MineGearTrack,
    keyof Pick<
      MinePlayerProfile,
      | "pickaxe_level"
      | "lamp_level"
      | "cargo_level"
      | "lantern_level"
      | "warpcoil_level"
      | "blast_level"
    >,
  ]
>;

export function gearOwnershipError(
  gear: MineGear,
  owned: MinePlayerProfile,
): string | null {
  for (const [track, column] of PROFILE_LEVEL_KEYS) {
    if ((gear[track] ?? 1) > owned[column]) {
      return `gear not owned: ${track} level ${gear[track]}`;
    }
  }
  if (gear.elevator > owned.elevator_depth) {
    return `rail not owned: depth ${gear.elevator}`;
  }
  if ((gear.elevatorSpeed ?? 1) > owned.elevator_speed_level) {
    return `gear not owned: elevator speed ${gear.elevatorSpeed}`;
  }
  if ((gear.fall ?? 1) > owned.fall_level) {
    return `gear not owned: fall harness ${gear.fall}`;
  }
  return null;
}

export function paidConsumableSnapshotExceedsOwned(
  submitted: MineConsumables,
  owned: MineConsumables,
): boolean {
  return (
    submitted.dynamite > owned.dynamite ||
    submitted.rope > owned.rope ||
    submitted.beacon > owned.beacon
  );
}

export function replayConsumablesForCashOut(
  submitted: MineConsumables,
  ownedRow: MinePlayerProfile,
): { consumables: MineConsumables; usedLegacySupportSnapshot: boolean } {
  const owned = mineConsumablesFromProfile(ownedRow);
  if (ownedRow.legacy_support_snapshot_reconciled_at) {
    return { consumables: owned, usedLegacySupportSnapshot: false };
  }
  const ladder = Math.max(
    owned.ladder,
    Math.min(submitted.ladder, LADDER_RECOVERY_FLOOR),
  );
  const plank = Math.max(
    owned.plank,
    Math.min(submitted.plank, PLANK_RECOVERY_FLOOR),
  );
  return {
    consumables: { ...owned, ladder, plank },
    usedLegacySupportSnapshot: ladder > owned.ladder || plank > owned.plank,
  };
}

export function chargeableConsumables(trip: TripResult): MineConsumables {
  return {
    dynamite: trip.used.dynamite,
    rope: trip.used.rope,
    ladder: Math.max(
      0,
      trip.used.ladder - trip.granted.ladder - trip.recovered.ladder,
    ),
    plank: Math.max(
      0,
      trip.used.plank - trip.granted.plank - trip.recovered.plank,
    ),
    beacon: trip.used.beacon,
  };
}

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
  const requestLogContext = {
    tripIndex: parsed.data.tripIndex,
    moveCount: parsed.data.moves.length,
    seed: parsed.data.seed,
  };
  if (parsed.data.mineVersion !== MINE_VERSION) {
    // Generation rules changed under a live session; re-pricing the old
    // log would not match what the player saw.
    logMineCashOutEvent({
      code: "mine_version_mismatch",
      severity: "warn",
      ...requestLogContext,
      mineVersion: parsed.data.mineVersion,
      expectedMineVersion: MINE_VERSION,
    });
    return Response.json(
      { error: "the mine has shifted since this trip started; start fresh" },
      { status: 409 },
    );
  }

  const playerId = await getOrCreatePlayerId();
  const playerLogContext = { playerId, ...requestLogContext };
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
    logMineCashOutEvent({
      code: "no_mine_on_file",
      severity: "warn",
      ...playerLogContext,
    });
    return Response.json({ error: "no mine on file" }, { status: 409 });
  }
  if (Number(worlds[0].seed) !== parsed.data.seed) {
    logMineCashOutEvent({
      code: "wrong_mine_seed",
      severity: "error",
      ...playerLogContext,
      detail: `stored seed ${Number(worlds[0].seed)}`,
    });
    return Response.json({ error: "wrong mine seed" }, { status: 422 });
  }
  if (worlds[0].trip_count !== parsed.data.tripIndex) {
    logMineCashOutEvent({
      code: "trip_already_cashed_out",
      severity: "warn",
      ...playerLogContext,
      worldTripIndex: worlds[0].trip_count,
    });
    return Response.json(
      { error: "this trip was already cashed out; reload the mine" },
      { status: 409 },
    );
  }

  // Gear ownership check: claiming better gear than you own is the only
  // way the snapshot could inflate a payout.
  const ownedRow = await getMinePlayerProfile(sql, playerId);
  if (!ownedRow) {
    logMineCashOutEvent({
      code: "player_not_found",
      severity: "error",
      ...playerLogContext,
    });
    return Response.json({ error: "player not found" }, { status: 409 });
  }
  const gear = parsed.data.gear;
  const gearError = gearOwnershipError(gear, ownedRow);
  if (gearError) {
    logMineCashOutEvent({
      code: "gear_not_owned",
      severity: "error",
      ...playerLogContext,
      detail: gearError,
      submitted: gear,
    });
    return Response.json({ error: gearError }, { status: 422 });
  }
  const submittedConsumables = parsed.data.consumables;
  const ownedConsumables = mineConsumablesFromProfile(ownedRow);
  if (
    paidConsumableSnapshotExceedsOwned(submittedConsumables, ownedConsumables)
  ) {
    logMineCashOutEvent({
      code: "consumables_not_owned",
      severity: "error",
      ...playerLogContext,
      detail: "paid consumable overclaim",
      submitted: submittedConsumables,
      owned: ownedConsumables,
    });
    return Response.json({ error: "consumables not owned" }, { status: 422 });
  }
  const replayStock = replayConsumablesForCashOut(
    submittedConsumables,
    ownedRow,
  );
  const replayConsumables = replayStock.consumables;
  const trip = replayTrip(
    parsed.data.seed,
    parsed.data.moves as MineAction[],
    gear,
    replayConsumables,
    (worlds[0].diff ?? []) as WorldDiff,
  );
  const chargedConsumables = chargeableConsumables(trip);
  if (replayStock.usedLegacySupportSnapshot) {
    logMineCashOutEvent({
      code: "legacy_support_reconciled",
      severity: "warn",
      ...playerLogContext,
      submitted: submittedConsumables,
      owned: ownedConsumables,
      replay: replayConsumables,
      charged: chargedConsumables,
      credited: {
        credits: trip.bankedCredits,
        parts: trip.bankedParts.length,
      },
    });
  }
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
          dynamite_count = GREATEST(0, dynamite_count - ${chargedConsumables.dynamite}),
          rope_count = GREATEST(0, rope_count - ${chargedConsumables.rope}),
          ladder_count = GREATEST(0, ladder_count - ${chargedConsumables.ladder}),
          plank_count = GREATEST(0, plank_count - ${chargedConsumables.plank}),
          beacon_count = GREATEST(0, beacon_count - ${chargedConsumables.beacon}),
          legacy_support_snapshot_reconciled_at = COALESCE(
            legacy_support_snapshot_reconciled_at,
            now()
          )
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
    logMineCashOutEvent({
      code: "cash_out_failed",
      severity: "error",
      ...playerLogContext,
      worldTripIndex: worlds[0].trip_count,
      detail: "atomic update returned no row",
    });
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
