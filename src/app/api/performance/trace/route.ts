import { z } from "zod";
import { PERF_SOURCES } from "@/lib/perf-trace";
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

const optionalCount = z
  .union([z.number().int().nonnegative().max(10_000_000), z.null()])
  .optional()
  .transform((value) => value ?? null);

const optionalMs = z
  .union([z.number().finite().nonnegative().max(600_000), z.null()])
  .optional()
  .transform((value) => value ?? null);

const optionalShortText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : (value ?? null)));

const probeSchema = z.object({
  backend: z.enum(["webgpu", "webgl2"]).nullable(),
  drawCalls: optionalCount,
  triangles: optionalCount,
  geometries: optionalCount,
  textures: optionalCount,
  meshCount: optionalCount,
  instancedMeshCount: optionalCount,
  instanceCount: optionalCount,
  lightCount: optionalCount,
  shadowLightCount: optionalCount,
  spriteCount: optionalCount,
  visibleObjectCount: optionalCount,
  materialCount: optionalCount,
  particleCount: optionalCount,
  gpuFrameMs: optionalMs,
  lightsByType: z
    .record(z.string().max(40), z.number().int().nonnegative())
    .refine((value) => Object.keys(value).length <= 20, "too many light types"),
  canvasDiagnostics: z
    .record(z.string().max(40), z.string().max(32))
    .refine((value) => Object.keys(value).length <= 20, "too many diagnostics"),
});

const snapshotSchema = z.object({
  seq: z.number().int().positive().max(1_000_000),
  durationMs: z.number().int().min(250).max(600_000),
  frameCount: z.number().int().min(1).max(100_000),
  avgFrameMs: z.number().finite().nonnegative().max(10_000),
  p50FrameMs: z.number().finite().nonnegative().max(10_000),
  p95FrameMs: z.number().finite().nonnegative().max(10_000),
  maxFrameMs: z.number().finite().nonnegative().max(60_000),
  longFrameCount: z.number().int().nonnegative().max(100_000),
  stallCount: z.number().int().nonnegative().max(100_000),
  jsHeapMb: optionalFiniteNumber,
  main: z.object({
    longTaskCount: optionalCount,
    longTaskTotalMs: optionalMs,
    loafCount: optionalCount,
    loafTotalMs: optionalMs,
    loafMaxMs: optionalMs,
    loafTopScripts: z
      .array(
        z.object({
          url: z.string().max(160),
          ms: z.number().finite().nonnegative().max(600_000),
        }),
      )
      .max(3),
    inputEventCount: optionalCount,
    inputEventMaxMs: optionalMs,
  }),
  probe: probeSchema.nullable(),
});

const traceSchema = z.object({
  source: z.enum(PERF_SOURCES as [string, ...string[]]),
  sessionId: z.string().min(8).max(40),
  appVersion: z.string().min(1).max(40),
  appBuild: optionalInteger,
  mineVersion: optionalInteger,
  renderer: optionalShortText(80),
  qualityTier: z.enum(["low", "high"]).nullable().optional(),
  abVariant: optionalShortText(40),
  viewportWidth: z.number().int().positive().max(20_000),
  viewportHeight: z.number().int().positive().max(20_000),
  devicePixelRatio: z.number().finite().positive().max(16),
  hardwareConcurrency: optionalInteger,
  deviceMemoryGb: optionalFiniteNumber,
  gpu: optionalShortText(200),
  connectionType: optionalShortText(20),
  visibilityState: optionalShortText(40),
  snapshots: z.array(snapshotSchema).min(1).max(24),
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

  const parsed = traceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  const trace = parsed.data;
  const sql = await db();
  const playerId = await getOrCreatePlayerId();
  const userAgent = request.headers.get("user-agent") ?? "";
  const inserts = trace.snapshots.map((snapshot) => {
    const detail = JSON.stringify({
      lightsByType: snapshot.probe?.lightsByType ?? {},
      canvasDiagnostics: snapshot.probe?.canvasDiagnostics ?? {},
      loafTopScripts: snapshot.main.loafTopScripts,
      spriteCount: snapshot.probe?.spriteCount ?? null,
    });
    return sql`
      INSERT INTO player_perf_traces (
        player_id, session_id, seq, source,
        app_version, app_build, mine_version,
        renderer, backend, quality_tier, ab_variant,
        viewport_width, viewport_height, device_pixel_ratio,
        hardware_concurrency, device_memory_gb, gpu, connection_type,
        duration_ms, frame_count,
        avg_frame_ms, p50_frame_ms, p95_frame_ms, max_frame_ms,
        long_frame_count, stall_count, gpu_frame_ms,
        draw_calls, triangles, geometries, textures,
        mesh_count, instanced_mesh_count, instance_count,
        light_count, shadow_light_count, particle_count,
        visible_object_count, material_count,
        js_heap_mb,
        long_task_count, long_task_total_ms,
        loaf_count, loaf_total_ms, loaf_max_ms,
        input_event_count, input_event_max_ms,
        detail, user_agent
      )
      VALUES (
        ${playerId}, ${trace.sessionId}, ${snapshot.seq}, ${trace.source},
        ${trace.appVersion}, ${trace.appBuild}, ${trace.mineVersion},
        ${trace.renderer}, ${snapshot.probe?.backend ?? null},
        ${trace.qualityTier ?? null}, ${trace.abVariant},
        ${trace.viewportWidth}, ${trace.viewportHeight},
        ${trace.devicePixelRatio},
        ${trace.hardwareConcurrency}, ${trace.deviceMemoryGb},
        ${trace.gpu}, ${trace.connectionType},
        ${snapshot.durationMs}, ${snapshot.frameCount},
        ${snapshot.avgFrameMs}, ${snapshot.p50FrameMs},
        ${snapshot.p95FrameMs}, ${snapshot.maxFrameMs},
        ${snapshot.longFrameCount}, ${snapshot.stallCount},
        ${snapshot.probe?.gpuFrameMs ?? null},
        ${snapshot.probe?.drawCalls ?? null},
        ${snapshot.probe?.triangles ?? null},
        ${snapshot.probe?.geometries ?? null},
        ${snapshot.probe?.textures ?? null},
        ${snapshot.probe?.meshCount ?? null},
        ${snapshot.probe?.instancedMeshCount ?? null},
        ${snapshot.probe?.instanceCount ?? null},
        ${snapshot.probe?.lightCount ?? null},
        ${snapshot.probe?.shadowLightCount ?? null},
        ${snapshot.probe?.particleCount ?? null},
        ${snapshot.probe?.visibleObjectCount ?? null},
        ${snapshot.probe?.materialCount ?? null},
        ${snapshot.jsHeapMb},
        ${snapshot.main.longTaskCount}, ${snapshot.main.longTaskTotalMs},
        ${snapshot.main.loafCount}, ${snapshot.main.loafTotalMs},
        ${snapshot.main.loafMaxMs},
        ${snapshot.main.inputEventCount}, ${snapshot.main.inputEventMaxMs},
        ${detail}::jsonb, ${userAgent}
      )
      ON CONFLICT (session_id, seq) DO NOTHING`;
  });
  // One atomic batch: a retry or double flush cannot land a partial
  // trace or duplicate rows. The purge bounds raw-row retention (the
  // rows carry player-linked device info) to the analysis window.
  await sql.transaction([
    ...inserts,
    sql`
      DELETE FROM player_perf_traces
      WHERE created_at < now() - interval '30 days'`,
  ]);

  return Response.json({ saved: trace.snapshots.length });
}
