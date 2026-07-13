import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAchievementProgress } from "@/server/achievements";
import { db, storageConfigured } from "@/server/db";
import { BASE_PART_CATALOG, STARTER_BASE_PART_INVENTORY } from "@/sim/bunker";
import {
  createMine,
  DEFAULT_GEAR,
  exportDiff,
  MINE_VERSION,
  type MineConsumables,
  NO_CONSUMABLES,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "@/sim/mine";
import {
  achievementProgressForTrip,
  chargeableConsumables,
  gearOwnershipError,
  POST,
  paidConsumableSnapshotExceedsOwned,
  replayConsumablesForCashOut,
  validatePendingBunkerClaim,
} from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/achievements", () => ({
  applyAchievementProgress: vi.fn(async () => []),
}));

vi.mock("@/server/save-sync-push", () => ({
  pushEndpointHashFromRequest: vi.fn(() => null),
  queueSaveSyncPush: vi.fn(),
}));

vi.mock("@/server/balance-telemetry", () => ({
  recordBalanceEvent: vi.fn(async () => undefined),
}));

vi.mock("@/server/player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/player")>();
  return {
    ...actual,
    currentPlayerId: vi.fn(async () => "player-1"),
    getOrCreatePlayerId: vi.fn(async () => "player-1"),
  };
});

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedApplyAchievementProgress = vi.mocked(applyAchievementProgress);
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

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
  recall_level: 1,
  dynamite_count: 0,
  rope_count: 0,
  ladder_count: 0,
  plank_count: 0,
  beacon_count: 0,
  emeralds: 0,
  track_xp: 0,
  defense_xp: 0,
  deepest_depth: 0,
  support_kit_granted_at: "2026-06-17T00:00:00.000Z",
  elevator_support_refund_at: null,
  legacy_support_snapshot_reconciled_at: "2026-06-17T00:00:00.000Z",
  dynamite_tier_unlock_reset_at: "2026-06-18T00:00:00.000Z",
};

const stock = (overrides: Partial<MineConsumables> = {}): MineConsumables => ({
  ...NO_CONSUMABLES,
  ...overrides,
});

