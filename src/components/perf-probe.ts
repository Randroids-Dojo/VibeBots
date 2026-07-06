import type { PerfProbeSample, PerfSource } from "@/lib/perf-trace";

/**
 * Probe registry bridging R3F canvases and the page-level telemetry
 * collector. A canvas registers a probe closure over its renderer and
 * scene; the collector calls the probe only at snapshot boundaries
 * (every few seconds), so scene traversal cost never lands on normal
 * frames. Duck-typed against three objects to stay node-testable.
 */

export type PerfProbe = () => PerfProbeSample | null;

const probes = new Map<PerfSource, PerfProbe>();

export function registerPerfProbe(source: PerfSource, probe: PerfProbe): void {
  probes.set(source, probe);
}

export function unregisterPerfProbe(source: PerfSource): void {
  probes.delete(source);
}

export function readPerfProbe(source: PerfSource): PerfProbeSample | null {
  const probe = probes.get(source);
  if (!probe) return null;
  try {
    return probe();
  } catch {
    return null;
  }
}

interface SceneObjectLike {
  visible?: boolean;
  count?: number;
  castShadow?: boolean;
  type?: string;
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isLight?: boolean;
  isSprite?: boolean;
  geometry?: object;
  material?: object | object[];
}

interface SceneLike {
  traverse(callback: (object: unknown) => void): void;
}

export interface SceneStats {
  meshCount: number;
  instancedMeshCount: number;
  instanceCount: number;
  lightCount: number;
  shadowLightCount: number;
  spriteCount: number;
  visibleObjectCount: number;
  materialCount: number;
  lightsByType: Record<string, number>;
}

/** One traversal counting what the scene is made of right now. */
export function collectSceneStats(scene: SceneLike): SceneStats {
  const stats: SceneStats = {
    meshCount: 0,
    instancedMeshCount: 0,
    instanceCount: 0,
    lightCount: 0,
    shadowLightCount: 0,
    spriteCount: 0,
    visibleObjectCount: 0,
    materialCount: 0,
    lightsByType: {},
  };
  const materials = new Set<object>();
  scene.traverse((object) => {
    const node = object as SceneObjectLike;
    if (node.visible !== false) stats.visibleObjectCount += 1;
    if (node.isInstancedMesh) {
      stats.instancedMeshCount += 1;
      stats.instanceCount +=
        typeof node.count === "number" && Number.isFinite(node.count)
          ? node.count
          : 0;
    }
    if (node.isMesh) stats.meshCount += 1;
    if (node.isSprite) stats.spriteCount += 1;
    if (node.isLight) {
      stats.lightCount += 1;
      if (node.castShadow) stats.shadowLightCount += 1;
      const type = node.type ?? "Light";
      stats.lightsByType[type] = (stats.lightsByType[type] ?? 0) + 1;
    }
    if (node.material) {
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        materials.add(material);
      }
    }
  });
  stats.materialCount = materials.size;
  return stats;
}

/** Mine-canvas diagnostics worth keeping with each snapshot. */
const CANVAS_DIAGNOSTIC_KEYS = [
  "frameMs",
  "particleCount",
  "renderedCellCount",
  "crackSegmentCount",
  "teeterCount",
  "gasWispCount",
  "renderBelow",
  "litBelow",
  "renderRadius",
  "timeOfDay",
  "camY",
  "camZoom",
] as const;

export function collectCanvasDiagnostics(
  dataset: Partial<Record<string, string>>,
): Record<string, string> {
  const diagnostics: Record<string, string> = {};
  for (const key of CANVAS_DIAGNOSTIC_KEYS) {
    const value = dataset[key];
    if (typeof value === "string" && value !== "") diagnostics[key] = value;
  }
  return diagnostics;
}

interface RendererInfoLike {
  render?: { calls?: unknown; triangles?: unknown };
  memory?: { geometries?: unknown; textures?: unknown };
}

function infoNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function collectRendererInfo(info: RendererInfoLike | undefined): {
  drawCalls: number | null;
  triangles: number | null;
  geometries: number | null;
  textures: number | null;
} {
  return {
    drawCalls: infoNumber(info?.render?.calls),
    triangles: infoNumber(info?.render?.triangles),
    geometries: infoNumber(info?.memory?.geometries),
    textures: infoNumber(info?.memory?.textures),
  };
}
