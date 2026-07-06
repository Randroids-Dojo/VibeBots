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
    viewport_width: 1440,
    viewport_height: 900,
    device_pixel_ratio: 2,
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
    long_task_total_ms: 8,
    loaf_total_ms: 30,
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
    expect((body.overview as { snapshots: number }).snapshots).toBe(2);
    const segments = body.segments as { segment: string; snapshots: number }[];
    expect(segments[0].segment).toBe("mine/webgpu-auto/high");
    expect(JSON.stringify(body)).not.toContain("player");
    expect(JSON.stringify(body)).not.toContain("aaaabbbbccccdddd");
    const [strings, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(strings.join("")).toContain("FROM player_perf_traces");
    expect(values).toContain(48);
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
