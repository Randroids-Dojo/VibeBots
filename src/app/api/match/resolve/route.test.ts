import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPlayerAchievements } from "@/server/achievements";
import { storageConfigured } from "@/server/db";
import { recordMatchResult } from "@/server/match-records";
import { validatePlayerDesignInventory } from "@/server/part-inventory";
import { SIM_VERSION } from "@/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "@/sim/design";
import { resolveMatch } from "@/sim/resolve";
import { POST } from "./route";

vi.mock("@/server/db", () => ({
  storageConfigured: vi.fn(() => true),
  db: vi.fn(async () => vi.fn(async () => [])),
}));

vi.mock("@/server/match-records", () => ({
  recordMatchResult: vi.fn(async () => undefined),
  loadMatchRecordSummary: vi.fn(async () => ({
    wins: 1,
    losses: 0,
    draws: 0,
    recent: [],
  })),
}));

vi.mock("@/server/achievements", () => ({
  refreshPlayerAchievements: vi.fn(async () => []),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

vi.mock("@/server/part-inventory", () => ({
  validatePlayerDesignInventory: vi.fn(async () => ({ ok: true })),
}));

const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedRecordMatchResult = vi.mocked(recordMatchResult);
const mockedRefreshPlayerAchievements = vi.mocked(refreshPlayerAchievements);
const mockedValidatePlayerDesignInventory = vi.mocked(
  validatePlayerDesignInventory,
);

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/match/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/match/resolve", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedValidatePlayerDesignInventory.mockResolvedValue({ ok: true });
  });

  it("returns the official result matching an independent local run", async () => {
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION,
      timeLimitTicks: 600,
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // The hybrid-authority assertion: an independent simulation of the
    // same designs produces the identical result hash.
    const local = await resolveMatch(
      [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      600,
    );
    expect(body.hash).toBe(local.hash);
    expect(local.status.over).toBe(true);
    if (local.status.over) {
      expect(body.status.winner).toBe(local.status.winner);
    }
    expect(body.tick).toBe(local.tick);
    expect(body.rewards[0].credits).toBe(local.rewards[0].credits);
  });

  it("rejects stale sim versions", async () => {
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION - 1,
    });
    expect(res.status).toBe(409);
  });

  it("rejects invalid designs with the validity errors", async () => {
    const res = await post({
      designs: [
        {
          name: "broken",
          parts: [{ iid: "x", partId: "ram-spike" }],
          connections: [],
        },
        TEST_BOT_DESIGN,
      ],
      simVersion: SIM_VERSION,
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.issues.join(" ")).toContain("core");
  });

  it("checks the requested player design when inventory enforcement is enabled", async () => {
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION,
      timeLimitTicks: 600,
      enforceInventory: true,
      inventoryDesignIndex: 1,
    });
    expect(res.status).toBe(200);
    expect(mockedValidatePlayerDesignInventory).toHaveBeenCalledWith(
      "player-1",
      expect.objectContaining({ name: TEST_BOT_DESIGN.name }),
    );
  });

  it("rejects malformed bodies", async () => {
    const res = await post({ nope: true });
    expect(res.status).toBe(400);
  });
});

describe("match record persistence (B4)", () => {
  it("records verified player fights and returns the summary", async () => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedRecordMatchResult.mockClear();
    mockedRefreshPlayerAchievements.mockClear();
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION,
      timeLimitTicks: 120,
      enforceInventory: true,
      inventoryDesignIndex: 1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hash: string;
      record: { wins: number } | null;
    };
    expect(body.record).toEqual({ wins: 1, losses: 0, draws: 0, recent: [] });
    expect(mockedRecordMatchResult).toHaveBeenCalledTimes(1);
    const [, playerId, record] = mockedRecordMatchResult.mock.calls[0];
    expect(playerId).toBe("player-1");
    expect(record.botName).toBe(TEST_BOT_DESIGN.name);
    expect(record.opponentName).toBe(CPU_BRAWLER_DESIGN.name);
    expect(["win", "loss", "draw"]).toContain(record.outcome);
    expect(record.resultHash).toBe(body.hash);
    expect(record.usedPartIds).toContain("ram-spike");
    expect(mockedRefreshPlayerAchievements).toHaveBeenCalledTimes(1);
  });

  it("persists nothing for anonymous resolves", async () => {
    mockedRecordMatchResult.mockClear();
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION,
      timeLimitTicks: 120,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record: unknown };
    expect(body.record).toBeNull();
    expect(mockedRecordMatchResult).not.toHaveBeenCalled();
  });
});
