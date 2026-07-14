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
const sql = vi.fn(async () => []);

function sample(overrides: Record<string, unknown> = {}) {
  return {
    source: "mine",
    appVersion: "0.1.80",
    appBuild: 123,
    mineVersion: 41,
    durationMs: 12_000,
    frameCount: 720,
    avgFrameMs: 16.7,
    p50FrameMs: 16.3,
    p95FrameMs: 28.4,
    maxFrameMs: 66.1,
    longFrameCount: 4,
    drawCallsAvg: 126.4,
    drawCallsMax: 144,
    viewportWidth: 1366,
    viewportHeight: 768,
    devicePixelRatio: 1,
    hardwareConcurrency: 4,
    deviceMemoryGb: 8,
    renderer: "webgpu-auto",
    visibilityState: "visible",
    ...overrides,
  };
}

function submit(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/performance", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Vitest",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("performance API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.mockResolvedValue(sql as never);
    mockedStorageConfigured.mockReturnValue(true);
    mockedPlayer.mockResolvedValue("player-1");
  });

  it("saves a mine performance sample for the active player", async () => {
    const res = await submit(sample());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ saved: true });
    expect(mockedPlayer).toHaveBeenCalledOnce();
    const [strings, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const query = strings.join("");
    expect(query).toContain("INSERT INTO player_performance_samples");
    expect(values).toEqual([
      "player-1",
      "mine",
      "0.1.80",
      123,
      41,
      12_000,
      720,
      16.7,
      16.3,
      28.4,
      66.1,
      4,
      126.4,
      144,
      1366,
      768,
      1,
      4,
      8,
      "webgpu-auto",
      "visible",
      "Vitest",
    ]);
  });

  it("saves a first-person bunker sample under its own source (F-100)", async () => {
    const res = await submit(sample({ source: "bunker-fp" }));

    expect(res.status).toBe(200);
    const [, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    // second bound value is the source column
    expect(values[1]).toBe("bunker-fp");
  });

  it("rejects an unknown telemetry source", async () => {
    const res = await submit(sample({ source: "totally-not-a-surface" }));

    expect(res.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });

  it("rejects invalid samples", async () => {
    const res = await submit(sample({ frameCount: 0, avgFrameMs: -1 }));

    expect(res.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });

  it("returns unavailable when storage is not configured", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await submit(sample());

    expect(res.status).toBe(503);
    expect(sql).not.toHaveBeenCalled();
  });
});
