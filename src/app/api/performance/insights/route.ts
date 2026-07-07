import {
  type PerfInsightLoafScript,
  type PerfInsightNetRequest,
  type PerfInsightRow,
  SOFTWARE_GPU_PATTERN,
  summarizePerfInsights,
  summarizePerfSession,
} from "@/lib/perf-insights";
import { db, storageConfigured } from "@/server/db";

export const runtime = "nodejs";

const MAX_HOURS = 168;
const DEFAULT_HOURS = 24;
const MAX_ROWS = 5000;
const MAX_SESSION_SNAPSHOTS = 200;
const SESSION_PREFIX = /^[0-9a-f]{4,32}$/;

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
  seq: number;
  viewport_width: number;
  viewport_height: number;
  device_pixel_ratio: number;
  p50_frame_ms: number | null;
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
  heap_min_mb: number | null;
  heap_max_mb: number | null;
  hidden_ms: number | null;
  visibility_change_count: number | null;
  net_request_count: number | null;
  net_transfer_kb: number | null;
  net_total_ms: number | null;
  net_max_ms: number | null;
  long_task_total_ms: number | null;
  loaf_total_ms: number | null;
  loaf_max_ms: number | null;
  detail: unknown;
  gpu: string | null;
}

function detailLoafScripts(detail: unknown): PerfInsightLoafScript[] {
  const scripts =
    detail && typeof detail === "object"
      ? (detail as { loafTopScripts?: unknown }).loafTopScripts
      : null;
  if (!Array.isArray(scripts)) return [];
  return scripts
    .filter(
      (script): script is { url: string; invoker?: unknown; ms: number } =>
        typeof script === "object" &&
        script !== null &&
        typeof (script as { url?: unknown }).url === "string" &&
        typeof (script as { ms?: unknown }).ms === "number",
    )
    .slice(0, 3)
    .map((script) => ({
      url: script.url,
      invoker: typeof script.invoker === "string" ? script.invoker : null,
      ms: script.ms,
    }));
}

function detailNetRequests(detail: unknown): PerfInsightNetRequest[] {
  const requests =
    detail && typeof detail === "object"
      ? (detail as { netTopRequests?: unknown }).netTopRequests
      : null;
  if (!Array.isArray(requests)) return [];
  return requests
    .filter(
      (request): request is { path: string; ms: number; kb?: unknown } =>
        typeof request === "object" &&
        request !== null &&
        typeof (request as { path?: unknown }).path === "string" &&
        typeof (request as { ms?: unknown }).ms === "number",
    )
    .slice(0, 3)
    .map((request) => ({
      path: request.path,
      ms: request.ms,
      kb: typeof request.kb === "number" ? request.kb : null,
    }));
}

function detailDiagnostics(detail: unknown): Record<string, string> {
  const diagnostics =
    detail && typeof detail === "object"
      ? (detail as { canvasDiagnostics?: unknown }).canvasDiagnostics
      : null;
  if (!diagnostics || typeof diagnostics !== "object") return {};
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(diagnostics)) {
    if (typeof value === "string") entries[key] = value;
  }
  return entries;
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
    seq: record.seq,
    viewportWidth: record.viewport_width,
    viewportHeight: record.viewport_height,
    devicePixelRatio: record.device_pixel_ratio,
    p50FrameMs: record.p50_frame_ms,
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
    heapMinMb: record.heap_min_mb,
    heapMaxMb: record.heap_max_mb,
    hiddenMs: record.hidden_ms,
    visibilityChangeCount: record.visibility_change_count,
    netRequestCount: record.net_request_count,
    netTransferKb: record.net_transfer_kb,
    netTotalMs: record.net_total_ms,
    netMaxMs: record.net_max_ms,
    longTaskTotalMs: record.long_task_total_ms,
    loafTotalMs: record.loaf_total_ms,
    loafMaxMs: record.loaf_max_ms,
    loafTopScripts: detailLoafScripts(record.detail),
    netTopRequests: detailNetRequests(record.detail),
    canvasDiagnostics: detailDiagnostics(record.detail),
    gpu: record.gpu,
  };
}

/**
 * Anonymized rollups over recent opt-in performance traces (F-054).
 * Aggregates and factor buckets only: no player ids, no user agents.
 * `?hours=` widens the window (default 24, max 168); `?source=` filters
 * to one surface; `?device=real|software` splits real hardware from
 * headless harness GPUs; `?session=<hex prefix>` narrows to one session
 * and adds a per-snapshot drilldown with LoAF, long-task, network, heap
 * span, and hidden-time attribution.
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
  const device = url.searchParams.get("device");
  const sessionRaw = url.searchParams.get("session")?.toLowerCase() ?? null;
  const session = SESSION_PREFIX.test(sessionRaw ?? "") ? sessionRaw : null;
  const realOnly = device === "real";
  const softwareOnly = device === "software";

  const sql = await db();
  const records = (await sql`
    SELECT created_at, source, renderer, backend, quality_tier,
           app_version, app_build, ab_variant, session_id, seq,
           viewport_width, viewport_height, device_pixel_ratio,
           p50_frame_ms, p95_frame_ms, avg_frame_ms, max_frame_ms,
           long_frame_count, stall_count, gpu_frame_ms,
           draw_calls, triangles, light_count, shadow_light_count,
           particle_count, mesh_count, instance_count,
           geometries, textures, js_heap_mb, heap_min_mb, heap_max_mb,
           hidden_ms, visibility_change_count,
           net_request_count, net_transfer_kb, net_total_ms, net_max_ms,
           long_task_total_ms, loaf_total_ms, loaf_max_ms, detail, gpu
    FROM player_perf_traces
    WHERE created_at >= now() - make_interval(hours => ${hours})
      AND (${source}::text IS NULL OR source = ${source})
      AND (${session}::text IS NULL OR starts_with(session_id, ${session}))
      AND (${realOnly}::boolean IS NOT true
           OR gpu IS NULL OR gpu !~* ${SOFTWARE_GPU_PATTERN})
      AND (${softwareOnly}::boolean IS NOT true
           OR gpu ~* ${SOFTWARE_GPU_PATTERN})
    ORDER BY created_at DESC
    LIMIT ${MAX_ROWS}`) as TraceRecord[];

  const rows = records.map(toInsightRow);
  return Response.json(
    {
      windowHours: hours,
      source: source ?? null,
      device: realOnly || softwareOnly ? device : null,
      session,
      truncated: records.length >= MAX_ROWS,
      ...summarizePerfInsights(rows),
      sessionDetail: session
        ? summarizePerfSession(rows).slice(-MAX_SESSION_SNAPSHOTS)
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
