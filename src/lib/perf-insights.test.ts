import { describe, expect, it } from "vitest";
import {
  isSoftwareGpu,
  type PerfInsightRow,
  summarizePerfInsights,
  summarizePerfSession,
} from "./perf-insights";

function row(overrides: Partial<PerfInsightRow> = {}): PerfInsightRow {
  return {
    createdAt: "2026-07-06T12:00:00.000Z",
    source: "mine",
    renderer: "webgpu-auto",
    backend: "webgpu",
    qualityTier: "high",
    appVersion: "0.1.197.900",
    appBuild: 900,
    abVariant: null,
    sessionId: "aaaabbbbccccdddd",
    seq: 1,
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 2,
    p50FrameMs: 16,
    p95FrameMs: 20,
    avgFrameMs: 16.5,
    maxFrameMs: 40,
    longFrameCount: 1,
    stallCount: 0,
    gpuFrameMs: 5,
    drawCalls: 120,
    triangles: 250_000,
    lightCount: 5,
    shadowLightCount: 1,
    particleCount: 30,
    meshCount: 280,
    instanceCount: 700,
    geometries: 60,
    textures: 14,
    jsHeapMb: 190,
    heapMinMb: 170,
    heapMaxMb: 210,
    hiddenMs: 0,
    visibilityChangeCount: 0,
    netRequestCount: 2,
    netTransferKb: 40,
    netTotalMs: 180,
    netMaxMs: 120,
    longTaskTotalMs: 12,
    loafTotalMs: 60,
    loafMaxMs: 55,
    loafTopScripts: [],
    netTopRequests: [],
    canvasDiagnostics: {},
    gpu: "apple m2",
    ...overrides,
  };
}

