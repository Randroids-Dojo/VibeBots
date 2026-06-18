import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import {
  getOrCreateActiveSaveSlot,
  saveSlotSummaries,
  switchActiveSaveSlot,
} from "@/server/player";
import { GET, POST } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(async () => "sql"),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  getOrCreateActiveSaveSlot: vi.fn(async () => ({
    playerId: "player-1",
    session: { activeSlot: 1, slots: { "1": "player-1" } },
  })),
  saveSlotSummaries: vi.fn(async () => [
    {
      slot: 1,
      active: true,
      exists: true,
      createdAt: "2026-06-18T00:00:00.000Z",
      balance: 12,
      deepestDepth: 5,
      partsOwned: 2,
      designs: 1,
      stamps: 3,
    },
    {
      slot: 2,
      active: false,
      exists: false,
      createdAt: null,
      balance: 0,
      deepestDepth: 0,
      partsOwned: 0,
      designs: 0,
      stamps: 0,
    },
    {
      slot: 3,
      active: false,
      exists: false,
      createdAt: null,
      balance: 0,
      deepestDepth: 0,
      partsOwned: 0,
      designs: 0,
      stamps: 0,
    },
  ]),
  switchActiveSaveSlot: vi.fn(async (slot: 1 | 2 | 3) => ({
    playerId: `player-${slot}`,
    session: {
      activeSlot: slot,
      slots: { "1": "player-1", [slot]: `player-${slot}` },
    },
  })),
}));

const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedGetOrCreateActiveSaveSlot = vi.mocked(getOrCreateActiveSaveSlot);
const mockedSwitchActiveSaveSlot = vi.mocked(switchActiveSaveSlot);
const mockedSaveSlotSummaries = vi.mocked(saveSlotSummaries);
const mockedDb = vi.mocked(db);

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/save-slots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/save-slots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorageConfigured.mockReturnValue(true);
  });

  it("lists the active save slot summaries", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(mockedGetOrCreateActiveSaveSlot).toHaveBeenCalled();
    expect(mockedDb).toHaveBeenCalled();
    expect(mockedSaveSlotSummaries).toHaveBeenCalledWith("sql", {
      activeSlot: 1,
      slots: { "1": "player-1" },
    });
    const body = await res.json();
    expect(body.activeSlot).toBe(1);
    expect(body.slots).toHaveLength(3);
  });

  it("switches to a requested slot", async () => {
    const res = await post({ slot: 2 });

    expect(res.status).toBe(200);
    expect(mockedSwitchActiveSaveSlot).toHaveBeenCalledWith(2);
    const body = await res.json();
    expect(body.activeSlot).toBe(2);
  });

  it("rejects invalid slot ids", async () => {
    const res = await post({ slot: 4 });

    expect(res.status).toBe(400);
    expect(mockedSwitchActiveSaveSlot).not.toHaveBeenCalled();
  });

  it("returns unavailable when storage is offline", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await GET();

    expect(res.status).toBe(503);
  });
});
