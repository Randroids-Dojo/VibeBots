import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import {
  getMinePlayerProfile,
  getOrCreateActiveSaveSlot,
} from "@/server/player";
import type { WorldDiff } from "@/sim/mine";
import { GET } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/player")>();
  return {
    ...actual,
    getMinePlayerProfile: vi.fn(),
    getOrCreateActiveSaveSlot: vi.fn(async () => ({
      playerId: "player-1",
      session: { activeSlot: 1, slots: { "1": "player-1" } },
    })),
  };
});

const mockedDb = vi.mocked(db);
const mockedStorage = vi.mocked(storageConfigured);
const mockedProfile = vi.mocked(getMinePlayerProfile);
const mockedActiveSlot = vi.mocked(getOrCreateActiveSaveSlot);

function profile(overrides: Record<string, unknown> = {}) {
  return {
    elevator_depth: 1,
    elevator_col: 27,
    elevator_support_refund_at: null,
    elevator_rail_installed_at: null,
    elevator_placement_chosen_at: null,
    ...overrides,
  };
}

function mockSql(
  diff: WorldDiff,
  migrationUpdated = true,
  refundSupports = true,
  winningWorld: { diff: WorldDiff; trip_count: number } = {
    diff,
    trip_count: 3,
  },
) {
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("INSERT INTO mine_worlds")) {
      return [{ seed: 123, diff, trip_count: 2 }];
    }
    if (query.includes("UPDATE players")) {
      return migrationUpdated
        ? [
            {
              id: "player-1",
              refund_supports: refundSupports,
              trip_count: 3,
            },
          ]
        : [];
    }
    if (query.includes("SELECT diff, trip_count") && !migrationUpdated) {
      return [winningWorld];
    }
    return [];
  });
  mockedDb.mockResolvedValue(sql as never);
  return sql;
}

describe("GET /api/mine/world", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorage.mockReturnValue(true);
    mockedActiveSlot.mockResolvedValue({
      playerId: "player-1",
      session: { activeSlot: 1, slots: { "1": "player-1" } },
    });
  });

  it("installs and refunds legacy supports only in the chosen shaft", async () => {
    const diff: WorldDiff = [
      [27, 1, { kind: "empty", ladder: true }],
      [-5, 1, { kind: "empty", ladder: true }],
    ];
    const sql = mockSql(diff);
    mockedProfile.mockResolvedValue(profile() as never);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      seed: 123,
      tripIndex: 3,
      activeSlot: 1,
      refundedSupports: { ladder: 1 },
    });
    expect(body.diff).toContainEqual([-5, 1, { kind: "empty", ladder: true }]);
    expect(body.diff).toContainEqual([27, 1, { kind: "empty" }]);
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("elevator_rail_installed_at = now()"),
      ),
    ).toBe(true);
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("trip_count = trip_count + 1"),
      ),
    ).toBe(true);
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("WHEN elevator_support_refund_at IS NULL"),
      ),
    ).toBe(true);
  });

  it("resolves an unmigrated legacy rail to the old fixed column", async () => {
    const diff: WorldDiff = [[-5, 1, { kind: "empty", plank: true }]];
    mockSql(diff);
    mockedProfile.mockResolvedValue(profile({ elevator_col: null }) as never);

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      refundedSupports: { plank: 1 },
    });
  });

  it("installs legacy rail without double-refunding its supports", async () => {
    const sql = mockSql(
      [[27, 1, { kind: "empty", ladder: true }]],
      true,
      false,
    );
    mockedProfile.mockResolvedValue(
      profile({ elevator_support_refund_at: "now" }) as never,
    );

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      diff: [[27, 1, { kind: "empty" }]],
      refundedSupports: {},
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("elevator_rail_installed_at = now()"),
      ),
    ).toBe(true);
  });

  it("repairs a marked shaft if an older deployment overwrites its rail", async () => {
    const sql = mockSql([[27, 1, { kind: "dirt" }]], true, false);
    mockedProfile.mockResolvedValue(
      profile({
        elevator_support_refund_at: "now",
        elevator_rail_installed_at: "now",
      }) as never,
    );

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      diff: [[27, 1, { kind: "empty" }]],
      refundedSupports: {},
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE mine_worlds"),
      ),
    ).toBe(true);
  });

  it("uses the locked refund marker instead of a stale profile snapshot", async () => {
    const sql = mockSql(
      [[27, 1, { kind: "empty", ladder: true }]],
      true,
      false,
    );
    mockedProfile.mockResolvedValue(profile() as never);

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      diff: [[27, 1, { kind: "empty" }]],
      refundedSupports: {},
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("elevator_support_refund_at IS NULL"),
      ),
    ).toBe(true);
  });

  it("does not rerun rail installation after its own marker is set", async () => {
    const diff: WorldDiff = [[27, 1, { kind: "empty" }]];
    const sql = mockSql(diff);
    mockedProfile.mockResolvedValue(
      profile({
        elevator_support_refund_at: "now",
        elevator_rail_installed_at: "now",
      }) as never,
    );

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      diff,
      tripIndex: 2,
      refundedSupports: {},
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });

  it("returns the winning checkpoint when the guarded migration loses", async () => {
    const diff: WorldDiff = [[27, 1, { kind: "empty", ladder: true }]];
    const winningDiff: WorldDiff = [[42, 1, { kind: "empty" }]];
    const sql = mockSql(diff, false, true, {
      diff: winningDiff,
      trip_count: 9,
    });
    mockedProfile.mockResolvedValue(profile() as never);

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      diff: winningDiff,
      tripIndex: 9,
      refundedSupports: {},
    });
    expect(
      sql.mock.calls.filter(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toHaveLength(1);
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("SELECT diff, trip_count"),
      ),
    ).toBe(true);
  });
});
