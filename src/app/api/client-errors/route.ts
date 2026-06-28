import { z } from "zod";
import { logAppClientErrorEvent } from "@/server/monitoring";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

const clientErrorSchema = z
  .object({
    code: z.enum([
      "react_error_boundary",
      "global_error",
      "unhandled_rejection",
    ]),
    source: z.enum(["app", "global", "window"]).optional(),
    appVersion: z.string().min(1).max(40).optional(),
    path: z.string().min(1).max(240).optional(),
    message: z.string().max(500).optional(),
    digest: z.string().max(120).nullable().optional(),
    stack: z.string().max(2_000).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = clientErrorSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  const playerId = await getOrCreatePlayerId().catch(() => undefined);
  logAppClientErrorEvent({
    severity: "error",
    playerId,
    userAgent: request.headers.get("user-agent") ?? "",
    ...parsed.data,
  });
  return Response.json({ logged: true });
}
