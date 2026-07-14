import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPlayerAchievements } from "@/server/achievements";
import { recordBalanceEvent } from "@/server/balance-telemetry";
import { db, storageConfigured } from "@/server/db";
import { getMinePlayerProfile, getOrCreatePlayerId } from "@/server/player";
import type { WorldDiff } from "@/sim/mine";
import { POST } from "./route";

vi.mock("@/server/achievements", () => ({
  refreshPlayerAchievements: vi.fn(async () => ({
    achievements: [],
    newlyUnlocked: [],
  })),
}));

vi.mock("@/server/balance-telemetry", () => ({
  recordBalanceEvent: vi.fn(async () => undefined),
}));

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/save-sync-push", () => ({
  pushEndpointHashFromRequest: vi.fn(() => null),
  queueSaveSyncPush: vi.fn(),
}));

vi.mock("@/server/player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/player")>();
  return {
    ...actual,
    getMinePlayerProfile: vi.fn(),
    getOrCreatePlayerId: vi.fn(async () => "player-1"),
  };
});

const mockedDb = vi.mocked(db);
const mockedStorage = vi.mocked(storageConfigured);
const mockedProfile = vi.mocked(getMinePlayerProfile);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const mockedRefresh = vi.mocked(refreshPlayerAchievements);
const mockedRecord = vi.mocked(recordBalanceEvent);

function profile(
  elevator_depth: number,
  elevator_col: number | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    pickaxe_level: 1,
    lamp_level: 1,
    cargo_level: 1,
    lantern_level: 1,
    warpcoil_level: 1,
    elevator_depth,
    elevator_col,
    blast_level: 1,
    elevator_speed_level: 1,
    fall_level: 1,
    recall_level: 1,
    dynamite_count: 0,
    rope_count: 0,
    ladder_count: 8,
    plank_count: 4,
    beacon_count: 0,
    emeralds: 100,
    track_xp: 0,
    defense_xp: 0,
    deepest_depth: 10,
    support_kit_granted_at: "now",
    elevator_support_refund_at: null,
    elevator_column_migrated_at: "now",
    elevator_rail_installed_at: "now",
    elevator_placement_chosen_at: elevator_depth > 0 ? "now" : null,
    legacy_support_snapshot_reconciled_at: "now",
    dynamite_tier_unlock_reset_at: "now",
    ...overrides,
  };
}

function request(column?: number): Request {
  return new Request("http://localhost/api/elevator/upgrade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(column === undefined ? {} : { column }),
  });
}

function mockSql({
  diff = [],
  updated,
}: {
  diff?: WorldDiff;
  updated?: {
    emeralds: number;
    elevator_depth: number;
    elevator_col: number;
    ladder_count: number;
    plank_count: number;
    refund_legacy_supports?: boolean;
    trip_index?: number;
  } | null;
} = {}) {
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("SELECT diff, trip_count FROM mine_worlds")) {
      return [{ diff, trip_count: 2 }];
    }
    if (query.includes("UPDATE players")) {
      return updated === null
        ? []
        : [
            {
              refund_legacy_supports: true,
              trip_index: 3,
              ...(updated ?? {
                emeralds: 75,
                elevator_depth: 1,
                elevator_col: 37,
                ladder_count: 8,
                plank_count: 4,
              }),
            },
          ];
    }
    return [];
  });
  mockedDb.mockResolvedValue(sql as never);
  return sql;
}