describe("summarizePerfInsights", () => {
  it("returns empty-safe output for no rows", () => {
    const insights = summarizePerfInsights([]);
    expect(insights.overview.snapshots).toBe(0);
    expect(insights.overview.firstAt).toBeNull();
    expect(insights.segments).toEqual([]);
    expect(insights.worst).toEqual([]);
  });

  it("groups segments by source, renderer, and tier", () => {
    const insights = summarizePerfInsights([
      row(),
      row({ p95FrameMs: 30 }),
      row({
        source: "arena",
        renderer: "webgl2-forced",
        qualityTier: "low",
        sessionId: "1111222233334444",
        p95FrameMs: 80,
      }),
    ]);
    expect(insights.overview.snapshots).toBe(3);
    expect(insights.overview.sessions).toBe(2);
    expect(insights.overview.sources).toEqual({ mine: 2, arena: 1 });
    const mineSegment = insights.segments.find(
      (segment) => segment.segment === "mine/webgpu-auto/high",
    );
    expect(mineSegment?.snapshots).toBe(2);
    expect(mineSegment?.avgP95FrameMs).toBe(25);
    expect(mineSegment?.worstP95FrameMs).toBe(30);
    const arenaSegment = insights.segments.find(
      (segment) => segment.segment === "arena/webgl2-forced/low",
    );
    expect(arenaSegment?.snapshots).toBe(1);
  });

  it("buckets factors and skips rows without the factor", () => {
    const insights = summarizePerfInsights([
      row({ drawCalls: 40, p95FrameMs: 10 }),
      row({ drawCalls: 40, p95FrameMs: 20 }),
      row({ drawCalls: 400, p95FrameMs: 90 }),
      row({ drawCalls: null, p95FrameMs: 500 }),
    ]);
    const drawCalls = insights.factors.find(
      (factor) => factor.factor === "drawCalls",
    );
    expect(drawCalls?.buckets).toEqual([
      { label: "<=50", snapshots: 2, avgP95FrameMs: 15, avgGpuFrameMs: 5 },
      { label: ">250", snapshots: 1, avgP95FrameMs: 90, avgGpuFrameMs: 5 },
    ]);
  });

  it("lists worst snapshots without identifying fields", () => {
    const insights = summarizePerfInsights([
      row({ p95FrameMs: 10 }),
      row({ p95FrameMs: 120, sessionId: "deadbeefdeadbeef" }),
    ]);
    expect(insights.worst[0].p95FrameMs).toBe(120);
    expect(insights.worst[0].session).toBe("deadbe");
    expect(insights.worst[0].viewport).toBe("1440x900");
    expect(Object.keys(insights.worst[0])).not.toContain("sessionId");
    expect(Object.keys(insights.worst[0])).not.toContain("userAgent");
  });

  it("splits builds and variants for A/B comparison", () => {
    const insights = summarizePerfInsights([
      row({ appBuild: 900, p95FrameMs: 30 }),
      row({ appBuild: 901, p95FrameMs: 18 }),
      row({ abVariant: "shadows-off", p95FrameMs: 12 }),
    ]);
    expect(insights.byBuild.map((segment) => segment.segment).sort()).toEqual([
      "build 900",
      "build 901",
    ]);
    expect(
      insights.byVariant.find(
        (segment) => segment.segment === "variant shadows-off",
      )?.avgP95FrameMs,
    ).toBe(12);
  });

  it("carries total stalls, worst max frame, and heap span in rollups (F-103)", () => {
    const insights = summarizePerfInsights([
      row({ stallCount: 2, maxFrameMs: 40, heapMinMb: 170, heapMaxMb: 210 }),
      row({ stallCount: 3, maxFrameMs: 90, heapMinMb: 150, heapMaxMb: 260 }),
    ]);
    const segment = insights.segments.find(
      (candidate) => candidate.segment === "mine/webgpu-auto/high",
    );
    expect(segment?.stallCount).toBe(5);
    expect(segment?.worstMaxFrameMs).toBe(90);
    expect(segment?.heapMinMb).toBe(150);
    expect(segment?.heapMaxMb).toBe(260);
  });

  it("omits the per-build rollup for a mixed surface (F-103)", () => {
    const mixed = summarizePerfInsights([
      row({ appBuild: 900 }),
      row({
        source: "bunker-fp",
        appBuild: 900,
        sessionId: "1111222233334444",
      }),
    ]);
    expect(mixed.byBuild).toEqual([]);
    const homogeneous = summarizePerfInsights([
      row({ appBuild: 900, p95FrameMs: 30 }),
      row({ appBuild: 901, p95FrameMs: 18 }),
    ]);
    expect(
      homogeneous.byBuild.map((segment) => segment.segment).sort(),
    ).toEqual(["build 900", "build 901"]);
  });

  it("rolls up sessions with totals and a software-renderer flag", () => {
    const insights = summarizePerfInsights([
      row({ stallCount: 1, hiddenMs: 500, createdAt: "2026-07-06T12:00:00Z" }),
      row({
        stallCount: 2,
        hiddenMs: 1500,
        seq: 2,
        maxFrameMs: 1441.9,
        createdAt: "2026-07-06T12:00:05Z",
      }),
      row({
        sessionId: "9999888877776666",
        gpu: "ANGLE (Google, Vulkan (SwiftShader Device), SwiftShader driver)",
        createdAt: "2026-07-06T13:00:00Z",
      }),
    ]);
    expect(insights.sessions).toHaveLength(2);
    const [probe, pixel] = insights.sessions;
    expect(probe.session).toBe("999988");
    expect(probe.softwareRenderer).toBe(true);
    expect(pixel.session).toBe("aaaabb");
    expect(pixel.softwareRenderer).toBe(false);
    expect(pixel.snapshots).toBe(2);
    expect(pixel.stallCount).toBe(3);
    expect(pixel.hiddenMs).toBe(2000);
    expect(pixel.maxFrameMs).toBe(1441.9);
    expect(pixel.firstAt).toBe("2026-07-06T12:00:00Z");
    expect(pixel.lastAt).toBe("2026-07-06T12:00:05Z");
  });

  it("expands one session into ordered attributed snapshots", () => {
    const detail = summarizePerfSession([
      row({
        seq: 2,
        createdAt: "2026-07-06T12:00:05Z",
        loafTopScripts: [
          { url: "https://app/chunk.js", invoker: "TimerHandler", ms: 900 },
        ],
        netTopRequests: [{ path: "/api/mine", ms: 420, kb: 8 }],
        canvasDiagnostics: { renderedCellCount: "220" },
      }),
      row({ seq: 1, createdAt: "2026-07-06T12:00:00Z" }),
    ]);
    expect(detail.map((snapshot) => snapshot.seq)).toEqual([1, 2]);
    expect(detail[1].loafTopScripts[0].invoker).toBe("TimerHandler");
    expect(detail[1].netTopRequests[0].path).toBe("/api/mine");
    expect(detail[1].canvasDiagnostics.renderedCellCount).toBe("220");
  });

  it("passes attribution through to worst snapshots", () => {
    const insights = summarizePerfInsights([
      row({
        p95FrameMs: 300,
        loafTopScripts: [
          { url: "https://app/chunk.js", invoker: null, ms: 900 },
        ],
        netTopRequests: [{ path: "/api/mine", ms: 420, kb: 8 }],
        hiddenMs: 1200,
        heapMinMb: 100,
        heapMaxMb: 400,
      }),
    ]);
    expect(insights.worst[0].loafTopScripts[0].url).toBe(
      "https://app/chunk.js",
    );
    expect(insights.worst[0].netTopRequests[0].ms).toBe(420);
    expect(insights.worst[0].hiddenMs).toBe(1200);
    expect(insights.worst[0].heapMaxMb).toBe(400);
  });
});

describe("isSoftwareGpu", () => {
  it("flags headless harness gpu strings only", () => {
    expect(isSoftwareGpu("ANGLE (SwiftShader driver)")).toBe(true);
    expect(isSoftwareGpu("Mesa llvmpipe (LLVM 15.0.7)")).toBe(true);
    expect(isSoftwareGpu("arm valhall")).toBe(false);
    expect(isSoftwareGpu(null)).toBe(false);
  });
});
