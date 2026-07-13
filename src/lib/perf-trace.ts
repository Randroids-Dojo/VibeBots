import {
  type FrameMetricSummary,
  summarizeFrameMetrics,
} from "./performance-metrics";

/**
 * Pure shaping for deep performance trace snapshots (F-054). One
 * snapshot pairs a frame-time distribution with what the renderer and
 * scene were doing during that window, so bottleneck analysis is a
 * plain aggregation over stored rows.
 */

export type PerfSource =
  | "mine"
  | "arena"
  | "workshop"
  | "holodeck"
  | "bunker-fp";

export const PERF_SOURCES: readonly PerfSource[] = [
  "mine",
  "arena",
  "workshop",
  "holodeck",
  "bunker-fp",
];

/** Frames at or above this stall on screen in a way players notice. */
export const PERF_STALL_FRAME_MS = 250;

/** Renderer + scene composition read from the active canvas probe. */
export interface PerfProbeSample {
  backend: "webgpu" | "webgl2" | null;
  drawCalls: number | null;
  triangles: number | null;
  geometries: number | null;
  textures: number | null;
  meshCount: number | null;
  instancedMeshCount: number | null;
  instanceCount: number | null;
  lightCount: number | null;
  shadowLightCount: number | null;
  spriteCount: number | null;
  visibleObjectCount: number | null;
  materialCount: number | null;
  particleCount: number | null;
  gpuFrameMs: number | null;
  lightsByType: Record<string, number>;
  canvasDiagnostics: Record<string, string>;
}

export interface PerfLoafScript {
  url: string;
  /** LoAF invoker (e.g. FrameRequestCallback, TimerHandler, listener). */
  invoker: string | null;
  ms: number;
}

export interface PerfMainThreadSample {
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  loafCount: number | null;
  loafTotalMs: number | null;
  loafMaxMs: number | null;
  loafTopScripts: PerfLoafScript[];
  inputEventCount: number | null;
  inputEventMaxMs: number | null;
}

export interface PerfNetworkRequest {
  /** Same-origin pathname, or bare origin for cross-origin requests. */
  path: string;
  ms: number;
  kb: number | null;
}

/** Resource timing rolled up over one snapshot window. */
export interface PerfNetworkSample {
  requestCount: number;
  transferKb: number | null;
  totalMs: number;
  maxMs: number;
  topRequests: PerfNetworkRequest[];
}

export interface PerfSnapshot extends FrameMetricSummary {
  seq: number;
  durationMs: number;
  stallCount: number;
  jsHeapMb: number | null;
  /** Heap low/high over the window; a wide span is the GC sawtooth. */
  heapMinMb: number | null;
  heapMaxMb: number | null;
  /** Time the document spent hidden inside this window (app switches). */
  hiddenMs: number;
  visibilityChangeCount: number;
  main: PerfMainThreadSample;
  net: PerfNetworkSample | null;
  probe: PerfProbeSample | null;
}

const MAX_LOAF_SCRIPTS = 3;
const MAX_SCRIPT_URL_LENGTH = 160;
const MAX_INVOKER_LENGTH = 80;
const MAX_NET_REQUESTS = 3;
const MAX_NET_PATH_LENGTH = 120;
const MAX_DIAGNOSTIC_ENTRIES = 20;
const MAX_DIAGNOSTIC_LENGTH = 32;

