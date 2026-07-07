import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { GET } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);

function record(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-07-06T12:00:00.000Z",
    source: "mine",
    renderer: "webgpu-auto",
    backend: "webgpu",
    quality_tier: "high",
    app_version: "0.1.197.900",
    app_build: 900,
    ab_variant: null,
    session_id: "aaaabbbbccccdddd",
    seq: 1,
    viewport_width: 1440,
    viewport_height: 900,
    device_pixel_ratio: 2,
    p50_frame_ms: 16.2,
    p95_frame_ms: 22,
    avg_frame_ms: 16.8,
    max_frame_ms: 44,
    long_frame_count: 1,
    stall_count: 0,
    gpu_frame_ms: 5.1,
    draw_calls: 128,
    triangles: 260_000,
    light_count: 5,
    shadow_light_count: 1,
    particle_count: 18,
    mesh_count: 300,
    instance_count: 640,
    geometries: 52,
    textures: 12,
    js_heap_mb: 210,
    heap_min_mb: 180,
    heap_max_mb: 240,
    hidden_ms: 0,
    visibility_change_count: 0,
    net_request_count: 2,
    net_transfer_kb: 44.5,
    net_total_ms: 210,
    net_max_ms: 150,
    long_task_total_ms: 8,
    loaf_total_ms: 30,
    loaf_max_ms: 25,
    detail: {
      lightsByType: { PointLight: 2 },
      canvasDiagnostics: { renderedCellCount: "180" },
      loafTopScripts: [
        { url: "https://app/chunk.js", invoker: "TimerHandler", ms: 24 },
      ],
      netTopRequests: [{ path: "/api/mine", ms: 150, kb: 6 }],
      spriteCount: 0,
    },
    gpu: "apple m2",
    ...overrides,
  };
}

describe("performance insights API route", () => {
  const sql = vi.fn(async () => [record(), record({ p95_frame_ms: 90 })]);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.mockResolvedValue(sql as never);
    mockedStorageConfigured.mockReturnValue(true);
  });

  it("aggregates recent traces into anonymized rollups", async () => {
    const res = await GET(
      new Request("http://localhost/api/performance/insights?hours=48"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.windowHours).toBe(48);
    expect(body.sessionDetail).toBeNull();
    expect((body.overview as { snapshots: number }).snapshots).toBe(2);
    const segments = body.segments as { segment: string; snapshots: number }[];
    expect(segments[0].segment).toBe("mine/webgpu-auto/high");
    const sessions = body.sessions as {
      session: string;
      softwareRenderer: boolean;
      snapshots: number;
    }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session).toBe("aaaabb");
    expect(sessions[0].softwareRenderer).toBe(false);
    const worst = body.worst as {
      loafTopScripts: { url: string }[];
      netTopRequests: { path: string }[];
    }[];
    expect(worst[0].loafTopScripts[0].url).toBe("https://app/chunk.js");
    expect(worst[0].netTopRequests[0].path).toBe("/api/mine");
    expect(JSON.stringify(body)).not.toContain("player");
    expect(JSON.stringify(body)).not.toContain("aaaabbbbccccdddd");
    const [strings, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(strings.join("")).toContain("FROM player_perf_traces");
    expect(values).toContain(48);
  });

  it("narrows to one session and returns the per-snapshot drilldown", async () => {
    const res = await GET(
      new Request("http://localhost/api/performance/insights?session=aaaabb"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.session).toBe("aaaabb");
    const detail = body.sessionDetail as Record<string, unknown>[];
    expect(detail).toHaveLength(2);
    const first = detail[0] as {
      loafTopScripts: { url: string; invoker: string | null }[];
      netTopRequests: { path: string }[];
      canvasDiagnostics: Record<string, string>;
      heapMaxMb: number;
    };
    expect(first.loafTopScripts[0].invoker).toBe("TimerHandler");
    expect(first.netTopRequests[0].path).toBe("/api/mine");
    expect(first.canvasDiagnostics.renderedCellCount).toBe("180");
    expect(first.heapMaxMb).toBe(240);
    const [, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(values).toContain("aaaabb");
  });

  it("ignores malformed session prefixes", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/performance/insights?session=DROP%20TABLE",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.session).toBeNull();
    expect(body.sessionDetail).toBeNull();
  });

  it("filters to real hardware with device=real", async () => {
    const res = await GET(
      new Request("http://localhost/api/performance/insights?device=real"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.device).toBe("real");
    const [strings, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(strings.join("")).toContain("gpu !~*");
    expect(values).toContain(true);
  });

  it("isolates the harness with device=software", async () => {
    const res = await GET(
      new Request("http://localhost/api/performance/insights?device=software"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.device).toBe("software");
    const [strings] = sql.mock.calls[0] as unknown as [TemplateStringsArray];
    expect(strings.join("")).toContain("gpu ~*");
  });

  it("clamps the hours window and filters by source", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/performance/insights?hours=9999&source=arena",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.windowHours).toBe(168);
    expect(body.source).toBe("arena");
    const [, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(values).toContain("arena");
  });

  it("returns unavailable when storage is not configured", async () => {
    mockedStorageConfigured.mockReturnValue(false);
    const res = await GET(
      new Request("http://localhost/api/performance/insights"),
    );
    expect(res.status).toBe(503);
  });
});
