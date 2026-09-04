import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPlayerAchievements } from "@/server/achievements";
import { storageConfigured } from "@/server/db";
import { recordMatchResult } from "@/server/match-records";
import { validatePlayerDesignInventory } from "@/server/part-inventory";
import { SIM_VERSION } from "@/sim/constants";
import {
  CPU_BRAWLER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  RULE_ACTIONS,
  RULE_CONDITIONS,
  TEST_BOT_DESIGN,
} from "@/sim/design";
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
  refreshPlayerAchievements: vi.fn(async () => ({
    achievements: [],
    newlyUnlocked: [],
  })),
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

  it("states the official teardown, not just the winner (F-239)", async () => {
    const res = await post({
      designs: [CPU_WHIRLIGIG_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION,
      timeLimitTicks: 900,
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Post-match damage attribution is a match fact, so the authoritative
    // rerun must report it rather than leaving the player's teardown
    // entirely client-authored.
    expect(body.teardown).not.toBeNull();
    expect(body.teardown.bots).toHaveLength(2);
    expect(body.teardown.totalImpacts).toBeGreaterThan(0);
    for (const [index, bot] of body.teardown.bots.entries()) {
      expect(bot.parts.map((part: { iid: string }) => part.iid)).toEqual(
        [CPU_WHIRLIGIG_DESIGN, TEST_BOT_DESIGN][index].parts.map((p) => p.iid),
      );
    }
  });

  it("rejects a gear ratio that is not a buildable preset (F-238)", async () => {
    // The server accepts exactly what the workshop can build, so a
    // hand-authored design cannot fight with unavailable reduction.
    const cheating = {
      ...TEST_BOT_DESIGN,
      connections: TEST_BOT_DESIGN.connections.map((conn) =>
        conn.parentConnector.startsWith("axle")
          ? { ...conn, gearRatio: 3.5 }
          : conn,
      ),
    };
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, cheating],
      simVersion: SIM_VERSION,
      timeLimitTicks: 600,
    });
    expect(res.status).toBe(400);
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
    expect(record.ruleCount).toBe(0);
    expect(mockedRefreshPlayerAchievements).toHaveBeenCalledTimes(1);
  });

  it("records how many bench rules the player's design carried (F-252)", async () => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedRecordMatchResult.mockClear();
    const ruled = {
      ...TEST_BOT_DESIGN,
      rules: [{ when: RULE_CONDITIONS[0], act: RULE_ACTIONS[0] }],
    };
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, ruled],
      simVersion: SIM_VERSION,
      timeLimitTicks: 120,
      enforceInventory: true,
      inventoryDesignIndex: 1,
    });
    expect(res.status).toBe(200);
    const [, , record] = mockedRecordMatchResult.mock.calls[0];
    expect(record.ruleCount).toBe(1);
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
