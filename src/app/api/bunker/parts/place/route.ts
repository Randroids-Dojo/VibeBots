import { z } from "zod";
import { placeBunkerPart } from "@/server/bunker";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { BASE_PART_IDS } from "@/sim/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  partId: z.enum(BASE_PART_IDS),
  col: z.number().int(),
  row: z.number().int().min(1),
});

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
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const result = await placeBunkerPart(
    sql,
    playerId,
    parsed.data.partId,
    parsed.data.col,
    parsed.data.row,
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result.view);
}
