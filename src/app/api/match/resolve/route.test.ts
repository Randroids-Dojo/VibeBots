import { beforeEach, describe, expect, it, vi } from "vitest";
import { storageConfigured } from "@/server/db";
import { validatePlayerDesignInventory } from "@/server/part-inventory";
import { SIM_VERSION } from "@/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "@/sim/design";
import { resolveMatch } from "@/sim/resolve";
import { POST } from "./route";

vi.mock("@/server/db", () => ({
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

vi.mock("@/server/part-inventory", () => ({
  validatePlayerDesignInventory: vi.fn(async () => ({ ok: true })),
}));

const mockedStorageConfigured = vi.mocked(storageConfigured);
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
