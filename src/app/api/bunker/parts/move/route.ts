import { z } from "zod";
import { moveBunkerPart } from "@/server/bunker";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

const bodySchema = z.object({
  fromCol: z.number().int(),
  fromRow: z.number().int().min(1),
  toCol: z.number().int(),
  toRow: z.number().int().min(1),
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
  const result = await moveBunkerPart(
    sql,
    playerId,
    parsed.data.fromCol,
    parsed.data.fromRow,
    parsed.data.toCol,
    parsed.data.toRow,
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result.view);
}