describe("POST /api/elevator/upgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorage.mockReturnValue(true);
    mockedPlayer.mockResolvedValue("player-1");
    mockedProfile.mockResolvedValue(profile(0, null));
    mockedRefresh.mockResolvedValue({ achievements: [], newlyUnlocked: [] });
    mockedRecord.mockResolvedValue(undefined);
    mockSql();
  });

  it("rejects cross-site placement before player lookup", async () => {
    const response = await POST(
      new Request("https://vibe-bots.test/api/elevator/upgrade", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          origin: "https://evil.test",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ column: 12 }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "same_origin_required",
    });
    expect(mockedPlayer).not.toHaveBeenCalled();
    expect(mockedDb).not.toHaveBeenCalled();
  });

  it("requires JSON for placement requests", async () => {
    const response = await POST(
      new Request("https://vibe-bots.test/api/elevator/upgrade", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ column: 12 }),
      }),
    );

    expect(response.status).toBe(415);
    expect(mockedPlayer).not.toHaveBeenCalled();
    expect(mockedDb).not.toHaveBeenCalled();
  });

  it("requires a column when buying the first rail", async () => {
    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "choose a surface column for the elevator shaft",
    });
  });

  it("anchors the first rail, charges 25 vibes, and refunds its support", async () => {
    const diff: WorldDiff = [[37, 1, { kind: "empty", ladder: true }]];
    const sql = mockSql({
      diff,
      updated: {
        emeralds: 75,
        elevator_depth: 1,
        elevator_col: 37,
        ladder_count: 9,
        plank_count: 4,
      },
    });

    const response = await POST(request(37));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 1,
      elevatorColumn: 37,
      tripIndex: 3,
      balance: 75,
      refundedLadders: 1,
      refundedSupports: { ladder: 1 },
      ladders: 9,
    });
    const update = sql.mock.calls.find(([strings]) =>
      strings.join(" ").includes("UPDATE players"),
    );
    expect(update?.slice(1)).toEqual(
      expect.arrayContaining([25, 1, 37, 1, 37]),
    );
    expect(update?.[0].join(" ")).toContain("UPDATE mine_worlds");
    expect(update?.[0].join(" ")).toContain("trip_count = trip_count + 1");
    expect(update?.[0].join(" ")).toContain(
      "elevator_rail_installed_at = now()",
    );
    expect(update?.[0].join(" ")).toContain(
      "elevator_placement_chosen_at = COALESCE",
    );
    expect(update?.[0].join(" ")).toContain(
      "elevator_support_refund_at = COALESCE",
    );
    expect(mockedRecord).toHaveBeenCalledWith(
      sql,
      "player-1",
      "elevator.upgrade",
      expect.objectContaining({
        fromDepth: 0,
        toDepth: 1,
        row: 1,
        column: 37,
        price: 25,
      }),
    );
  });

  it("adds exactly one row to an existing shaft without needing a body", async () => {
    mockedProfile.mockResolvedValue(profile(4, 37));
    mockSql({
      updated: {
        emeralds: 70,
        elevator_depth: 5,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 5,
      elevatorColumn: 37,
    });
  });

  it("lets an existing owner place the full shaft once for free", async () => {
    const diff: WorldDiff = [
      [-5, 1, { kind: "empty" }],
      [-5, 2, { kind: "empty" }],
      [37, 1, { kind: "empty", ladder: true }],
      [37, 3, { kind: "empty", plank: true }],
    ];
    mockedProfile.mockResolvedValue(
      profile(4, -5, {
        elevator_placement_chosen_at: null,
        elevator_support_refund_at: "now",
      }),
    );
    const sql = mockSql({
      diff,
      updated: {
        emeralds: 100,
        elevator_depth: 4,
        elevator_col: 37,
        ladder_count: 9,
        plank_count: 5,
      },
    });

    const response = await POST(request(37));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      elevator: 4,
      elevatorColumn: 37,
      elevatorPlacementRequired: false,
      relocated: true,
      tripIndex: 3,
      balance: 100,
      refundedLadders: 1,
      refundedSupports: { ladder: 1, plank: 1 },
      ladders: 9,
      planks: 5,
    });
    expect(body.diff).toEqual(
      expect.arrayContaining([
        [-5, 1, { kind: "empty" }],
        [-5, 2, { kind: "empty" }],
        [37, 1, { kind: "empty" }],
        [37, 2, { kind: "empty" }],
        [37, 3, { kind: "empty" }],
        [37, 4, { kind: "empty" }],
      ]),
    );
    const update = sql.mock.calls.find(([strings]) =>
      strings.join(" ").includes("UPDATE players"),
    );
    const query = update?.[0].join(" ") ?? "";
    expect(query.indexOf("world_lock")).toBeLessThan(
      query.indexOf("player_lock"),
    );
    expect(query).toContain("elevator_placement_chosen_at IS NULL");
    expect(query).toContain("elevator_placement_chosen_at = now()");
    expect(query).toContain("trip_count = trip_count + 1");
    expect(query).not.toContain("emeralds = emeralds -");
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("confirms the legacy column when the owner chooses the same spot", async () => {
    mockedProfile.mockResolvedValue(
      profile(4, -5, { elevator_placement_chosen_at: null }),
    );
    mockSql({
      updated: {
        emeralds: 100,
        elevator_depth: 4,
        elevator_col: -5,
        ladder_count: 8,
        plank_count: 4,
      },
    });

    const response = await POST(request(-5));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 4,
      elevatorColumn: -5,
      relocated: true,
      balance: 100,
    });
  });

  it("returns a conflict when another request wins the free placement", async () => {
    mockedProfile.mockResolvedValue(
      profile(4, -5, { elevator_placement_chosen_at: null }),
    );
    mockSql({ updated: null });

    const response = await POST(request(37));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "elevator placement was already confirmed",
    });
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it("requires existing owners to confirm placement before extending", async () => {
    mockedProfile.mockResolvedValue(
      profile(4, -5, { elevator_placement_chosen_at: null }),
    );
    const sql = mockSql();

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "choose a surface column for the elevator shaft",
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });

  it("installs the full legacy shaft without refunding supports twice", async () => {
    const diff: WorldDiff = [[37, 2, { kind: "empty", ladder: true }]];
    mockedProfile.mockResolvedValue(
      profile(4, 37, {
        elevator_support_refund_at: "now",
        elevator_rail_installed_at: null,
      }),
    );
    mockSql({
      diff,
      updated: {
        emeralds: 70,
        elevator_depth: 5,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
        refund_legacy_supports: false,
      },
    });

    const response = await POST(request());

    await expect(response.json()).resolves.toMatchObject({
      elevator: 5,
      refundedLadders: 0,
      refundedSupports: {},
      diff: [
        [37, 1, { kind: "empty" }],
        [37, 2, { kind: "empty" }],
        [37, 3, { kind: "empty" }],
        [37, 4, { kind: "empty" }],
        [37, 5, { kind: "empty" }],
      ],
    });
  });

  it("refunds a support in the newly purchased row after legacy cleanup", async () => {
    const diff: WorldDiff = [[37, 5, { kind: "empty", plank: true }]];
    mockedProfile.mockResolvedValue(
      profile(4, 37, {
        elevator_support_refund_at: "now",
        elevator_rail_installed_at: "now",
      }),
    );
    mockSql({
      diff,
      updated: {
        emeralds: 70,
        elevator_depth: 5,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 5,
        refund_legacy_supports: false,
      },
    });

    const response = await POST(request());

    await expect(response.json()).resolves.toMatchObject({
      elevator: 5,
      refundedLadders: 0,
      refundedSupports: { plank: 1 },
      planks: 5,
      diff: [
        [37, 1, { kind: "empty" }],
        [37, 2, { kind: "empty" }],
        [37, 3, { kind: "empty" }],
        [37, 4, { kind: "empty" }],
        [37, 5, { kind: "empty" }],
      ],
    });
  });

  it("returns legacy and purchased supports when the locked marker allows it", async () => {
    const diff: WorldDiff = [
      [37, 2, { kind: "empty", ladder: true }],
      [37, 5, { kind: "empty", plank: true }],
    ];
    mockedProfile.mockResolvedValue(
      profile(4, 37, {
        elevator_support_refund_at: null,
        elevator_rail_installed_at: null,
      }),
    );
    mockSql({
      diff,
      updated: {
        emeralds: 70,
        elevator_depth: 5,
        elevator_col: 37,
        ladder_count: 9,
        plank_count: 5,
        refund_legacy_supports: true,
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 5,
      refundedLadders: 1,
      refundedSupports: { ladder: 1, plank: 1 },
      ladders: 9,
      planks: 5,
    });
  });

  it("uses the locked support marker when the profile snapshot is stale", async () => {
    const diff: WorldDiff = [
      [37, 2, { kind: "empty", ladder: true }],
      [37, 5, { kind: "empty", plank: true }],
    ];
    mockedProfile.mockResolvedValue(
      profile(4, 37, {
        elevator_support_refund_at: null,
        elevator_rail_installed_at: null,
      }),
    );
    const sql = mockSql({
      diff,
      updated: {
        emeralds: 70,
        elevator_depth: 5,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 5,
        refund_legacy_supports: false,
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 5,
      refundedLadders: 0,
      refundedSupports: { plank: 1 },
      ladders: 8,
      planks: 5,
      diff: [
        [37, 1, { kind: "empty" }],
        [37, 2, { kind: "empty" }],
        [37, 3, { kind: "empty" }],
        [37, 4, { kind: "empty" }],
        [37, 5, { kind: "empty" }],
      ],
    });
    const update = sql.mock.calls.find(([strings]) =>
      strings.join(" ").includes("UPDATE players"),
    );
    expect(update?.[0].join(" ")).toContain(
      "elevator_support_refund_at IS NULL AS refund_legacy_supports",
    );
    expect(update?.[0].join(" ")).toContain(
      "WHEN (SELECT refund_legacy_supports FROM player_lock)",
    );
  });

  it("rejects relocation after the shaft is placed", async () => {
    mockedProfile.mockResolvedValue(profile(4, 37));
    const sql = mockSql();

    const response = await POST(request(38));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "elevator shaft is already placed",
      column: 37,
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });

  it("keeps the purchase atomic when the balance or depth guard loses", async () => {
    mockSql({ updated: null });

    const response = await POST(request(37));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "not enough vibes (or already extended)",
    });
  });

  it("rejects non-integer shaft columns", async () => {
    const response = await POST(
      new Request("http://localhost/api/elevator/upgrade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ column: 1.5 }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "column must be an integer from -100000 to 100000",
    });
  });

  it("does not charge for rail below the playable mine", async () => {
    mockedProfile.mockResolvedValue(profile(999, 37));
    const sql = mockSql();

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "elevator rail has reached the mine bottom",
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });
});
