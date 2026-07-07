import { beforeEach, describe, expect, it, vi } from "vitest";
import { findLinkedPlayerId } from "@/server/account-linking";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { db, storageConfigured } from "@/server/db";
import { currentPlayerId } from "@/server/player";
import { DEFAULT_GEAR, MINE_VERSION, NO_CONSUMABLES } from "@/sim/mine";
import { DELETE, GET, PUT } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  currentPlayerId: vi.fn(async () => "guest-player"),
}));

vi.mock("@/server/account-session", () => ({
  currentReadyAccountIdentity: vi.fn(async () => null),
  requestAccountSessionProvider: vi.fn(() => ({
    identity: async () => null,
    status: () => ({
      provider: "clerk",
      ready: true,
      reason: null,
      issues: [],
    }),
  })),
}));

vi.mock("@/server/account-linking", () => ({
  findLinkedPlayerId: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedCurrentPlayerId = vi.mocked(currentPlayerId);
const mockedCurrentReadyAccountIdentity = vi.mocked(
  currentReadyAccountIdentity,
);
const mockedRequestAccountSessionProvider = vi.mocked(
  requestAccountSessionProvider,
);
const mockedFindLinkedPlayerId = vi.mocked(findLinkedPlayerId);

const trip = {
  mineVersion: MINE_VERSION,
  seed: 123,
  tripIndex: 2,
  gear: DEFAULT_GEAR,
  consumables: NO_CONSUMABLES,
  baseDiff: [],
  moves: ["down"],
};

const identity = {
  provider: "clerk",
  subject: "clerk-user-1",
  email: "player@example.com",
};

function sqlWithRows(rows: unknown[] = []) {
  return vi.fn(async () => rows);
}

function sqlMock(rows: unknown[] = []): Awaited<ReturnType<typeof db>> {
  return sqlWithRows(rows) as unknown as Awaited<ReturnType<typeof db>>;
}

function sameOriginGet(): Request {
  return new Request("https://vibe-bots.test/api/account/trip", {
    method: "GET",
    headers: {
      origin: "https://vibe-bots.test",
      "sec-fetch-site": "same-origin",
    },
  });
}

function sameOriginPut(body: unknown): Request {
  return new Request("https://vibe-bots.test/api/account/trip", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://vibe-bots.test",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

describe("/api/account/trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorageConfigured.mockReturnValue(true);
    mockedCurrentPlayerId.mockResolvedValue("guest-player");
    mockedCurrentReadyAccountIdentity.mockResolvedValue(null);
    mockedRequestAccountSessionProvider.mockReturnValue({
      identity: async () => null,
      status: () => ({
        provider: "clerk",
        ready: true,
        reason: null,
        issues: [],
      }),
    });
    mockedFindLinkedPlayerId.mockResolvedValue(null);
    mockedDb.mockResolvedValue(sqlMock());
  });

  function sqlForWorld(worldRows: unknown[]) {
    const executed: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      executed.push(query);
      return query.includes("FROM mine_worlds") ? worldRows : [];
    });
    mockedDb.mockResolvedValue(
      sql as unknown as Awaited<ReturnType<typeof db>>,
    );
    return executed;
  }

  it("stores the current guest trip checkpoint", async () => {
    // First trip: no world row exists yet, so staleness cannot be judged.
    const executed = sqlForWorld([]);

    const res = await PUT(sameOriginPut({ trip }));

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(
      executed.some((query) => query.includes("mine_trip_checkpoints")),
    ).toBe(true);
    expect(await res.json()).toEqual({ stored: true });
  });

  it("stores a checkpoint that matches the server world", async () => {
    // Neon returns the bigint seed column as a string.
    const executed = sqlForWorld([{ seed: "123", trip_count: 2 }]);

    const res = await PUT(sameOriginPut({ trip }));

    expect(res.status).toBe(200);
    expect(
      executed.some((query) => query.includes("mine_trip_checkpoints")),
    ).toBe(true);
    expect(await res.json()).toEqual({ stored: true });
  });

  it("rejects a checkpoint from an older world without overwriting", async () => {
    // Another device banked: the server trip count moved past this trip.
    const executed = sqlForWorld([{ seed: "123", trip_count: 3 }]);

    const res = await PUT(sameOriginPut({ trip }));

    expect(res.status).toBe(409);
    expectNoStore(res);
    expect(
      executed.some((query) => query.includes("mine_trip_checkpoints")),
    ).toBe(false);
    expect(await res.json()).toEqual({
      error: "trip checkpoint is stale",
      code: "stale_trip_checkpoint",
    });
  });

  it("rejects a checkpoint from a different world seed", async () => {
    const executed = sqlForWorld([{ seed: "999", trip_count: 2 }]);

    const res = await PUT(sameOriginPut({ trip }));

    expect(res.status).toBe(409);
    expect(
      executed.some((query) => query.includes("mine_trip_checkpoints")),
    ).toBe(false);
    expect(await res.json()).toMatchObject({ code: "stale_trip_checkpoint" });
  });

  it("rejects malformed trip checkpoints before storage writes", async () => {
    const sql = sqlWithRows();
    mockedDb.mockResolvedValue(
      sql as unknown as Awaited<ReturnType<typeof db>>,
    );

    const res = await PUT(sameOriginPut({ trip: { ...trip, moves: ["bad"] } }));

    expect(res.status).toBe(400);
    expectNoStore(res);
    expect(sql).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: "invalid trip checkpoint" });
  });

  it("requires a current guest save before storing a checkpoint", async () => {
    mockedCurrentPlayerId.mockResolvedValue(null);

    const res = await PUT(sameOriginPut({ trip }));

    expect(res.status).toBe(409);
    expectNoStore(res);
    expect(mockedDb).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: "guest save required" });
  });

  it("blocks cross-site checkpoint writes before player lookup", async () => {
    const res = await PUT(
      new Request("https://vibe-bots.test/api/account/trip", {
        method: "PUT",
        headers: {
          origin: "https://evil.test",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ trip }),
      }),
    );

    expect(res.status).toBe(403);
    expectNoStore(res);
    expect(mockedCurrentPlayerId).not.toHaveBeenCalled();
  });

  it("loads the signed-in account trip checkpoint", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedFindLinkedPlayerId.mockResolvedValue("cloud-player");
    mockedDb.mockResolvedValue(sqlMock([{ trip }]));

    const res = await GET(sameOriginGet());

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedFindLinkedPlayerId).toHaveBeenCalledWith(
      expect.any(Function),
      identity,
    );
    expect(await res.json()).toEqual({ trip });
  });

  it("requires sign-in before loading a cloud checkpoint", async () => {
    const res = await GET(sameOriginGet());

    expect(res.status).toBe(401);
    expectNoStore(res);
    expect(mockedDb).not.toHaveBeenCalled();
  });

  it("clears the current player's stored checkpoint", async () => {
    const sql = sqlWithRows();
    mockedDb.mockResolvedValue(
      sql as unknown as Awaited<ReturnType<typeof db>>,
    );

    const res = await DELETE(
      new Request("https://vibe-bots.test/api/account/trip", {
        method: "DELETE",
        headers: {
          origin: "https://vibe-bots.test",
          "sec-fetch-site": "same-origin",
        },
      }),
    );

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(sql).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual({ cleared: true });
  });

  it("treats checkpoint cleanup without a current save as a no-op", async () => {
    mockedCurrentPlayerId.mockResolvedValue(null);

    const res = await DELETE(
      new Request("https://vibe-bots.test/api/account/trip", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedDb).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ cleared: false });
  });
});
