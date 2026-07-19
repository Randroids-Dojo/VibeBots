import { describe, expect, it } from "vitest";
import { collectCanvasDiagnostics } from "@/components/perf-probe";
import {
  buildPerfSnapshot,
  clampNetworkSample,
  clampProbeSample,
  type PerfMainThreadSample,
  type PerfNetworkSample,
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
    loafTopScripts: [
      {
        url: "https://app/main.js",
        invoker: "FrameRequestCallback",
        ms: 61.29,
      },
    ],
    inputEventCount: 3,
    inputEventMaxMs: 72.19,
    ...overrides,
  };
}

function netSample(
  overrides: Partial<PerfNetworkSample> = {},
): PerfNetworkSample {
  return {
    requestCount: 4,
    transferKb: 120.46,
    totalMs: 512.33,
    maxMs: 260.08,
    topRequests: [{ path: "/api/mine", ms: 260.08, kb: 4.21 }],
    ...overrides,
  };
}

const snapshotDefaults = {
  jsHeapMb: null,
  heapMinMb: null,
  heapMaxMb: null,
  hiddenMs: 0,
  visibilityChangeCount: 0,
  net: null,
};

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
      ...snapshotDefaults,
      seq: 3,
      durationMs: 5_001.7,
      frameMs: [16, 16, 17, 55, 300],
      jsHeapMb: 181.5,
      heapMinMb: 160.24,
      heapMaxMb: 205.87,
      hiddenMs: 120.6,
      visibilityChangeCount: 2,
      main: mainSample(),
      net: netSample(),
      probe: probeSample(),
    });
    expect(snapshot.seq).toBe(3);
    expect(snapshot.durationMs).toBe(5_002);
    expect(snapshot.frameCount).toBe(5);
    expect(snapshot.longFrameCount).toBe(2);
    expect(snapshot.stallCount).toBe(1);
    expect(snapshot.maxFrameMs).toBe(300);
    expect(snapshot.jsHeapMb).toBe(181.5);
    expect(snapshot.heapMinMb).toBe(160.24);
    expect(snapshot.heapMaxMb).toBe(205.87);
    expect(snapshot.hiddenMs).toBe(121);
    expect(snapshot.visibilityChangeCount).toBe(2);
    expect(snapshot.main.longTaskTotalMs).toBe(120.3);
    expect(snapshot.main.loafTopScripts).toEqual([
      {
        url: "https://app/main.js",
        invoker: "FrameRequestCallback",
        ms: 61.3,
      },
    ]);
    expect(snapshot.net).toEqual({
      requestCount: 4,
      transferKb: 120.5,
      totalMs: 512.3,
      maxMs: 260.1,
      topRequests: [{ path: "/api/mine", ms: 260.1, kb: 4.2 }],
    });
    expect(snapshot.probe?.drawCalls).toBe(120);
    expect(snapshot.probe?.gpuFrameMs).toBe(4.3);
  });

  it("tolerates missing browser capabilities", () => {
    const snapshot = buildPerfSnapshot({
      ...snapshotDefaults,
      seq: 1,
      durationMs: 5_000,
      frameMs: [16, 17, 18],
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
    expect(snapshot.heapMinMb).toBeNull();
    expect(snapshot.hiddenMs).toBe(0);
    expect(snapshot.main.loafCount).toBeNull();
    expect(snapshot.net).toBeNull();
    expect(snapshot.probe).toBeNull();
  });

  it("caps loaf script attribution to three entries with bounded urls", () => {
    const snapshot = buildPerfSnapshot({
      ...snapshotDefaults,
      seq: 1,
      durationMs: 5_000,
      frameMs: [16, 17],
      main: mainSample({
        loafTopScripts: [
          { url: `https://app/${"a".repeat(400)}.js`, invoker: null, ms: 90 },
          { url: "https://app/b.js", invoker: null, ms: 50 },
          { url: "https://app/c.js", invoker: null, ms: 40 },
          { url: "https://app/d.js", invoker: null, ms: 30 },
        ],
      }),
      probe: null,
    });
    expect(snapshot.main.loafTopScripts).toHaveLength(3);
    expect(snapshot.main.loafTopScripts[0].url.length).toBeLessThanOrEqual(160);
  });
});

describe("clampNetworkSample", () => {
  it("caps request lists and bounds path lengths", () => {
    const clamped = clampNetworkSample(
      netSample({
        topRequests: [
          { path: `/api/${"x".repeat(400)}`, ms: 90.55, kb: null },
          { path: "/api/b", ms: 50, kb: 1.005 },
          { path: "/api/c", ms: 40, kb: 2 },
          { path: "/api/d", ms: 30, kb: 3 },
        ],
      }),
    );
    expect(clamped.topRequests).toHaveLength(3);
    expect(clamped.topRequests[0].path.length).toBeLessThanOrEqual(120);
    expect(clamped.topRequests[0].kb).toBeNull();
    expect(clamped.topRequests[1].kb).toBe(1);
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

describe("first-person diagnostics reach a bunker-fp payload (F-101)", () => {
  it("collects the fp diagnostics for a bunker-fp source and they survive payload clamping", () => {
    // The bunker-fp canvas publishes these on its dataset each snapshot.
    const dataset = {
      frameMs: "16.4",
      fpEyeY: "0.72",
      fpOpenCells: "18",
      fpGrounded: "1",
      fpSwinging: "0",
      // High-cardinality aim data and mine keys must not survive.
      fpTarget: "3,2,1",
      renderedCellCount: "180",
    };
    const probe = probeSample({
      canvasDiagnostics: collectCanvasDiagnostics(dataset, "bunker-fp"),
    });
    const clamped = clampProbeSample(probe);
    expect(clamped.canvasDiagnostics).toEqual({
      frameMs: "16.4",
      fpEyeY: "0.72",
      fpOpenCells: "18",
      fpGrounded: "1",
      fpSwinging: "0",
    });
  });
});
