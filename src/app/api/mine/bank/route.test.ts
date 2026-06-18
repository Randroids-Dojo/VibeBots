import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import {
  DEFAULT_GEAR,
  MINE_VERSION,
  type MineConsumables,
  NO_CONSUMABLES,
  STARTING_CONSUMABLES,
} from "@/sim/mine";
import {
  chargeableConsumables,
  gearOwnershipError,
  POST,
  paidConsumableSnapshotExceedsOwned,
  replayConsumablesForCashOut,
} from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/achievements", () => ({
  applyAchievementProgress: vi.fn(async () => {}),
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
  dynamite_count: 0,
  rope_count: 0,
  ladder_count: 0,
  plank_count: 0,
  beacon_count: 0,
  emeralds: 0,
  support_kit_granted_at: "2026-06-17T00:00:00.000Z",
  elevator_support_refund_at: null,
  legacy_support_snapshot_reconciled_at: "2026-06-17T00:00:00.000Z",
  dynamite_tier_unlock_reset_at: "2026-06-18T00:00:00.000Z",
};

const stock = (overrides: Partial<MineConsumables> = {}): MineConsumables => ({
  ...NO_CONSUMABLES,
  ...overrides,
});

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
      credited: { credits: 4 },
      balance: 12,
      consumables: stock({ rope: 1 }),
      tripIndex: 1,
    });
    expect(body.credited.soldHaul).toMatchObject({
      totalVibes: 4,
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
});

describe("mine bank policy helpers", () => {
  it("flags gear snapshots above owned profile levels", () => {
    expect(gearOwnershipError({ ...DEFAULT_GEAR, pickaxe: 2 }, ownedBase)).toBe(
      "gear not owned: pickaxe level 2",
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
        used: stock({ dynamite: 1, rope: 1, ladder: 7, plank: 5, beacon: 1 }),
        granted: stock({ ladder: 3, plank: 2 }),
        diff: [],
      }),
    ).toEqual(stock({ dynamite: 1, rope: 1, ladder: 4, plank: 3, beacon: 1 }));
  });
});
