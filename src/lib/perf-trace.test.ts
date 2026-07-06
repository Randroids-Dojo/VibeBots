import { describe, expect, it } from "vitest";
import {
  buildPerfSnapshot,
  clampProbeSample,
  type PerfMainThreadSample,
  type PerfProbeSample,
} from "./perf-trace";

function mainSample(
  overrides: Partial<PerfMainThreadSample> = {},
): PerfMainThreadSample {
  return {
    longTaskCount: 2,
    longTaskTotalMs: 120.34,
    loafCount: 1,
    loafTotalMs: 80.06,
    loafMaxMs: 80.06,
    loafTopScripts: [{ url: "https://app/main.js", ms: 61.29 }],
    inputEventCount: 3,
    inputEventMaxMs: 72.19,
    ...overrides,
  };
}

function probeSample(
  overrides: Partial<PerfProbeSample> = {},
): PerfProbeSample {
  return {
    backend: "webgpu",
    drawCalls: 120,
    triangles: 240_000,
    geometries: 44,
    textures: 12,
    meshCount: 300,
    instancedMeshCount: 4,
    instanceCount: 900,
    lightCount: 5,
    shadowLightCount: 1,
    spriteCount: 0,
    visibleObjectCount: 400,
    materialCount: 28,
    particleCount: 64,
    gpuFrameMs: 4.27,
    lightsByType: { PointLight: 2, DirectionalLight: 1 },
    canvasDiagnostics: { frameMs: "16.4", timeOfDay: "day" },
    ...overrides,
  };
}

describe("buildPerfSnapshot", () => {
  it("summarizes frames and counts stalls separately", () => {
    const snapshot = buildPerfSnapshot({
      seq: 3,
      durationMs: 5_001.7,
      frameMs: [16, 16, 17, 55, 300],
      jsHeapMb: 181.5,
      main: mainSample(),
      probe: probeSample(),
    });
    expect(snapshot.seq).toBe(3);
    expect(snapshot.durationMs).toBe(5_002);
    expect(snapshot.frameCount).toBe(5);
    expect(snapshot.longFrameCount).toBe(2);
    expect(snapshot.stallCount).toBe(1);
    expect(snapshot.maxFrameMs).toBe(300);
    expect(snapshot.jsHeapMb).toBe(181.5);
    expect(snapshot.main.longTaskTotalMs).toBe(120.3);
    expect(snapshot.main.loafTopScripts).toEqual([
      { url: "https://app/main.js", ms: 61.3 },
    ]);
    expect(snapshot.probe?.drawCalls).toBe(120);
    expect(snapshot.probe?.gpuFrameMs).toBe(4.3);
  });

  it("tolerates missing browser capabilities", () => {
    const snapshot = buildPerfSnapshot({
      seq: 1,
      durationMs: 5_000,
      frameMs: [16, 17, 18],
      jsHeapMb: null,
      main: mainSample({
        longTaskCount: null,
        longTaskTotalMs: null,
        loafCount: null,
        loafTotalMs: null,
        loafMaxMs: null,
        loafTopScripts: [],
        inputEventCount: null,
        inputEventMaxMs: null,
      }),
      probe: null,
    });
    expect(snapshot.jsHeapMb).toBeNull();
    expect(snapshot.main.loafCount).toBeNull();
    expect(snapshot.probe).toBeNull();
  });

  it("caps loaf script attribution to three entries with bounded urls", () => {
    const snapshot = buildPerfSnapshot({
      seq: 1,
      durationMs: 5_000,
      frameMs: [16, 17],
      jsHeapMb: null,
      main: mainSample({
        loafTopScripts: [
          { url: `https://app/${"a".repeat(400)}.js`, ms: 90 },
          { url: "https://app/b.js", ms: 50 },
          { url: "https://app/c.js", ms: 40 },
          { url: "https://app/d.js", ms: 30 },
        ],
      }),
      probe: null,
    });
    expect(snapshot.main.loafTopScripts).toHaveLength(3);
    expect(snapshot.main.loafTopScripts[0].url.length).toBeLessThanOrEqual(160);
  });
});

describe("clampProbeSample", () => {
  it("rounds counts and drops non-finite values", () => {
    const clamped = clampProbeSample(
      probeSample({
        drawCalls: 12.7,
        triangles: Number.NaN,
        gpuFrameMs: 123_456_789,
      }),
    );
    expect(clamped.drawCalls).toBe(13);
    expect(clamped.triangles).toBeNull();
    expect(clamped.gpuFrameMs).toBe(10_000);
  });

  it("bounds diagnostics entry count and string lengths", () => {
    const canvasDiagnostics: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) {
      canvasDiagnostics[`key${i}`] = "x".repeat(200);
    }
    const clamped = clampProbeSample(probeSample({ canvasDiagnostics }));
    expect(Object.keys(clamped.canvasDiagnostics)).toHaveLength(20);
    for (const value of Object.values(clamped.canvasDiagnostics)) {
      expect(value.length).toBeLessThanOrEqual(32);
    }
  });
});
