import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import {
  disableWebPushSubscription,
  upsertWebPushSubscription,
  webPushConfigured,
} from "@/server/web-push";

export const runtime = "nodejs";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const subscribeBodySchema = z.object({
  subscription: subscriptionSchema,
  platform: z.string().min(1).max(40).default("unknown"),
});

const deleteBodySchema = z.object({
  endpoint: z.string().url(),
});

function unavailable(): Response {
  return Response.json({ error: "storage not configured" }, { status: 503 });
}

function pushUnavailable(): Response {
  return Response.json({ error: "web push not configured" }, { status: 503 });
}

export async function POST(request: Request): Promise<Response> {
  if (!storageConfigured()) return unavailable();
  if (!webPushConfigured()) return pushUnavailable();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = subscribeBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const sql = await db();
  const playerId = await getOrCreatePlayerId();
  await upsertWebPushSubscription({
    sql,
    playerId,
    subscription: parsed.data.subscription,
    platform: parsed.data.platform,
    userAgent: request.headers.get("user-agent") ?? "",
  });
  return Response.json({ subscribed: true });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!storageConfigured()) return unavailable();
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
  const sql = await db();
  await disableWebPushSubscription(sql, parsed.data.endpoint);
  return Response.json({ subscribed: false });
}
