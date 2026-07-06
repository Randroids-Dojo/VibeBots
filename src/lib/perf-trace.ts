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

export type PerfSource = "mine" | "arena" | "workshop" | "holodeck";

export const PERF_SOURCES: readonly PerfSource[] = [
  "mine",
  "arena",
  "workshop",
  "holodeck",
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

export interface PerfMainThreadSample {
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  loafCount: number | null;
  loafTotalMs: number | null;
  loafMaxMs: number | null;
  loafTopScripts: { url: string; ms: number }[];
  inputEventCount: number | null;
  inputEventMaxMs: number | null;
}

export interface PerfSnapshot extends FrameMetricSummary {
  seq: number;
  durationMs: number;
  stallCount: number;
  jsHeapMb: number | null;
  main: PerfMainThreadSample;
  probe: PerfProbeSample | null;
}

const MAX_LOAF_SCRIPTS = 3;
const MAX_SCRIPT_URL_LENGTH = 160;
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
  main: PerfMainThreadSample;
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
          ms: roundTenth(script.ms),
        })),
      inputEventCount: finiteOrNull(input.main.inputEventCount),
      inputEventMaxMs: mapFinite(input.main.inputEventMaxMs, roundTenth),
    },
    probe: input.probe ? clampProbeSample(input.probe) : null,
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
