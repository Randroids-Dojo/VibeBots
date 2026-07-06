import { describe, expect, it } from "vitest";
import { type PerfInsightRow, summarizePerfInsights } from "./perf-insights";

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
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 2,
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
    longTaskTotalMs: 12,
    loafTotalMs: 60,
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
});
