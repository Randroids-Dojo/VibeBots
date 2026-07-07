/**
 * Pure aggregation for GET /api/performance/insights (F-054). Takes
 * recent trace rows and produces anonymized rollups: overview counts,
 * segment breakdowns, factor buckets (how frame cost moves with draw
 * calls, triangles, lights, particles, heap), and worst snapshots.
 * Never emits player ids or user agents.
 */

export interface PerfInsightLoafScript {
  url: string;
  invoker: string | null;
  ms: number;
}

export interface PerfInsightNetRequest {
  path: string;
  ms: number;
  kb: number | null;
}

export interface PerfInsightRow {
  createdAt: string;
  source: string;
  renderer: string | null;
  backend: string | null;
  qualityTier: string | null;
  appVersion: string;
  appBuild: number | null;
  abVariant: string | null;
  sessionId: string;
  seq: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  p50FrameMs: number | null;
  p95FrameMs: number;
  avgFrameMs: number;
  maxFrameMs: number;
  longFrameCount: number;
  stallCount: number;
  gpuFrameMs: number | null;
  drawCalls: number | null;
  triangles: number | null;
  lightCount: number | null;
  shadowLightCount: number | null;
  particleCount: number | null;
  meshCount: number | null;
  instanceCount: number | null;
  geometries: number | null;
  textures: number | null;
  jsHeapMb: number | null;
  heapMinMb: number | null;
  heapMaxMb: number | null;
  hiddenMs: number | null;
  visibilityChangeCount: number | null;
  netRequestCount: number | null;
  netTransferKb: number | null;
  netTotalMs: number | null;
  netMaxMs: number | null;
  longTaskTotalMs: number | null;
  loafTotalMs: number | null;
  loafMaxMs: number | null;
  loafTopScripts: PerfInsightLoafScript[];
  netTopRequests: PerfInsightNetRequest[];
  canvasDiagnostics: Record<string, string>;
  gpu: string | null;
}

/**
 * Headless harness GPUs; real-device baselines filter these out. The
 * pattern source is shared with the insights route's SQL `~*` filter
 * so the softwareRenderer flag and the device filter cannot diverge.
 */
export const SOFTWARE_GPU_PATTERN = "swiftshader|llvmpipe|software";
const SOFTWARE_GPU = new RegExp(SOFTWARE_GPU_PATTERN, "i");

export function isSoftwareGpu(gpu: string | null): boolean {
  return gpu !== null && SOFTWARE_GPU.test(gpu);
}

interface SegmentSummary {
  segment: string;
  snapshots: number;
  sessions: number;
  avgFrameMs: number | null;
  avgP95FrameMs: number | null;
  worstP95FrameMs: number | null;
  avgGpuFrameMs: number | null;
  avgDrawCalls: number | null;
  avgTriangles: number | null;
  avgLightCount: number | null;
  avgParticleCount: number | null;
  avgJsHeapMb: number | null;
  avgLongFrameCount: number | null;
}

interface FactorBucket {
  label: string;
  snapshots: number;
  avgP95FrameMs: number | null;
  avgGpuFrameMs: number | null;
}

interface FactorSummary {
  factor: string;
  buckets: FactorBucket[];
}

interface SessionRollup {
  session: string;
  source: string;
  renderer: string | null;
  backend: string | null;
  qualityTier: string | null;
  appVersion: string;
  appBuild: number | null;
  abVariant: string | null;
  gpu: string | null;
  softwareRenderer: boolean;
  viewport: string;
  devicePixelRatio: number;
  firstAt: string;
  lastAt: string;
  snapshots: number;
  avgFrameMs: number | null;
  avgP95FrameMs: number | null;
  worstP95FrameMs: number | null;
  maxFrameMs: number | null;
  stallCount: number;
  longFrameCount: number;
  loafTotalMs: number | null;
  loafMaxMs: number | null;
  longTaskTotalMs: number | null;
  hiddenMs: number | null;
  netRequestCount: number | null;
  netTransferKb: number | null;
  netMaxMs: number | null;
  heapMinMb: number | null;
  heapMaxMb: number | null;
  avgDrawCalls: number | null;
  avgTriangles: number | null;
}

