import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import {
  deleteSaveSlot,
  getOrCreateActiveSaveSlot,
  saveSlotSummaries,
  switchActiveSaveSlot,
} from "@/server/player";

export const runtime = "nodejs";

const bodySchema = z.object({
  slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const deleteBodySchema = bodySchema.extend({
  confirm: z.string(),
});

function deleteConfirmation(slot: 1 | 2 | 3): string {
  return `DELETE SLOT ${slot}`;
}

function storageUnavailable(): Response {
  return Response.json({ error: "storage not configured" }, { status: 503 });
}

export async function GET(): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  const { session } = await getOrCreateActiveSaveSlot();
  const sql = await db();
  return Response.json({
    activeSlot: session.activeSlot,
    slots: await saveSlotSummaries(sql, session),
  });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = deleteBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.confirm !== deleteConfirmation(parsed.data.slot)) {
    return Response.json(
      { error: "delete confirmation required" },
      { status: 400 },
    );
  }
  const session = await deleteSaveSlot(parsed.data.slot);
  const sql = await db();
  return Response.json({
    activeSlot: session.activeSlot,
    slots: await saveSlotSummaries(sql, session),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
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
  const { session } = await switchActiveSaveSlot(parsed.data.slot);
  const sql = await db();
  return Response.json({
    activeSlot: session.activeSlot,
    slots: await saveSlotSummaries(sql, session),
  });
}
