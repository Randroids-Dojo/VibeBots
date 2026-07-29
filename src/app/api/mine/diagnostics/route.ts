import { z } from "zod";
import { logMineClientDiagnosticEvent } from "@/server/monitoring";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

const viewportSchema = z
  .object({
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
    visualWidth: z.number().int().positive().max(20_000).nullable().optional(),
    visualHeight: z.number().int().positive().max(20_000).nullable().optional(),
    visualScale: z.number().finite().positive().max(16).nullable().optional(),
  })
  .strict();

const targetSchema = z
  .object({
    tag: z.string().max(40).nullable().optional(),
    role: z.string().max(80).nullable().optional(),
    ariaLabel: z.string().max(120).nullable().optional(),
    hasTouchSurface: z.boolean().optional(),
  })
  .strict();

const diagnosticSchema = z
  .object({
    code: z.enum([
      "touch_surface_missing",
      "touch_surface_not_topmost",
      "movement_disabled_by_bunker_panel",
      "bunker_overlay_during_terminal",
      "saved_trip_replay_collapsed",
      "surfaced_carving_unbanked",
    ]),
    appVersion: z.string().min(1).max(40).optional(),
    appBuild: z.number().int().nullable().optional(),
    mineVersion: z.number().int().nonnegative().optional(),
    activeSlot: z.number().int().min(1).max(3).optional(),
    minerRow: z.number().int().optional(),
    hasActiveBunker: z.boolean().optional(),
    bunkerPanelOpen: z.boolean().optional(),
    activeBunkerRaid: z.boolean().optional(),
    collectMode: z.boolean().optional(),
    creditsOpen: z.boolean().optional(),
    mineSceneReady: z.boolean().optional(),
    movementTouchEnabled: z.boolean().optional(),
    displayMode: z.string().max(40).nullable().optional(),
    // Bounded on purpose: this is forwarded into monitoring, where a
    // free-form string would be an unbounded log dimension.
    cashOutState: z.enum(["error", "unavailable"]).optional(),
    moveCount: z.number().int().nonnegative().max(1_000_000).optional(),
    viewport: viewportSchema.optional(),
    target: targetSchema.optional(),
    detail: z.string().max(240).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = diagnosticSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  const playerId = await getOrCreatePlayerId().catch(() => undefined);
  logMineClientDiagnosticEvent({
    severity: "warn",
    playerId,
    ...parsed.data,
  });
  return Response.json({ logged: true });
}