/** One stored snapshot, fully expanded for a session drilldown. */
export interface PerfSessionSnapshot {
  createdAt: string;
  seq: number;
  avgFrameMs: number;
  p50FrameMs: number | null;
  p95FrameMs: number;
  maxFrameMs: number;
  longFrameCount: number;
  stallCount: number;
  gpuFrameMs: number | null;
  drawCalls: number | null;
  triangles: number | null;
  meshCount: number | null;
  instanceCount: number | null;
  lightCount: number | null;
  particleCount: number | null;
  jsHeapMb: number | null;
  heapMinMb: number | null;
  heapMaxMb: number | null;
  hiddenMs: number | null;
  visibilityChangeCount: number | null;
  netRequestCount: number | null;
  netTransferKb: number | null;
  netTotalMs: number | null;
  netMaxMs: number | null;
  netTopRequests: PerfInsightNetRequest[];
  longTaskTotalMs: number | null;
  loafTotalMs: number | null;
  loafMaxMs: number | null;
  loafTopScripts: PerfInsightLoafScript[];
  canvasDiagnostics: Record<string, string>;
}

export interface PerfInsights {
  overview: {
    snapshots: number;
    sessions: number;
    sources: Record<string, number>;
    firstAt: string | null;
    lastAt: string | null;
  };
  segments: SegmentSummary[];
  byBuild: SegmentSummary[];
  byVariant: SegmentSummary[];
  sessions: SessionRollup[];
  factors: FactorSummary[];
  worst: {
    createdAt: string;
    source: string;
    renderer: string | null;
    backend: string | null;
    qualityTier: string | null;
    appBuild: number | null;
    session: string;
    viewport: string;
    devicePixelRatio: number;
    gpu: string | null;
    p95FrameMs: number;
    maxFrameMs: number;
    stallCount: number;
    gpuFrameMs: number | null;
    drawCalls: number | null;
    triangles: number | null;
    lightCount: number | null;
    particleCount: number | null;
    jsHeapMb: number | null;
    heapMinMb: number | null;
    heapMaxMb: number | null;
    hiddenMs: number | null;
    netRequestCount: number | null;
    netMaxMs: number | null;
    netTopRequests: PerfInsightNetRequest[];
    loafTotalMs: number | null;
    loafMaxMs: number | null;
    loafTopScripts: PerfInsightLoafScript[];
    longTaskTotalMs: number | null;
  }[];
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function finiteValues(values: (number | null)[]): number[] {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
}

function avg(values: (number | null)[]): number | null {
  const present = finiteValues(values);
  if (present.length === 0) return null;
  return roundTenth(
    present.reduce((total, value) => total + value, 0) / present.length,
  );
}

function sum(values: (number | null)[]): number | null {
  const present = finiteValues(values);
  if (present.length === 0) return null;
  return roundTenth(present.reduce((total, value) => total + value, 0));
}

function max(values: (number | null)[]): number | null {
  const present = finiteValues(values);
  if (present.length === 0) return null;
  return roundTenth(Math.max(...present));
}

function min(values: (number | null)[]): number | null {
  const present = finiteValues(values);
  if (present.length === 0) return null;
  return roundTenth(Math.min(...present));
}

function summarizeGroup(
  segment: string,
  rows: PerfInsightRow[],
): SegmentSummary {
  return {
    segment,
    snapshots: rows.length,
    sessions: new Set(rows.map((row) => row.sessionId)).size,
    avgFrameMs: avg(rows.map((row) => row.avgFrameMs)),
    avgP95FrameMs: avg(rows.map((row) => row.p95FrameMs)),
    worstP95FrameMs:
      rows.length === 0
        ? null
        : roundTenth(Math.max(...rows.map((row) => row.p95FrameMs))),
    avgGpuFrameMs: avg(rows.map((row) => row.gpuFrameMs)),
    avgDrawCalls: avg(rows.map((row) => row.drawCalls)),
    avgTriangles: avg(rows.map((row) => row.triangles)),
    avgLightCount: avg(rows.map((row) => row.lightCount)),
    avgParticleCount: avg(rows.map((row) => row.particleCount)),
    avgJsHeapMb: avg(rows.map((row) => row.jsHeapMb)),
    avgLongFrameCount: avg(rows.map((row) => row.longFrameCount)),
  };
}

function groupBy(
  rows: PerfInsightRow[],
  key: (row: PerfInsightRow) => string,
): SegmentSummary[] {
  const groups = new Map<string, PerfInsightRow[]>();
  for (const row of rows) {
    const label = key(row);
    const group = groups.get(label);
    if (group) group.push(row);
    else groups.set(label, [row]);
  }
  return [...groups.entries()]
    .map(([label, group]) => summarizeGroup(label, group))
    .sort((a, b) => b.snapshots - a.snapshots);
}

interface FactorDefinition {
  factor: string;
  value: (row: PerfInsightRow) => number | null;
  bounds: number[];
}

const FACTOR_DEFINITIONS: FactorDefinition[] = [
  {
    factor: "drawCalls",
    value: (row) => row.drawCalls,
    bounds: [50, 100, 150, 250],
  },
  {
    factor: "triangles",
    value: (row) => row.triangles,
    bounds: [100_000, 300_000, 1_000_000, 3_000_000],
  },
  {
    factor: "lightCount",
    value: (row) => row.lightCount,
    bounds: [2, 4, 8, 16],
  },
  {
    factor: "particleCount",
    value: (row) => row.particleCount,
    bounds: [0, 40, 120, 300],
  },
  {
    factor: "jsHeapMb",
    value: (row) => row.jsHeapMb,
    bounds: [100, 250, 500, 1000],
  },
  {
    factor: "instanceCount",
    value: (row) => row.instanceCount,
    bounds: [200, 1000, 4000, 16_000],
  },
];

function bucketLabel(bounds: number[], index: number): string {
  if (index === 0) return `<=${bounds[0]}`;
  if (index === bounds.length) return `>${bounds[bounds.length - 1]}`;
  return `${bounds[index - 1] + 1}-${bounds[index]}`;
}

function summarizeFactor(
  definition: FactorDefinition,
  rows: PerfInsightRow[],
): FactorSummary {
  const buckets: PerfInsightRow[][] = Array.from(
    { length: definition.bounds.length + 1 },
    () => [],
  );
  for (const row of rows) {
    const value = definition.value(row);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    let index = definition.bounds.findIndex((bound) => value <= bound);
    if (index === -1) index = definition.bounds.length;
    buckets[index].push(row);
  }
  return {
    factor: definition.factor,
    buckets: buckets
      .map((bucket, index) => ({
        label: bucketLabel(definition.bounds, index),
        snapshots: bucket.length,
        avgP95FrameMs: avg(bucket.map((row) => row.p95FrameMs)),
        avgGpuFrameMs: avg(bucket.map((row) => row.gpuFrameMs)),
      }))
      .filter((bucket) => bucket.snapshots > 0),
  };
}

const MAX_SESSION_ROLLUPS = 40;

function summarizeSessions(rows: PerfInsightRow[]): SessionRollup[] {
  const groups = new Map<string, PerfInsightRow[]>();
  for (const row of rows) {
    const group = groups.get(row.sessionId);
    if (group) group.push(row);
    else groups.set(row.sessionId, [row]);
  }
  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      const last = sorted[sorted.length - 1];
      return {
        session: last.sessionId.slice(0, 6),
        source: last.source,
        renderer: last.renderer,
        backend: last.backend,
        qualityTier: last.qualityTier,
        appVersion: last.appVersion,
        appBuild: last.appBuild,
        abVariant: last.abVariant,
        gpu: last.gpu,
        softwareRenderer: isSoftwareGpu(last.gpu),
        viewport: `${last.viewportWidth}x${last.viewportHeight}`,
        devicePixelRatio: last.devicePixelRatio,
        firstAt: sorted[0].createdAt,
        lastAt: last.createdAt,
        snapshots: sorted.length,
        avgFrameMs: avg(sorted.map((row) => row.avgFrameMs)),
        avgP95FrameMs: avg(sorted.map((row) => row.p95FrameMs)),
        worstP95FrameMs: max(sorted.map((row) => row.p95FrameMs)),
        maxFrameMs: max(sorted.map((row) => row.maxFrameMs)),
        stallCount: sum(sorted.map((row) => row.stallCount)) ?? 0,
        longFrameCount: sum(sorted.map((row) => row.longFrameCount)) ?? 0,
        loafTotalMs: sum(sorted.map((row) => row.loafTotalMs)),
        loafMaxMs: max(sorted.map((row) => row.loafMaxMs)),
        longTaskTotalMs: sum(sorted.map((row) => row.longTaskTotalMs)),
        hiddenMs: sum(sorted.map((row) => row.hiddenMs)),
        netRequestCount: sum(sorted.map((row) => row.netRequestCount)),
        netTransferKb: sum(sorted.map((row) => row.netTransferKb)),
        netMaxMs: max(sorted.map((row) => row.netMaxMs)),
        heapMinMb: min(sorted.map((row) => row.heapMinMb ?? row.jsHeapMb)),
        heapMaxMb: max(sorted.map((row) => row.heapMaxMb ?? row.jsHeapMb)),
        avgDrawCalls: avg(sorted.map((row) => row.drawCalls)),
        avgTriangles: avg(sorted.map((row) => row.triangles)),
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, MAX_SESSION_ROLLUPS);
}

/** Per-snapshot expansion for one session (?session= drilldown). */
export function summarizePerfSession(
  rows: PerfInsightRow[],
): PerfSessionSnapshot[] {
  return [...rows]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq)
    .map((row) => ({
      createdAt: row.createdAt,
      seq: row.seq,
      avgFrameMs: row.avgFrameMs,
      p50FrameMs: row.p50FrameMs,
      p95FrameMs: row.p95FrameMs,
      maxFrameMs: row.maxFrameMs,
      longFrameCount: row.longFrameCount,
      stallCount: row.stallCount,
      gpuFrameMs: row.gpuFrameMs,
      drawCalls: row.drawCalls,
      triangles: row.triangles,
      meshCount: row.meshCount,
      instanceCount: row.instanceCount,
      lightCount: row.lightCount,
      particleCount: row.particleCount,
      jsHeapMb: row.jsHeapMb,
      heapMinMb: row.heapMinMb,
      heapMaxMb: row.heapMaxMb,
      hiddenMs: row.hiddenMs,
      visibilityChangeCount: row.visibilityChangeCount,
      netRequestCount: row.netRequestCount,
      netTransferKb: row.netTransferKb,
      netTotalMs: row.netTotalMs,
      netMaxMs: row.netMaxMs,
      netTopRequests: row.netTopRequests,
      longTaskTotalMs: row.longTaskTotalMs,
      loafTotalMs: row.loafTotalMs,
      loafMaxMs: row.loafMaxMs,
      loafTopScripts: row.loafTopScripts,
      canvasDiagnostics: row.canvasDiagnostics,
    }));
}