function pendingBunkerBaseDiff(blocked = false) {
  const mine = createMine(123, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 5; row++) {
    for (let col = START_COL - 3; col <= START_COL + 3; col++) {
      setCell(mine, col, row, { kind: "empty" });
    }
  }
  if (blocked) setCell(mine, START_COL - 3, 5, { kind: "dirt" });
  return exportDiff(mine);
}

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
  options: {
    seed?: number;
    diff?: unknown;
    bunkerClaimed?: boolean;
    existingBunker?: boolean;
    bunkerFootprint?: {
      col: number;
      row: number;
      width: number;
      height: number;
    };
  } = {},
) {
  const worldSeed = options.seed ?? 123;
  const sql = vi.fn(async () => {
    const calls = sql.mock.calls as unknown as Array<[TemplateStringsArray]>;
    const strings = calls[calls.length - 1]?.[0];
    const query = strings?.join(" ") ?? "";
    if (query.includes("SELECT seed, diff, trip_count")) {
      return [{ seed: worldSeed, diff: options.diff ?? [], trip_count: 0 }];
    }
    if (query.includes("SELECT pickaxe_level")) return [owned];
    if (query.includes("SELECT player_id") && query.includes("FROM bunkers")) {
      return options.existingBunker ? [{ player_id: "player-1" }] : [];
    }
    if (query.includes("SELECT footprint") && query.includes("FROM bunkers")) {
      return options.bunkerFootprint
        ? [{ footprint: options.bunkerFootprint }]
        : [];
    }
    if (
      query.includes("SELECT part_id, count") &&
      query.includes("FROM player_base_parts")
    ) {
      return Object.entries(STARTER_BASE_PART_INVENTORY).map(
        ([part_id, count]) => ({ part_id, count }),
      );
    }
    if (query.includes("support_kit_granted_at = now()")) {
      return [
        {
          ladder_count: 8,
          plank_count: 4,
          support_kit_granted_at: "2026-06-17T00:00:00.000Z",
          legacy_support_snapshot_reconciled_at: "2026-06-17T00:00:00.000Z",
        },
      ];
    }
    return [
      {
        emeralds: 12,
        deepest_depth: 1,
        dynamite_count: owned.dynamite_count ?? 0,
        rope_count: owned.rope_count ?? 0,
        ladder_count: owned.ladder_count ?? 0,
        plank_count: owned.plank_count ?? 0,
        beacon_count: owned.beacon_count ?? 0,
        bonus: 0,
        trip_count: 1,
        bunker_claimed: options.bunkerClaimed === true,
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
    mockedApplyAchievementProgress.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("logs invalid JSON bodies before auth-bound route work", async () => {
    const res = await POST(
      new Request("http://localhost/api/mine/bank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid JSON body",
    });
    expect(mockedDb).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.invalid_json_body",
      alert: true,
      severity: "warn",
      code: "invalid_json_body",
      detail: "request body could not be parsed as JSON",
    });
    expect(String(warnSpy.mock.calls[0][0])).not.toContain("player-1");
  });

  it("validates pending bunker parts stacked across depths", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [{ col: START_COL - 3, row: 1, depth: 1 }],
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 3,
            row: 1,
            depth: 0,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
          {
            partId: "wall-panel",
            col: START_COL - 3,
            row: 1,
            depth: 1,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bunker.parts.map((part) => part.depth)).toEqual([0, 1]);
  });

  it("rejects pending dug chains that skip a connecting cell", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [{ col: START_COL - 3, row: 1, depth: 2 }],
        parts: [],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result).toEqual({
      ok: false,
      error: "cannot excavate: unreachable",
    });
  });

  it("rejects pending parts placed inside undug rock", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [],
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 3,
            row: 1,
            depth: 1,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result).toEqual({
      ok: false,
      error: "cannot place bunker part: rock",
    });
  });

  it("rejects pending bunker parts outside the depth range", async () => {
    const res = await post({
      moves: ["down", "down", "down", "down", "down"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 3,
            row: 1,
            depth: 5,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
    });

    expect(res.status).toBe(400);
    expect(mockedDb).not.toHaveBeenCalled();
  });

  it("validates a locally claimed bunker against the replayed claim moment", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [],
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 3,
            row: 1,
            depth: 0,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bunker.footprint).toMatchObject({
      col: START_COL - 3,
      row: 1,
      width: 7,
      height: 5,
    });
    expect(result.inventory["wall-panel"]).toBe(5);
  });

  it("rejects pending bunkers that were not clear when claimed", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [],
        parts: [],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(true),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result).toEqual({
      ok: false,
      error: "clear the full 7x5 claim first",
    });
  });

  it("rejects pending bunker parts that exceed server-owned stock", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [],
        parts: [
          {
            partId: "door-panel",
            col: START_COL - 3,
            row: 1,
            depth: 0,
            durability: BASE_PART_CATALOG["door-panel"].durability,
          },
          {
            partId: "door-panel",
            col: START_COL - 2,
            row: 1,
            depth: 0,
            durability: BASE_PART_CATALOG["door-panel"].durability,
          },
        ],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result).toEqual({
      ok: false,
      error: "cannot place bunker part: stock",
    });
  });

  it("persists a valid pending bunker during cash-out", async () => {
    const sql = mockSql(ownedBase, {
      diff: pendingBunkerBaseDiff(),
      bunkerClaimed: true,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "down"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [{ col: START_COL - 3, row: 1, depth: 1 }],
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 3,
            row: 1,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      bunkerClaimed: true,
      tripIndex: 1,
    });
    const queries = (
      sql.mock.calls as unknown as Array<[TemplateStringsArray]>
    ).map(([strings]) => strings.join(" "));
    expect(queries.some((query) => query.includes("INSERT INTO bunkers"))).toBe(
      true,
    );
    expect(
      queries.some((query) => query.includes("INSERT INTO player_base_parts")),
    ).toBe(true);
    // Groundbreaker is backfill-only: cells dug before banking surface
    // through the durable bunkers.dug backfill inside
    // applyAchievementProgress, never through the bank patch (so a
    // dig-then-claim run can never count the same cells twice).
    expect(mockedApplyAchievementProgress).toHaveBeenCalledWith(
      expect.anything(),
      "player-1",
      expect.not.objectContaining({ bunkerCellsDug: expect.anything() }),
    );
  });

  it("replays scaffold movement only after the pending claim checkpoint", async () => {
    mockSql(ownedBase, {
      diff: pendingBunkerBaseDiff(),
      bunkerClaimed: true,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "down", "bunker-scaffold-up"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        parts: [],
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      bunkerClaimed: true,
      tripIndex: 1,
    });
  });

  it("rejects scaffold movement without an authoritative bunker claim", async () => {
    mockSql(ownedBase, { diff: pendingBunkerBaseDiff() });

    const res = await post({
      moves: ["down", "down", "down", "down", "down", "bunker-scaffold-up"],
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "bunker scaffold requires a claimed bunker",
    });
  });

  it("rejects duplicate pending bunker claims before granting starter parts", async () => {
    const sql = mockSql(ownedBase, {
      diff: pendingBunkerBaseDiff(),
      existingBunker: true,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "down"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        parts: [],
      },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "bunker already claimed",
    });
    const queries = (
      sql.mock.calls as unknown as Array<[TemplateStringsArray]>
    ).map(([strings]) => strings.join(" "));
    expect(
      queries.some((query) => query.includes("INSERT INTO player_base_parts")),
    ).toBe(false);
  });

  it("logs request-shape failures with safe cash-out context", async () => {
    const res = await post({
      moves: [],
      mineVersion: "29",
      gear: { ...DEFAULT_GEAR, pickaxe: 99 },
      consumables: { ...STARTING_CONSUMABLES, rope: "22" },
    });

    expect(res.status).toBe(400);
    expect(mockedDb).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const raw = String(warnSpy.mock.calls[0][0]);
    const payload = JSON.parse(raw);
    expect(payload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.request_validation_failed",
      alert: true,
      severity: "warn",
      code: "request_validation_failed",
      request: {
        bodyType: "object",
        seed: 123,
        tripIndex: 0,
        mineVersionType: "string",
        moveCount: 0,
        movesType: "array",
        gear: { pickaxe: 99 },
        consumables: { rope: { type: "string" } },
      },
    });
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "moves" }),
        expect.objectContaining({ path: "mineVersion" }),
        expect.objectContaining({ path: "gear.pickaxe" }),
        expect.objectContaining({ path: "consumables.rope" }),
      ]),
    );
    expect(raw).not.toContain("player-1");
    expect(raw).not.toContain("down");
  });

  it("logs mine-version mismatches with hashed existing player context", async () => {
    const res = await post({ mineVersion: MINE_VERSION - 1 });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "the mine has shifted since this trip started; start fresh",
      code: "mine_version_mismatch",
      expectedMineVersion: MINE_VERSION,
    });
    expect(mockedDb).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const raw = String(warnSpy.mock.calls[0][0]);
    const payload = JSON.parse(raw);
    expect(payload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.mine_version_mismatch",
      alert: true,
      severity: "warn",
      code: "mine_version_mismatch",
      tripIndex: 0,
      moveCount: 1,
      seed: 123,
      mineVersion: MINE_VERSION - 1,
      expectedMineVersion: MINE_VERSION,
    });
    expect(payload.player).toBeTruthy();
    expect(raw).not.toContain("player-1");
  });

  it("credits legacy support snapshots even when support stock is not owned", async () => {
    const sql = mockSql({
      ...ownedBase,
      support_kit_granted_at: "2026-06-17T00:00:00.000Z",
      legacy_support_snapshot_reconciled_at: null,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "up"],
      consumables: STARTING_CONSUMABLES,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.legacy_support_reconciled",
      alert: true,
      severity: "warn",
      code: "legacy_support_reconciled",
      tripIndex: 0,
      moveCount: 5,
    });
    expect(String(warnSpy.mock.calls[0][0])).not.toContain("player-1");
  });

  it("rejects stale paid consumable snapshots without owned stock", async () => {
    const sql = mockSql();

    const res = await post({
      moves: ["dynamite-1"],
      consumables: { ...STARTING_CONSUMABLES, dynamite: 1 },
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "consumables not owned",
    });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.consumables_not_owned",
      alert: true,
      severity: "error",
      code: "consumables_not_owned",
      detail: "paid consumable overclaim",
      submitted: { dynamite: 1 },
      owned: { dynamite: 0 },
    });
  });

  it("ignores stale support snapshots after the legacy marker", async () => {
    const sql = mockSql({
      ...ownedBase,
      ladder_count: 13,
      plank_count: 4,
    });

    const res = await post({
      moves: ["down"],
      consumables: { ...NO_CONSUMABLES, ladder: 14, plank: 2 },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("caps legacy support snapshots above the starter floor", async () => {
    const sql = mockSql({
      ...ownedBase,
      legacy_support_snapshot_reconciled_at: null,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "up"],
      consumables: { ...STARTING_CONSUMABLES, ladder: 9 },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
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
    const body = await res.json();
    expect(body).toMatchObject({
      credited: { credits: 7 },
      balance: 12,
      consumables: stock({ rope: 1 }),
      tripIndex: 1,
    });
    expect(body.credited.soldHaul).toMatchObject({
      totalVibes: 7,
      salvageCredits: 0,
    });
    const soldOres = body.credited.soldHaul.ores as Record<string, number>;
    expect(
      Object.values(soldOres).reduce((sum, count) => sum + count, 0),
    ).toBeGreaterThan(0);
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it("accepts large legitimate support stock from long-running players", async () => {
    const owned = {
      ...ownedBase,
      dynamite_count: 34,
      rope_count: 22,
      ladder_count: 1018,
      plank_count: 206,
      beacon_count: 22,
    };
    const sql = mockSql(owned, { seed: 2155004236 });

    const res = await post({
      seed: 2155004236,
      moves: ["down"],
      consumables: stock({
        dynamite: 34,
        rope: 22,
        ladder: 1018,
        plank: 206,
        beacon: 22,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      consumables: stock({
        dynamite: 34,
        rope: 22,
        ladder: 1018,
        plank: 206,
        beacon: 22,
      }),
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const successPayload = JSON.parse(String(infoSpy.mock.calls[0][0]));
    expect(successPayload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.cash_out_succeeded",
      alert: false,
      severity: "info",
      code: "cash_out_succeeded",
      tripIndex: 0,
      moveCount: 1,
      seed: 2155004236,
      mineVersion: MINE_VERSION,
      charged: stock(),
      credited: { credits: 0, parts: 0 },
      remaining: stock({
        dynamite: 34,
        rope: 22,
        ladder: 1018,
        plank: 206,
        beacon: 22,
      }),
      worldTripIndex: 1,
    });
    expect(String(infoSpy.mock.calls[0][0])).not.toContain("player-1");
  });

  it("ignores manual bag drop actions that replay did not apply", async () => {
    const sql = mockSql(ownedBase, { seed: 3 });

    const res = await post({
      seed: 3,
      moves: ["down", "drop:coal:1"],
    });

    expect(res.status).toBe(200);
    expect(mockedApplyAchievementProgress).toHaveBeenCalledWith(
      sql,
      "player-1",
      expect.objectContaining({ bagDrops: 0 }),
    );
  });
});

describe("mine bank policy helpers", () => {
  it("flags gear snapshots above owned profile levels", () => {
    expect(gearOwnershipError({ ...DEFAULT_GEAR, pickaxe: 2 }, ownedBase)).toBe(
      "gear not owned: pickaxe level 2",
    );
    expect(gearOwnershipError({ ...DEFAULT_GEAR, recall: 2 }, ownedBase)).toBe(
      "gear not owned: recall level 2",
    );
    expect(
      gearOwnershipError({ ...DEFAULT_GEAR, elevatorSpeed: 2 }, ownedBase),
    ).toBe("gear not owned: elevator speed level 2");
    expect(gearOwnershipError({ ...DEFAULT_GEAR, fall: 2 }, ownedBase)).toBe(
      "gear not owned: fall harness level 2",
    );
    expect(gearOwnershipError(DEFAULT_GEAR, ownedBase)).toBeNull();
  });

  it("separates paid consumable ownership from support reconciliation", () => {
    expect(
      paidConsumableSnapshotExceedsOwned(
        stock({ ladder: 8, plank: 4 }),
        NO_CONSUMABLES,
      ),
    ).toBe(false);
    expect(
      paidConsumableSnapshotExceedsOwned(
        stock({ dynamite: 1 }),
        NO_CONSUMABLES,
      ),
    ).toBe(true);
  });

  it("caps one legacy support snapshot at the starter support floor", () => {
    expect(
      replayConsumablesForCashOut(stock({ ladder: 10, plank: 6 }), {
        ...ownedBase,
        legacy_support_snapshot_reconciled_at: null,
      }),
    ).toEqual({
      consumables: stock({ ladder: 8, plank: 4 }),
      usedLegacySupportSnapshot: true,
    });
    expect(
      replayConsumablesForCashOut(stock({ ladder: 8, plank: 4 }), ownedBase),
    ).toEqual({
      consumables: NO_CONSUMABLES,
      usedLegacySupportSnapshot: false,
    });
  });

  it("charges only paid support stock after death grants", () => {
    expect(
      chargeableConsumables({
        bankedCredits: 0,
        bankedParts: [],
        maxDepth: 0,
        moves: 0,
        bagDrops: 0,
        roofRescues: 0,
        collapsesSurvived: 0,
        used: stock({ dynamite: 1, rope: 1, ladder: 7, plank: 5, beacon: 1 }),
        granted: stock({ ladder: 3, plank: 2 }),
        diff: [],
      }),
    ).toEqual(stock({ dynamite: 1, rope: 1, ladder: 4, plank: 3, beacon: 1 }));
  });

  it("counts replayed bag drop actions for achievement progress", () => {
    expect(
      achievementProgressForTrip(
        {
          bankedCredits: 0,
          bankedParts: [],
          maxDepth: 1,
          moves: 3,
          bagDrops: 2,
          roofRescues: 1,
          collapsesSurvived: 1,
          used: stock(),
          granted: stock(),
          diff: [],
        },
        ["down", "drop:coal:1", "drop:copper:2"],
      ),
    ).toMatchObject({ bagDrops: 2, roofRescues: 1, collapsesSurvived: 1 });
  });

  it("ignores submitted bag drop actions that replay did not apply", () => {
    expect(
      achievementProgressForTrip(
        {
          bankedCredits: 0,
          bankedParts: [],
          maxDepth: 1,
          moves: 2,
          bagDrops: 0,
          roofRescues: 0,
          collapsesSurvived: 0,
          used: stock(),
          granted: stock(),
          diff: [],
        },
        ["down", "drop:coal:1"],
      ),
    ).toMatchObject({ bagDrops: 0 });
  });
});
