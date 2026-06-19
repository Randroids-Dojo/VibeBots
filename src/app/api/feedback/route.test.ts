import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { POST } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const sql = vi.fn(async () => []);

function submit(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Vitest",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("feedback API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.mockResolvedValue(sql as never);
    mockedStorageConfigured.mockReturnValue(true);
    mockedPlayer.mockResolvedValue("player-1");
  });

  it("saves feedback for the active player with reviewed false", async () => {
    const res = await submit({
      category: "confusing",
      comment: "The ladder moved and I was not sure why.",
      email: "miner@example.test",
      context: {
        source: "ladder-gravity",
        appVersion: "0.1.63",
        mineVersion: 35,
        depth: 6,
        column: 1,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ saved: true });
    expect(mockedPlayer).toHaveBeenCalledOnce();
    const [strings, ...values] = sql.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const query = strings.join("");
    expect(query).toContain("INSERT INTO player_feedback");
    expect(query).toContain("reviewed");
    expect(query).toContain("false");
    expect(values).toEqual([
      "player-1",
      "confusing",
      "The ladder moved and I was not sure why.",
      "miner@example.test",
      JSON.stringify({
        source: "ladder-gravity",
        appVersion: "0.1.63",
        mineVersion: 35,
        depth: 6,
        column: 1,
      }),
      "Vitest",
    ]);
  });

  it("stores a blank email as null", async () => {
    const res = await submit({
      category: "positive",
      comment: "Nice.",
      email: "",
      context: { source: "pause" },
    });

    expect(res.status).toBe(200);
    expect(sql.mock.calls[0].slice(1)[3]).toBeNull();
  });

  it("rejects invalid feedback", async () => {
    const res = await submit({
      category: "other",
      comment: "",
      email: "not-an-email",
      context: { source: "pause" },
    });

    expect(res.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });

  it("returns unavailable when storage is not configured", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await submit({
      category: "bug",
      comment: "No storage.",
      context: { source: "pause" },
    });

    expect(res.status).toBe(503);
    expect(sql).not.toHaveBeenCalled();
  });
});
