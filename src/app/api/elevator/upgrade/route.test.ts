import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPlayerAchievements } from "@/server/achievements";
import { recordBalanceEvent } from "@/server/balance-telemetry";
import { db, storageConfigured } from "@/server/db";
import { logElevatorOutcomeEvent } from "@/server/monitoring";
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

vi.mock("@/server/monitoring", () => ({
  logElevatorOutcomeEvent: vi.fn(),
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
const mockedOutcome = vi.mocked(logElevatorOutcomeEvent);

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

// expectedDepth is required by the route (the stale-rail guard), so every test
// passes it explicitly to match its own mocked rail depth rather than rely on a
// shared default that could silently drift from a test's profile. Pass null to
// omit it entirely (the missing-expectedDepth 400 case).
function request(
  column: number | undefined,
  expectedDepth: number | null,
): Request {
  const payload: { column?: number; expectedDepth?: number } = {};
  if (column !== undefined) payload.column = column;
  if (expectedDepth !== null) payload.expectedDepth = expectedDepth;
  return new Request("http://localhost/api/elevator/upgrade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// The non-rail gear and consumable columns the CTE RETURNING and the reject
// re-read now surface for authoritative inventory adoption (F-121). Callers
// override any of these to model a concurrent player-only purchase.
const INVENTORY_COLUMNS = {
  pickaxe_level: 1,
  lamp_level: 1,
  cargo_level: 1,
  lantern_level: 1,
  warpcoil_level: 1,
  blast_level: 1,
  elevator_speed_level: 1,
  fall_level: 1,
  recall_level: 1,
  dynamite_count: 0,
  rope_count: 0,
  beacon_count: 0,
};

type InventoryOverrides = Partial<typeof INVENTORY_COLUMNS>;

type ReloadRow = InventoryOverrides & {
  emeralds: number;
  elevator_depth: number;
  elevator_col: number | null;
  ladder_count: number;
  plank_count: number;
  elevator_placement_chosen_at: string | null;
  trip_count: number | null;
};

function mockSql({
  diff = [],
  updated,
  reloaded,
}: {
  diff?: WorldDiff;
  updated?:
    | (InventoryOverrides & {
        emeralds: number;
        elevator_depth: number;
        elevator_col: number;
        ladder_count: number;
        plank_count: number;
        refund_legacy_supports?: boolean;
        trip_index?: number;
      })
    | null;
  reloaded?: ReloadRow | null;
} = {}) {
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    // The post-conflict re-read for the authoritative reject bundle (F-121).
    if (query.includes("LEFT JOIN mine_worlds")) {
      return reloaded === undefined || reloaded === null
        ? []
        : [{ ...INVENTORY_COLUMNS, ...reloaded }];
    }
    if (query.includes("SELECT diff, trip_count FROM mine_worlds")) {
      return [{ diff, trip_count: 2 }];
    }
    if (query.includes("UPDATE players")) {
      return updated === null
        ? []
        : [
            {
              ...INVENTORY_COLUMNS,
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

  it("rejects a request that omits expectedDepth fail-fast", async () => {
    // A stale cached client without expectedDepth would bypass the stale-rail
    // guard; the route rejects it before any read or charge.
    const response = await POST(request(37, null));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-expected-depth-required",
      error: "expectedDepth is required",
    });
    expect(mockedPlayer).not.toHaveBeenCalled();
    expect(mockedDb).not.toHaveBeenCalled();
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it("requires a column when buying the first rail", async () => {
    const response = await POST(request(undefined, 0));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-column-required",
      error: "choose a surface column for the elevator shaft",
      elevator: 0,
      elevatorColumn: null,
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

    const response = await POST(request(37, 0));

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
        // A bounded placement state replaces the exact shaft column (F-121).
        placement: "placed",
        price: 25,
      }),
    );
    // The exact player-chosen shaft column is never retained in telemetry.
    const props = mockedRecord.mock.calls.at(-1)?.[3] ?? {};
    expect(props).not.toHaveProperty("column");
    expect(Object.values(props)).not.toContain(37);
  });

  it("adds exactly one row to an existing shaft without needing a body", async () => {
    mockedProfile.mockResolvedValue(profile(4, 37));
    const sql = mockSql({
      updated: {
        emeralds: 70,
        elevator_depth: 5,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
      },
    });

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 5,
      elevatorColumn: 37,
    });
    // An extend records the bounded "extended" placement, never the column.
    expect(mockedRecord).toHaveBeenCalledWith(
      sql,
      "player-1",
      "elevator.upgrade",
      expect.objectContaining({
        fromDepth: 4,
        toDepth: 5,
        placement: "extended",
      }),
    );
    expect(mockedRecord.mock.calls.at(-1)?.[3] ?? {}).not.toHaveProperty(
      "column",
    );
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

    const response = await POST(request(37, 4));

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

    const response = await POST(request(-5, 4));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 4,
      elevatorColumn: -5,
      relocated: true,
      balance: 100,
    });
  });

  it("returns a stale-rail conflict when another request wins the free placement", async () => {
    mockedProfile.mockResolvedValue(
      profile(4, -5, { elevator_placement_chosen_at: null }),
    );
    mockSql({
      updated: null,
      reloaded: {
        emeralds: 100,
        elevator_depth: 4,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
        elevator_placement_chosen_at: "now",
        trip_count: 2,
      },
    });

    const response = await POST(request(37, 4));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-stale-rail-state",
      error: "elevator placement was already confirmed",
      elevator: 4,
      elevatorColumn: 37,
      elevatorPlacementRequired: false,
    });
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it("requires existing owners to confirm placement before extending", async () => {
    mockedProfile.mockResolvedValue(
      profile(4, -5, { elevator_placement_chosen_at: null }),
    );
    const sql = mockSql();

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-column-required",
      error: "choose a surface column for the elevator shaft",
      elevator: 4,
      elevatorPlacementRequired: true,
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

    const response = await POST(request(undefined, 4));

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

    const response = await POST(request(undefined, 4));

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

    const response = await POST(request(undefined, 4));

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

    const response = await POST(request(undefined, 4));

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

    const response = await POST(request(38, 4));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-stale-rail-state",
      error: "elevator shaft is already placed",
      elevator: 4,
      elevatorColumn: 37,
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });

  it("classifies a losing extend as insufficient balance from the re-read", async () => {
    mockSql({
      updated: null,
      reloaded: {
        emeralds: 10,
        elevator_depth: 0,
        elevator_col: null,
        ladder_count: 8,
        plank_count: 4,
        elevator_placement_chosen_at: null,
        trip_count: 2,
      },
    });

    const response = await POST(request(37, 0));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-insufficient-balance",
      balance: 10,
      elevator: 0,
    });
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it("classifies a losing extend as a moved rail when the depth advanced", async () => {
    mockedProfile.mockResolvedValue(profile(4, 37));
    mockSql({
      updated: null,
      reloaded: {
        emeralds: 100,
        elevator_depth: 5,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
        elevator_placement_chosen_at: "now",
        trip_count: 2,
      },
    });

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-stale-rail-state",
      elevator: 5,
      elevatorColumn: 37,
    });
  });

  it("classifies a losing extend as a moved checkpoint when the trip advanced", async () => {
    mockedProfile.mockResolvedValue(profile(4, 37));
    mockSql({
      updated: null,
      reloaded: {
        emeralds: 100,
        elevator_depth: 4,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
        elevator_placement_chosen_at: "now",
        trip_count: 9,
      },
    });

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-stale-checkpoint",
      elevator: 4,
      tripIndex: 9,
    });
  });

  it("classifies an otherwise-buyable losing extend as a concurrent loss", async () => {
    mockedProfile.mockResolvedValue(profile(4, 37));
    mockSql({
      updated: null,
      reloaded: {
        emeralds: 100,
        elevator_depth: 4,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
        elevator_placement_chosen_at: "now",
        trip_count: 2,
      },
    });

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-concurrent-loss",
      elevator: 4,
    });
  });

  it("reports a moved checkpoint over a low balance so the client refreshes", async () => {
    // A concurrent spend both advanced the trip and drained the balance below
    // the price. The moved checkpoint must win: the client refreshes the whole
    // world (and gets the true balance with it) instead of showing a dead-end
    // price note over a stale rail.
    mockedProfile.mockResolvedValue(profile(4, 37));
    mockSql({
      updated: null,
      reloaded: {
        emeralds: 1,
        elevator_depth: 4,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
        elevator_placement_chosen_at: "now",
        trip_count: 9,
      },
    });

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-stale-checkpoint",
      elevator: 4,
      tripIndex: 9,
    });
  });

  it("rejects a stale expected depth before charging and returns the truth", async () => {
    mockedProfile.mockResolvedValue(profile(4, 37));
    const sql = mockSql();

    const response = await POST(request(undefined, 3));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-stale-rail-state",
      elevator: 4,
      elevatorColumn: 37,
      tripIndex: 2,
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });

  it("extends when the expected depth matches the stored rail", async () => {
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

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 5,
      elevatorColumn: 37,
    });
  });

  it("rejects a non-integer expected depth", async () => {
    const response = await POST(
      new Request("http://localhost/api/elevator/upgrade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ column: 37, expectedDepth: 2.5 }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("expectedDepth"),
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

    const response = await POST(request(undefined, 999));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-rail-at-bottom",
      error: "elevator rail has reached the mine bottom",
      elevator: 999,
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });

  it("returns the full authoritative inventory on an accepted extend (F-121)", async () => {
    // The committed row carries a pickaxe and consumable count a concurrent
    // player-only purchase raised. The client adopts these wholesale so a stale
    // non-rail count cannot persist under the newly advanced trip.
    mockedProfile.mockResolvedValue(profile(4, 37));
    const sql = mockSql({
      updated: {
        emeralds: 70,
        elevator_depth: 5,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
        pickaxe_level: 3,
        cargo_level: 2,
        dynamite_count: 5,
        beacon_count: 1,
      },
    });

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 5,
      elevatorColumn: 37,
      ladders: 8,
      planks: 4,
      gear: expect.objectContaining({
        pickaxe: 3,
        cargo: 2,
        elevator: 5,
        elevatorColumn: 37,
      }),
      consumables: {
        dynamite: 5,
        rope: 0,
        ladder: 8,
        plank: 4,
        beacon: 1,
      },
    });
    // Pin the projection so the mock cannot hide a RETURNING regression: the
    // committed row must actually select the non-rail inventory columns.
    const update = sql.mock.calls.find(([strings]) =>
      strings.join(" ").includes("UPDATE players"),
    );
    const query = update?.[0].join(" ") ?? "";
    expect(query).toContain("RETURNING");
    for (const column of [
      "pickaxe_level",
      "lamp_level",
      "cargo_level",
      "lantern_level",
      "warpcoil_level",
      "blast_level",
      "elevator_speed_level",
      "fall_level",
      "recall_level",
      "dynamite_count",
      "rope_count",
      "beacon_count",
    ]) {
      expect(query).toContain(column);
    }
    expect(query).toContain("player_update.*");
  });

  it("returns the full authoritative inventory when placing the first rail (F-121)", async () => {
    // The placement CTE must surface the same inventory as the extend path.
    const diff: WorldDiff = [[37, 1, { kind: "empty", ladder: true }]];
    const sql = mockSql({
      diff,
      updated: {
        emeralds: 75,
        elevator_depth: 1,
        elevator_col: 37,
        ladder_count: 9,
        plank_count: 4,
        lantern_level: 3,
        rope_count: 6,
      },
    });

    const response = await POST(request(37, 0));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      elevator: 1,
      elevatorColumn: 37,
      ladders: 9,
      gear: expect.objectContaining({ lantern: 3, elevator: 1 }),
      consumables: expect.objectContaining({ rope: 6, ladder: 9 }),
    });
    const update = sql.mock.calls.find(([strings]) =>
      strings.join(" ").includes("UPDATE players"),
    );
    const query = update?.[0].join(" ") ?? "";
    expect(query).toContain("pickaxe_level");
    expect(query).toContain("beacon_count");
    expect(query).toContain("player_update.*");
  });

  it("returns the full authoritative inventory on an insufficient-balance reject (F-121)", async () => {
    // A concurrent player-only purchase drained the balance and raised a
    // non-rail count while the rail depth and checkpoint stayed put. The reject
    // carries the fresh inventory so the client can adopt it alongside balance.
    mockedProfile.mockResolvedValue(profile(4, 37));
    mockSql({
      updated: null,
      reloaded: {
        emeralds: 10,
        elevator_depth: 4,
        elevator_col: 37,
        ladder_count: 8,
        plank_count: 4,
        elevator_placement_chosen_at: "now",
        trip_count: 2,
        cargo_level: 4,
        rope_count: 7,
      },
    });

    const response = await POST(request(undefined, 4));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "elevator-insufficient-balance",
      balance: 10,
      elevator: 4,
      gear: expect.objectContaining({ cargo: 4, elevator: 4 }),
      consumables: expect.objectContaining({ rope: 7, ladder: 8 }),
    });
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  describe("mutation-outcome telemetry (F-121)", () => {
    it("logs an accepted place outcome when anchoring the first rail", async () => {
      mockSql({
        updated: {
          emeralds: 75,
          elevator_depth: 1,
          elevator_col: 37,
          ladder_count: 9,
          plank_count: 4,
        },
      });

      const response = await POST(request(37, 0));

      expect(response.status).toBe(200);
      expect(mockedOutcome).toHaveBeenCalledTimes(1);
      expect(mockedOutcome).toHaveBeenCalledWith({
        playerId: "player-1",
        operation: "place",
        result: "accepted",
        reason: null,
      });
    });

    it("logs an accepted extend outcome when adding a row", async () => {
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

      const response = await POST(request(undefined, 4));

      expect(response.status).toBe(200);
      expect(mockedOutcome).toHaveBeenCalledTimes(1);
      expect(mockedOutcome).toHaveBeenCalledWith({
        playerId: "player-1",
        operation: "extend",
        result: "accepted",
        reason: null,
      });
    });

    it("logs an accepted relocate outcome on a free placement", async () => {
      mockedProfile.mockResolvedValue(
        profile(4, -5, { elevator_placement_chosen_at: null }),
      );
      mockSql({
        updated: {
          emeralds: 100,
          elevator_depth: 4,
          elevator_col: 37,
          ladder_count: 8,
          plank_count: 4,
        },
      });

      const response = await POST(request(37, 4));

      expect(response.status).toBe(200);
      expect(mockedOutcome).toHaveBeenCalledTimes(1);
      expect(mockedOutcome).toHaveBeenCalledWith({
        playerId: "player-1",
        operation: "relocate",
        result: "accepted",
        reason: null,
      });
    });

    it("logs a rejected extend outcome and no balance event on a conflict", async () => {
      mockedProfile.mockResolvedValue(profile(4, 37));
      mockSql({
        updated: null,
        reloaded: {
          emeralds: 10,
          elevator_depth: 4,
          elevator_col: 37,
          ladder_count: 8,
          plank_count: 4,
          elevator_placement_chosen_at: "now",
          trip_count: 2,
        },
      });

      const response = await POST(request(undefined, 4));

      expect(response.status).toBe(409);
      expect(mockedOutcome).toHaveBeenCalledTimes(1);
      expect(mockedOutcome).toHaveBeenCalledWith({
        playerId: "player-1",
        operation: "extend",
        result: "rejected",
        reason: "elevator-insufficient-balance",
      });
      // A rejected write emits the outcome log but never a balance event.
      expect(mockedRecord).not.toHaveBeenCalled();
    });

    it("logs a rejected outcome for the stale-rail guard before any write", async () => {
      mockedProfile.mockResolvedValue(profile(4, 37));
      const sql = mockSql();

      const response = await POST(request(undefined, 3));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: "elevator-stale-rail-state",
      });
      expect(mockedOutcome).toHaveBeenCalledTimes(1);
      expect(mockedOutcome).toHaveBeenCalledWith({
        playerId: "player-1",
        operation: "extend",
        result: "rejected",
        reason: "elevator-stale-rail-state",
      });
      expect(
        sql.mock.calls.some(([strings]) =>
          strings.join(" ").includes("UPDATE players"),
        ),
      ).toBe(false);
      expect(mockedRecord).not.toHaveBeenCalled();
    });

    it("logs no outcome for a pre-auth validation reject", async () => {
      // Missing expectedDepth is rejected before the player and profile load, so
      // there is no mutation operation to attribute an outcome to.
      const response = await POST(request(37, null));

      expect(response.status).toBe(400);
      expect(mockedOutcome).not.toHaveBeenCalled();
    });

    it("still completes the buy when outcome telemetry throws", async () => {
      mockedOutcome.mockImplementation(() => {
        throw new Error("monitoring sink unavailable");
      });
      mockSql({
        updated: {
          emeralds: 75,
          elevator_depth: 1,
          elevator_col: 37,
          ladder_count: 9,
          plank_count: 4,
        },
      });

      const response = await POST(request(37, 0));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ elevator: 1 });
    });
  });
});
