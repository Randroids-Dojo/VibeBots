import { z } from "zod";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

const contextSchema = z
  .object({
    source: z.string().min(1).max(80),
    appVersion: z.string().max(40).optional(),
    mineVersion: z.number().int().optional(),
    prompt: z.string().max(80).optional(),
    depth: z.number().int().optional(),
    column: z.number().int().optional(),
  })
  .passthrough();

const feedbackSchema = z
  .object({
    category: z.enum(FEEDBACK_CATEGORIES),
    comment: z.string().trim().max(2000).default(""),
    email: z
      .union([z.string().trim().email().max(254), z.literal("")])
      .optional()
      .transform((value) => value || null),
    context: contextSchema,
  })
  .refine((value) => value.category !== "other" || value.comment.length > 0, {
    message: "Tell us what other feedback means.",
    path: ["comment"],
  });

function unavailable(): Response {
  return Response.json({ error: "storage not configured" }, { status: 503 });
}

export async function POST(request: Request): Promise<Response> {
  if (!storageConfigured()) return unavailable();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  const sql = await db();
  const playerId = await getOrCreatePlayerId();
  await sql`
    INSERT INTO player_feedback (
      player_id,
      category,
      comment,
      contact_email,
      context,
      user_agent,
      reviewed
    )
    VALUES (
      ${playerId},
      ${parsed.data.category},
      ${parsed.data.comment},
      ${parsed.data.email},
      ${JSON.stringify(parsed.data.context)}::jsonb,
      ${request.headers.get("user-agent") ?? ""},
      false
    )`;

  return Response.json({ saved: true });
}
