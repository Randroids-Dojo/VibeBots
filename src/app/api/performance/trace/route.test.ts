import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { POST } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const sql = Object.assign(
  vi.fn(async () => []),
  {
    transaction: vi.fn(async (queries: unknown[]) => queries.map(() => [])),
  },
);

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    seq: 1,
    durationMs: 5_000,
    frameCount: 300,
    avgFrameMs: 16.7,
    p50FrameMs: 16.3,
    p95FrameMs: 24.9,
    maxFrameMs: 120.4,
    longFrameCount: 2,
    stallCount: 0,
    jsHeapMb: 182.4,
    main: {
      longTaskCount: 1,
      longTaskTotalMs: 62.1,
      loafCount: 1,
      loafTotalMs: 61.2,
      loafMaxMs: 61.2,
      loafTopScripts: [{ url: "https://app/main.js", ms: 48.5 }],
      inputEventCount: 2,
      inputEventMaxMs: 55.1,
    },
    probe: {
      backend: "webgpu",
      drawCalls: 130,
      triangles: 220_000,
      geometries: 48,
      textures: 11,
      meshCount: 310,
      instancedMeshCount: 3,
      instanceCount: 720,
      lightCount: 5,
      shadowLightCount: 1,
      spriteCount: 0,
      visibleObjectCount: 420,
      materialCount: 30,
      particleCount: 24,
      gpuFrameMs: 4.9,
      lightsByType: { PointLight: 2 },
      canvasDiagnostics: { frameMs: "16.4" },
    },
    ...overrides,
  };
}

function trace(overrides: Record<string, unknown> = {}) {
  return {
    source: "mine",
    sessionId: "aaaabbbbccccdddd",
    appVersion: "0.1.197.900",
    appBuild: 900,
    mineVersion: 41,
    renderer: "webgpu-auto",
    qualityTier: "high",
    abVariant: null,
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 2,
    hardwareConcurrency: 10,
    deviceMemoryGb: 8,
    gpu: "apple m2",
    connectionType: "4g",
    visibilityState: "visible",
    snapshots: [snapshot()],
    ...overrides,
  };
}

function submit(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/performance/trace", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Vitest",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("performance trace API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.mockResolvedValue(sql as never);
    mockedStorageConfigured.mockReturnValue(true);
    mockedPlayer.mockResolvedValue("player-1");
  });

  it("inserts one row per snapshot for the active player", async () => {
    const res = await submit(
      trace({ snapshots: [snapshot(), snapshot({ seq: 2 })] }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ saved: 2 });
    expect(mockedPlayer).toHaveBeenCalledOnce();
    // One atomic batch: two snapshot inserts plus the retention purge.
    expect(sql.transaction).toHaveBeenCalledOnce();
    expect(sql.transaction.mock.calls[0][0]).toHaveLength(3);
    expect(sql).toHaveBeenCalledTimes(3);
    const [strings, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const query = strings.join("");
    expect(query).toContain("INSERT INTO player_perf_traces");
    expect(query).toContain("ON CONFLICT (session_id, seq) DO NOTHING");
    const purge = (
      sql.mock.calls[2] as unknown as [TemplateStringsArray]
    )[0].join("");
    expect(purge).toContain("DELETE FROM player_perf_traces");
    expect(values).toContain("player-1");
    expect(values).toContain("aaaabbbbccccdddd");
    expect(values).toContain("webgpu");
    expect(values).toContain(130);
    expect(values).toContain("Vitest");
    const detail = values.find(
      (value) => typeof value === "string" && value.includes("lightsByType"),
    ) as string;
    expect(JSON.parse(detail)).toEqual({
      lightsByType: { PointLight: 2 },
      canvasDiagnostics: { frameMs: "16.4" },
      loafTopScripts: [{ url: "https://app/main.js", ms: 48.5 }],
      spriteCount: 0,
    });
  });

  it("accepts a probe-less snapshot from a page without a canvas probe", async () => {
    const res = await submit(trace({ snapshots: [snapshot({ probe: null })] }));
    expect(res.status).toBe(200);
  });

  it("rejects unknown sources", async () => {
    const res = await submit(trace({ source: "menu" }));
    expect(res.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });

  it("rejects a probe with too many light types", async () => {
    const base = snapshot() as { probe: Record<string, unknown> };
    const res = await submit(
      trace({
        snapshots: [
          snapshot({
            probe: {
              ...base.probe,
              lightsByType: Object.fromEntries(
                Array.from({ length: 21 }, (_, index) => [`Light${index}`, 1]),
              ),
            },
          }),
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  it("rejects oversized batches", async () => {
    const res = await submit(
      trace({
        snapshots: Array.from({ length: 25 }, (_, index) =>
          snapshot({ seq: index + 1 }),
        ),
      }),
    );
    expect(res.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });

  it("returns unavailable when storage is not configured", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await submit(trace());

    expect(res.status).toBe(503);
    expect(sql).not.toHaveBeenCalled();
  });
});
