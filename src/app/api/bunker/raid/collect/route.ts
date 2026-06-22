import { collectBunkerRaidPickup } from "@/server/bunker";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as {
    col?: unknown;
    row?: unknown;
  } | null;
  const col = Number(body?.col);
  const row = Number(body?.row);
  if (!Number.isInteger(col) || !Number.isInteger(row)) {
    return Response.json({ error: "invalid pickup cell" }, { status: 400 });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const result = await collectBunkerRaidPickup(sql, playerId, col, row);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ...result.view, raid: result.raid });
}