export function summarizePerfInsights(rows: PerfInsightRow[]): PerfInsights {
  const sources: Record<string, number> = {};
  for (const row of rows) {
    sources[row.source] = (sources[row.source] ?? 0) + 1;
  }
  const sortedByTime = [...rows].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return {
    overview: {
      snapshots: rows.length,
      sessions: new Set(rows.map((row) => row.sessionId)).size,
      sources,
      firstAt: sortedByTime[0]?.createdAt ?? null,
      lastAt: sortedByTime.at(-1)?.createdAt ?? null,
    },
    segments: groupBy(
      rows,
      (row) =>
        `${row.source}/${row.renderer ?? "unknown"}/${row.qualityTier ?? "unknown"}`,
    ),
    byBuild: groupBy(rows, (row) => `build ${row.appBuild ?? "unknown"}`),
    byVariant: groupBy(rows, (row) => `variant ${row.abVariant ?? "none"}`),
    sessions: summarizeSessions(rows),
    factors: FACTOR_DEFINITIONS.map((definition) =>
      summarizeFactor(definition, rows),
    ).filter((factor) => factor.buckets.length > 0),
    worst: [...rows]
      .sort((a, b) => b.p95FrameMs - a.p95FrameMs)
      .slice(0, 12)
      .map((row) => ({
        createdAt: row.createdAt,
        source: row.source,
        renderer: row.renderer,
        backend: row.backend,
        qualityTier: row.qualityTier,
        appBuild: row.appBuild,
        session: row.sessionId.slice(0, 6),
        viewport: `${row.viewportWidth}x${row.viewportHeight}`,
        devicePixelRatio: row.devicePixelRatio,
        gpu: row.gpu,
        p95FrameMs: row.p95FrameMs,
        maxFrameMs: row.maxFrameMs,
        stallCount: row.stallCount,
        gpuFrameMs: row.gpuFrameMs,
        drawCalls: row.drawCalls,
        triangles: row.triangles,
        lightCount: row.lightCount,
        particleCount: row.particleCount,
        jsHeapMb: row.jsHeapMb,
        heapMinMb: row.heapMinMb,
        heapMaxMb: row.heapMaxMb,
        hiddenMs: row.hiddenMs,
        netRequestCount: row.netRequestCount,
        netMaxMs: row.netMaxMs,
        netTopRequests: row.netTopRequests,
        loafTotalMs: row.loafTotalMs,
        loafMaxMs: row.loafMaxMs,
        loafTopScripts: row.loafTopScripts,
        longTaskTotalMs: row.longTaskTotalMs,
      })),
  };
}