export function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildPerfSnapshot(input: {
  seq: number;
  durationMs: number;
  frameMs: readonly number[];
  jsHeapMb: number | null;
  heapMinMb: number | null;
  heapMaxMb: number | null;
  hiddenMs: number;
  visibilityChangeCount: number;
  main: PerfMainThreadSample;
  net: PerfNetworkSample | null;
  probe: PerfProbeSample | null;
}): PerfSnapshot {
  const summary = summarizeFrameMetrics(input.frameMs);
  return {
    seq: input.seq,
    durationMs: Math.round(input.durationMs),
    ...summary,
    stallCount: input.frameMs.filter(
      (value) => Number.isFinite(value) && value >= PERF_STALL_FRAME_MS,
    ).length,
    jsHeapMb: finiteOrNull(input.jsHeapMb),
    heapMinMb: finiteOrNull(input.heapMinMb),
    heapMaxMb: finiteOrNull(input.heapMaxMb),
    // Hidden time can accumulate across skipped windows while the page
    // is backgrounded; cap at the trace route's schema ceiling so a
    // long app switch cannot invalidate the whole upload batch.
    hiddenMs: Math.min(
      600_000,
      Math.max(0, Math.round(finiteOrNull(input.hiddenMs) ?? 0)),
    ),
    visibilityChangeCount: Math.min(
      10_000,
      Math.max(0, Math.round(finiteOrNull(input.visibilityChangeCount) ?? 0)),
    ),
    main: {
      longTaskCount: finiteOrNull(input.main.longTaskCount),
      longTaskTotalMs: mapFinite(input.main.longTaskTotalMs, roundTenth),
      loafCount: finiteOrNull(input.main.loafCount),
      loafTotalMs: mapFinite(input.main.loafTotalMs, roundTenth),
      loafMaxMs: mapFinite(input.main.loafMaxMs, roundTenth),
      loafTopScripts: input.main.loafTopScripts
        .slice(0, MAX_LOAF_SCRIPTS)
        .map((script) => ({
          url: script.url.slice(0, MAX_SCRIPT_URL_LENGTH),
          invoker: script.invoker
            ? script.invoker.slice(0, MAX_INVOKER_LENGTH)
            : null,
          ms: roundTenth(script.ms),
        })),
      inputEventCount: finiteOrNull(input.main.inputEventCount),
      inputEventMaxMs: mapFinite(input.main.inputEventMaxMs, roundTenth),
    },
    net: input.net ? clampNetworkSample(input.net) : null,
    probe: input.probe ? clampProbeSample(input.probe) : null,
  };
}

export function clampNetworkSample(net: PerfNetworkSample): PerfNetworkSample {
  return {
    requestCount: Math.max(0, Math.round(finiteOrNull(net.requestCount) ?? 0)),
    transferKb: mapFinite(net.transferKb, roundTenth),
    totalMs: roundTenth(finiteOrNull(net.totalMs) ?? 0),
    maxMs: roundTenth(finiteOrNull(net.maxMs) ?? 0),
    topRequests: net.topRequests.slice(0, MAX_NET_REQUESTS).map((request) => ({
      path: request.path.slice(0, MAX_NET_PATH_LENGTH),
      ms: roundTenth(finiteOrNull(request.ms) ?? 0),
      kb: mapFinite(request.kb, roundTenth),
    })),
  };
}

function mapFinite(
  value: number | null,
  transform: (value: number) => number,
): number | null {
  const finite = finiteOrNull(value);
  return finite === null ? null : transform(finite);
}

function clampCount(value: number | null): number | null {
  const finite = finiteOrNull(value);
  return finite === null ? null : Math.max(0, Math.round(finite));
}

export function clampProbeSample(probe: PerfProbeSample): PerfProbeSample {
  const lightsByType: Record<string, number> = {};
  for (const [key, value] of Object.entries(probe.lightsByType).slice(0, 8)) {
    const count = clampCount(value);
    if (count !== null) lightsByType[key.slice(0, 40)] = count;
  }
  const canvasDiagnostics: Record<string, string> = {};
  for (const [key, value] of Object.entries(probe.canvasDiagnostics).slice(
    0,
    MAX_DIAGNOSTIC_ENTRIES,
  )) {
    canvasDiagnostics[key.slice(0, 40)] = String(value).slice(
      0,
      MAX_DIAGNOSTIC_LENGTH,
    );
  }
  return {
    backend: probe.backend,
    drawCalls: clampCount(probe.drawCalls),
    triangles: clampCount(probe.triangles),
    geometries: clampCount(probe.geometries),
    textures: clampCount(probe.textures),
    meshCount: clampCount(probe.meshCount),
    instancedMeshCount: clampCount(probe.instancedMeshCount),
    instanceCount: clampCount(probe.instanceCount),
    lightCount: clampCount(probe.lightCount),
    shadowLightCount: clampCount(probe.shadowLightCount),
    spriteCount: clampCount(probe.spriteCount),
    visibleObjectCount: clampCount(probe.visibleObjectCount),
    materialCount: clampCount(probe.materialCount),
    particleCount: clampCount(probe.particleCount),
    gpuFrameMs: mapFinite(probe.gpuFrameMs, (value) =>
      roundTenth(Math.min(value, 10_000)),
    ),
    lightsByType,
    canvasDiagnostics,
  };
}
