import {
  type PerfInsightRow,
  summarizePerfInsights,
} from "@/lib/perf-insights";
import { db, storageConfigured } from "@/server/db";

export const runtime = "nodejs";

const MAX_HOURS = 168;
const DEFAULT_HOURS = 24;
const MAX_ROWS = 5000;

interface TraceRecord {
  created_at: string;
  source: string;
  renderer: string | null;
  backend: string | null;
  quality_tier: string | null;
  app_version: string;
  app_build: number | null;
  ab_variant: string | null;
  session_id: string;
  viewport_width: number;
  viewport_height: number;
  device_pixel_ratio: number;
  p95_frame_ms: number;
  avg_frame_ms: number;
  max_frame_ms: number;
  long_frame_count: number;
  stall_count: number;
  gpu_frame_ms: number | null;
  draw_calls: number | null;
  triangles: number | null;
  light_count: number | null;
  shadow_light_count: number | null;
  particle_count: number | null;
  mesh_count: number | null;
  instance_count: number | null;
  geometries: number | null;
  textures: number | null;
  js_heap_mb: number | null;
  long_task_total_ms: number | null;
  loaf_total_ms: number | null;
  gpu: string | null;
}

function toInsightRow(record: TraceRecord): PerfInsightRow {
  return {
    createdAt: new Date(record.created_at).toISOString(),
    source: record.source,
    renderer: record.renderer,
    backend: record.backend,
    qualityTier: record.quality_tier,
    appVersion: record.app_version,
    appBuild: record.app_build,
    abVariant: record.ab_variant,
    sessionId: record.session_id,
    viewportWidth: record.viewport_width,
    viewportHeight: record.viewport_height,
    devicePixelRatio: record.device_pixel_ratio,
    p95FrameMs: record.p95_frame_ms,
    avgFrameMs: record.avg_frame_ms,
    maxFrameMs: record.max_frame_ms,
    longFrameCount: record.long_frame_count,
    stallCount: record.stall_count,
    gpuFrameMs: record.gpu_frame_ms,
    drawCalls: record.draw_calls,
    triangles: record.triangles,
    lightCount: record.light_count,
    shadowLightCount: record.shadow_light_count,
    particleCount: record.particle_count,
    meshCount: record.mesh_count,
    instanceCount: record.instance_count,
    geometries: record.geometries,
    textures: record.textures,
    jsHeapMb: record.js_heap_mb,
    longTaskTotalMs: record.long_task_total_ms,
    loafTotalMs: record.loaf_total_ms,
    gpu: record.gpu,
  };
}

/**
 * Anonymized rollups over recent opt-in performance traces (F-054).
 * Aggregates and factor buckets only: no player ids, no user agents.
 * `?hours=` widens the window (default 24, max 168); `?source=` filters
 * to one surface.
 */
export async function GET(request: Request): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const url = new URL(request.url);
  const hoursRaw = Number(url.searchParams.get("hours") ?? DEFAULT_HOURS);
  const hours =
    Number.isFinite(hoursRaw) && hoursRaw > 0
      ? Math.min(hoursRaw, MAX_HOURS)
      : DEFAULT_HOURS;
  const source = url.searchParams.get("source");

  const sql = await db();
  const records = (await sql`
    SELECT created_at, source, renderer, backend, quality_tier,
           app_version, app_build, ab_variant, session_id,
           viewport_width, viewport_height, device_pixel_ratio,
           p95_frame_ms, avg_frame_ms, max_frame_ms,
           long_frame_count, stall_count, gpu_frame_ms,
           draw_calls, triangles, light_count, shadow_light_count,
           particle_count, mesh_count, instance_count,
           geometries, textures, js_heap_mb,
           long_task_total_ms, loaf_total_ms, gpu
    FROM player_perf_traces
    WHERE created_at >= now() - make_interval(hours => ${hours})
      AND (${source}::text IS NULL OR source = ${source})
    ORDER BY created_at DESC
    LIMIT ${MAX_ROWS}`) as TraceRecord[];

  return Response.json(
    {
      windowHours: hours,
      source: source ?? null,
      truncated: records.length >= MAX_ROWS,
      ...summarizePerfInsights(records.map(toInsightRow)),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
