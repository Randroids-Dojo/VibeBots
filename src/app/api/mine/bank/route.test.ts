import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import {
  DEFAULT_GEAR,
  MINE_VERSION,
  NO_CONSUMABLES,
  STARTING_CONSUMABLES,
} from "@/sim/mine";
import { POST } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/player")>();
  return {
    ...actual,
    getOrCreatePlayerId: vi.fn(async () => "player-1"),
  };
});

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);

const ownedBase = {
  pickaxe_level: 1,
  lamp_level: 1,
  cargo_level: 1,
  lantern_level: 1,
  warpcoil_level: 1,
  elevator_depth: 0,
  blast_level: 1,
  elevator_speed_level: 1,
  fall_level: 1,
  dynamite_count: 0,
  rope_count: 0,
  ladder_count: 0,
  plank_count: 0,
  beacon_count: 0,
  emeralds: 0,
  support_kit_granted_at: "2026-06-17T00:00:00.000Z",
};

function post(overrides: Record<string, unknown> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/mine/bank", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seed: 123,
        tripIndex: 0,
        moves: ["down"],
        mineVersion: MINE_VERSION,
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        ...overrides,
      }),
    }),
  );
}

function mockSql(
  owned: Record<string, unknown> = ownedBase,
  options: { seed?: number } = {},
) {
  const worldSeed = options.seed ?? 123;
  const sql = vi.fn(async () => {
    const calls = sql.mock.calls as unknown as Array<[TemplateStringsArray]>;
    const strings = calls[calls.length - 1]?.[0];
    const query = strings?.join(" ") ?? "";
    if (query.includes("SELECT seed, diff, trip_count")) {
      return [{ seed: worldSeed, diff: [], trip_count: 0 }];
    }
    if (query.includes("SELECT pickaxe_level")) return [owned];
    if (query.includes("support_kit_granted_at = now()")) {
      return [
        {
          ladder_count: 8,
          plank_count: 4,
          support_kit_granted_at: "2026-06-17T00:00:00.000Z",
        },
      ];
    }
    return [
      {
        emeralds: 12,
        deepest_depth: 1,
        bonus: 0,
        trip_count: 1,
      },
    ];
  });
  mockedDb.mockResolvedValue(sql as never);
  return sql;
}

describe("POST /api/mine/bank", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedDb.mockReset();
  });

  it("credits legacy support snapshots even when support stock is not owned", async () => {
    const sql = mockSql({ ...ownedBase, support_kit_granted_at: null });

    const res = await post({
      moves: ["down", "down", "down", "down", "up"],
      consumables: STARTING_CONSUMABLES,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(4);
  });

  it("rejects stale paid consumable snapshots without owned stock", async () => {
    const sql = mockSql();

    const res = await post({
      moves: ["dynamite-down"],
      consumables: { ...STARTING_CONSUMABLES, dynamite: 1 },
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "consumables not owned",
    });
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it("rejects repeated free support snapshots after the starter kit marker", async () => {
    const sql = mockSql();

    const res = await post({
      moves: ["down", "down", "down", "down", "up"],
      consumables: STARTING_CONSUMABLES,
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "consumables not owned",
    });
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it("replays with server-owned consumables instead of the submitted snapshot", async () => {
    const sql = mockSql({ ...ownedBase, rope_count: 1 }, { seed: 5 });

    const res = await post({
      seed: 5,
      moves: [
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "recall",
      ],
      consumables: NO_CONSUMABLES,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      credited: { credits: 1 },
      balance: 12,
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
  });
});
