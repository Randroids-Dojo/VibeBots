import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { logSaveSlotEvent } from "@/server/monitoring";
import {
  deleteSaveSlot,
  getOrCreateActiveSaveSlot,
  saveSlotSummaries,
  switchActiveSaveSlot,
} from "@/server/player";
import { DELETE, GET, POST } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(async () => "sql"),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/monitoring", () => ({
  logSaveSlotEvent: vi.fn(),
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
  switchActiveSaveSlot: vi.fn(async (slot: 1 | 2 | 3, options = {}) => {
    const create = (options as { createIfMissing?: boolean }).createIfMissing;
    const existing = slot === 1 ? "player-1" : null;
    const playerId = existing ?? (create ? `player-${slot}` : null);
    return {
      playerId,
      created: !existing && Boolean(playerId),
      session: playerId
        ? {
            activeSlot: slot,
            slots: { "1": "player-1", [slot]: playerId },
          }
        : { activeSlot: 1, slots: { "1": "player-1" } },
    };
  }),
  deleteSaveSlot: vi.fn(async (slot: 1 | 2 | 3) => ({
    activeSlot: 1,
    slots: slot === 1 ? {} : { "1": "player-1" },
  })),
}));

const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedGetOrCreateActiveSaveSlot = vi.mocked(getOrCreateActiveSaveSlot);
const mockedSwitchActiveSaveSlot = vi.mocked(switchActiveSaveSlot);
const mockedDeleteSaveSlot = vi.mocked(deleteSaveSlot);
const mockedSaveSlotSummaries = vi.mocked(saveSlotSummaries);
const mockedDb = vi.mocked(db);
const mockedLogSaveSlotEvent = vi.mocked(logSaveSlotEvent);

function get(): Promise<Response> {
  return GET(
    new Request("http://localhost/api/save-slots", {
      headers: {
        referer: "https://vibecoded.games/play",
        "sec-fetch-site": "cross-site",
      },
    }),
  );
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/save-slots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function deleteRequest(body: unknown): Promise<Response> {
  return DELETE(
    new Request("http://localhost/api/save-slots", {
      method: "DELETE",
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
    const res = await get();

    expect(res.status).toBe(200);
    expect(mockedGetOrCreateActiveSaveSlot).toHaveBeenCalled();
    expect(mockedDb).toHaveBeenCalled();
    expect(mockedLogSaveSlotEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "save_slots.list",
        currentPlayerId: "player-1",
        referrerHost: "vibecoded.games",
        secFetchSite: "cross-site",
      }),
    );
    expect(mockedSaveSlotSummaries).toHaveBeenCalledWith("sql", {
      activeSlot: 1,
      slots: { "1": "player-1" },
    });
    const body = await res.json();
    expect(body.activeSlot).toBe(1);
    expect(body.slots).toHaveLength(3);
  });

  it("switches to a requested slot", async () => {
    const res = await post({ slot: 2, create: true });

    expect(res.status).toBe(200);
    expect(mockedSwitchActiveSaveSlot).toHaveBeenCalledWith(2, {
      createIfMissing: true,
    });
    const body = await res.json();
    expect(body.activeSlot).toBe(2);
  });

  it("does not create an empty save slot unless requested", async () => {
    const res = await post({ slot: 2 });

    expect(res.status).toBe(409);
    expect(mockedSwitchActiveSaveSlot).toHaveBeenCalledWith(2, {
      createIfMissing: false,
    });
    const body = await res.json();
    expect(body).toMatchObject({
      code: "empty_save_slot",
      activeSlot: 1,
    });
  });

  it("rejects invalid slot ids", async () => {
    const res = await post({ slot: 4 });

    expect(res.status).toBe(400);
    expect(mockedSwitchActiveSaveSlot).not.toHaveBeenCalled();
  });

  it("deletes a slot after an exact confirmation phrase", async () => {
    const res = await deleteRequest({ slot: 2, confirm: "DELETE SLOT 2" });

    expect(res.status).toBe(200);
    expect(mockedDeleteSaveSlot).toHaveBeenCalledWith(2);
    const body = await res.json();
    expect(body.activeSlot).toBe(1);
  });

  it("rejects save deletion without the confirmation phrase", async () => {
    const res = await deleteRequest({ slot: 2, confirm: "delete" });

    expect(res.status).toBe(400);
    expect(mockedDeleteSaveSlot).not.toHaveBeenCalled();
  });

  it("returns unavailable when storage is offline", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await get();

    expect(res.status).toBe(503);
  });
});
