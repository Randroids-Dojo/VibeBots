import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { logSaveSlotEvent } from "@/server/monitoring";
import {
  deleteSaveSlot,
  getOrCreateActiveSaveSlot,
  saveSlotSummaries,
  switchActiveSaveSlot,
} from "@/server/player";

export const runtime = "nodejs";

const bodySchema = z.object({
  slot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  create: z.boolean().optional().default(false),
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

function saveSlotRequestContext(request: Request): {
  referrerHost: string | null;
  secFetchSite: string | null;
} {
  const referrer = request.headers.get("referer");
  let referrerHost: string | null = null;
  if (referrer) {
    try {
      referrerHost = new URL(referrer).host;
    } catch {
      referrerHost = "invalid";
    }
  }
  return {
    referrerHost,
    secFetchSite: request.headers.get("sec-fetch-site"),
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  const { playerId, session } = await getOrCreateActiveSaveSlot();
  const sql = await db();
  logSaveSlotEvent({
    event: "save_slots.list",
    activeSlot: session.activeSlot,
    currentPlayerId: playerId,
    ...saveSlotRequestContext(request),
  });
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
  const requestContext = saveSlotRequestContext(request);
  const { playerId, session, created } = await switchActiveSaveSlot(
    parsed.data.slot,
    { createIfMissing: parsed.data.create },
  );
  const sql = await db();
  if (!playerId) {
    logSaveSlotEvent({
      event: "save_slots.switch_rejected",
      activeSlot: session.activeSlot,
      requestedSlot: parsed.data.slot,
      accepted: false,
      reason: "empty_slot_requires_create",
      ...requestContext,
    });
    return Response.json(
      {
        error: "save slot is empty",
        code: "empty_save_slot",
        activeSlot: session.activeSlot,
        slots: await saveSlotSummaries(sql, session),
      },
      { status: 409 },
    );
  }
  logSaveSlotEvent({
    event: "save_slots.switch",
    activeSlot: session.activeSlot,
    requestedSlot: parsed.data.slot,
    selectedPlayerId: playerId,
    created,
    accepted: true,
    ...requestContext,
  });
  return Response.json({
    activeSlot: session.activeSlot,
    slots: await saveSlotSummaries(sql, session),
  });
}
