import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { botDesignSchema, validateDesign } from "@/sim/design";

export const runtime = "nodejs";

/** Designs a single player may keep saved. */
const MAX_SAVED_DESIGNS = 20;

const saveSchema = z.object({
  design: botDesignSchema,
});

function storageUnavailable(): Response {
  return Response.json({ error: "storage not configured" }, { status: 503 });
}

/** Lists the player's saved designs (newest first). */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const rows = await sql`
    SELECT id, name, design, updated_at
    FROM bot_designs
    WHERE player_id = ${playerId}
    ORDER BY updated_at DESC`;
  return Response.json({ designs: rows });
}

/** Saves (upserts by name) the player's design. */
export async function POST(request: Request): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const design = parsed.data.design;
  const validation = validateDesign(design);
  if (!validation.ok) {
    return Response.json(
      { error: "invalid design", issues: validation.errors },
      { status: 422 },
    );
  }

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const countRows = (await sql`
    SELECT count(*)::int AS count FROM bot_designs WHERE player_id = ${playerId}`) as Array<{
    count: number;
  }>;
  const existingRows = (await sql`
    SELECT id FROM bot_designs WHERE player_id = ${playerId} AND name = ${design.name}`) as Array<{
    id: string;
  }>;
  if (existingRows.length === 0 && countRows[0].count >= MAX_SAVED_DESIGNS) {
    return Response.json(
      { error: `design limit reached (${MAX_SAVED_DESIGNS})` },
      { status: 409 },
    );
  }

  const rows = (await sql`
    INSERT INTO bot_designs (player_id, name, design)
    VALUES (${playerId}, ${design.name}, ${JSON.stringify(design)}::jsonb)
    ON CONFLICT (player_id, name)
    DO UPDATE SET design = EXCLUDED.design, updated_at = now()
    RETURNING id, name, updated_at`) as Array<{ id: string }>;
  return Response.json({ saved: rows[0] });
}
