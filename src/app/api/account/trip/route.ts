import { z } from "zod";
import { findLinkedPlayerId } from "@/server/account-linking";
import { accountJson, storageUnavailable } from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { db, storageConfigured } from "@/server/db";
import {
  mineConsumablesSchema,
  mineGearSchema,
} from "@/server/mine-trip-schema";
import { currentPlayerId } from "@/server/player";
import { sameOriginMutationRequired } from "@/server/request-guards";
import { isMineAction, MAX_TRIP_MOVES, MINE_VERSION } from "@/sim/mine";

export const runtime = "nodejs";

const tripSchema = z.object({
  mineVersion: z.literal(MINE_VERSION),
  seed: z.number().int().min(0).max(4294967295),
  tripIndex: z.number().int().min(0),
  gear: mineGearSchema,
  consumables: mineConsumablesSchema,
  baseDiff: z.array(z.unknown()).max(20000),
  moves: z
    .array(z.string().refine(isMineAction, { message: "invalid mine action" }))
    .max(MAX_TRIP_MOVES),
  pendingBunker: z.unknown().optional(),
  terminalReplayConsumed: z.boolean().optional(),
});

const putBodySchema = z.object({
  trip: tripSchema,
});

export async function GET(request: Request): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  const identity = await currentReadyAccountIdentity(
    requestAccountSessionProvider(request),
  );
  if (!identity) {
    return accountJson({ error: "account sign-in required" }, { status: 401 });
  }
  const sql = await db();
  const playerId = await findLinkedPlayerId(sql, identity);
  if (!playerId) {
    return accountJson({ error: "cloud save not found" }, { status: 404 });
  }
  const rows = (await sql`
    SELECT trip
    FROM mine_trip_checkpoints
    WHERE player_id = ${playerId}`) as Array<{ trip: unknown }>;
  return accountJson({ trip: rows[0]?.trip ?? null });
}

export async function PUT(request: Request): Promise<Response> {
  const rejected = sameOriginMutationRequired(request);
  if (rejected) return rejected;
  if (!storageConfigured()) return storageUnavailable();
  const playerId = await currentPlayerId();
  if (!playerId) {
    return accountJson({ error: "guest save required" }, { status: 409 });
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return accountJson({ error: "invalid trip checkpoint" }, { status: 400 });
  }
  const parsed = putBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return accountJson({ error: "invalid trip checkpoint" }, { status: 400 });
  }
  const sql = await db();
  await sql`
    INSERT INTO mine_trip_checkpoints (player_id, trip)
    VALUES (${playerId}, ${JSON.stringify(parsed.data.trip)}::jsonb)
    ON CONFLICT (player_id) DO UPDATE
      SET trip = EXCLUDED.trip,
          updated_at = now()`;
  return accountJson({ stored: true });
}

export async function DELETE(request: Request): Promise<Response> {
  const rejected = sameOriginMutationRequired(request);
  if (rejected) return rejected;
  if (!storageConfigured()) return storageUnavailable();
  const playerId = await currentPlayerId();
  if (!playerId) {
    return accountJson({ cleared: false });
  }
  const sql = await db();
  await sql`
    DELETE FROM mine_trip_checkpoints
    WHERE player_id = ${playerId}`;
  return accountJson({ cleared: true });
}
