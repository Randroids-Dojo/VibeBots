import { z } from "zod";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";

export const runtime = "nodejs";

const optionalFiniteNumber = z
  .union([z.number().finite(), z.null()])
  .optional()
  .transform((value) => value ?? null);

const optionalInteger = z
  .union([z.number().int(), z.null()])
  .optional()
  .transform((value) => value ?? null);

const performanceSchema = z.object({
  source: z.literal("mine"),
  appVersion: z.string().min(1).max(40),
  appBuild: optionalInteger,
  mineVersion: z.number().int().nonnegative(),
  durationMs: z.number().int().min(250).max(60_000),
  frameCount: z.number().int().min(1).max(20_000),
  avgFrameMs: z.number().finite().nonnegative().max(10_000),
  p50FrameMs: z.number().finite().nonnegative().max(10_000),
  p95FrameMs: z.number().finite().nonnegative().max(10_000),
  maxFrameMs: z.number().finite().nonnegative().max(10_000),
  longFrameCount: z.number().int().nonnegative().max(20_000),
  drawCallsAvg: optionalFiniteNumber,
  drawCallsMax: z
    .number()
    .int()
    .nonnegative()
    .max(100_000)
    .nullable()
    .optional(),
  viewportWidth: z.number().int().positive().max(20_000),
  viewportHeight: z.number().int().positive().max(20_000),
  devicePixelRatio: z.number().finite().positive().max(16),
  hardwareConcurrency: optionalInteger,
  deviceMemoryGb: optionalFiniteNumber,
  renderer: z.string().max(80).nullable().optional(),
  visibilityState: z.string().max(40).nullable().optional(),
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

  const parsed = performanceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  const sample = parsed.data;
  const sql = await db();
  const playerId = await getOrCreatePlayerId();
  await sql`
    INSERT INTO player_performance_samples (
      player_id,
      source,
      app_version,
      app_build,
      mine_version,
      duration_ms,
      frame_count,
      avg_frame_ms,
      p50_frame_ms,
      p95_frame_ms,
      max_frame_ms,
      long_frame_count,
      draw_calls_avg,
      draw_calls_max,
      viewport_width,
      viewport_height,
      device_pixel_ratio,
      hardware_concurrency,
      device_memory_gb,
      renderer,
      visibility_state,
      user_agent
    )
    VALUES (
      ${playerId},
      ${sample.source},
      ${sample.appVersion},
      ${sample.appBuild},
      ${sample.mineVersion},
      ${sample.durationMs},
      ${sample.frameCount},
      ${sample.avgFrameMs},
      ${sample.p50FrameMs},
      ${sample.p95FrameMs},
      ${sample.maxFrameMs},
      ${sample.longFrameCount},
      ${sample.drawCallsAvg},
      ${sample.drawCallsMax ?? null},
      ${sample.viewportWidth},
      ${sample.viewportHeight},
      ${sample.devicePixelRatio},
      ${sample.hardwareConcurrency},
      ${sample.deviceMemoryGb},
      ${sample.renderer ?? null},
      ${sample.visibilityState ?? null},
      ${request.headers.get("user-agent") ?? ""}
    )`;

  return Response.json({ saved: true });
}
