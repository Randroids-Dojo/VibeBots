import { beforeEach, describe, expect, it, vi } from "vitest";
import { MINE_VERSION, NO_CONSUMABLES } from "@/sim/mine";
import {
  buyRemoteConsumable,
  buyRemoteElevator,
  buyRemoteGearUpgrade,
  cashOutErrorMessage,
  consumablesFromResponse,
  deleteRemoteSaveSlot,
  deleteSaveSlotConfirmation,
  isMineVersionMismatch,
  loadMineGear,
  loadMineWorld,
  loadSaveSlotSummaries,
  saveSlotSummariesFromResponse,
  submitMineBank,
  switchRemoteSaveSlot,
  teleportRemoteBase,
} from "./mine-api-client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("mine API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
    );
  });

  it("parses valid save slots and drops malformed rows", () => {
    const parsed = saveSlotSummariesFromResponse({
      activeSlot: 2,
      slots: [
        {
          slot: 1,
          active: false,
          exists: true,
          createdAt: "today",
          balance: 7,
          deepestDepth: 12,
          partsOwned: 3,
          designs: 2,
          stamps: 1,
        },
        { slot: 99, active: true },
        null,
      ],
    });

    expect(parsed).toEqual({
      activeSlot: 2,
      slots: [
        {
          slot: 1,
          active: false,
          exists: true,
          createdAt: "today",
          balance: 7,
          deepestDepth: 12,
          partsOwned: 3,
          designs: 2,
          stamps: 1,
        },
      ],
    });
  });

  it("rejects invalid save-slot response roots", () => {
    expect(
      saveSlotSummariesFromResponse({ activeSlot: 4, slots: [] }),
    ).toBeNull();
    expect(saveSlotSummariesFromResponse({ activeSlot: 1 })).toBeNull();
  });

  it("parses complete consumable bodies only", () => {
    expect(consumablesFromResponse({ ...NO_CONSUMABLES, ladder: 2 })).toEqual({
      ...NO_CONSUMABLES,
      ladder: 2,
    });
    expect(consumablesFromResponse({ ladder: 2 })).toBeNull();
  });

  it("preserves cash-out error messages", () => {
    expect(
      cashOutErrorMessage({ code: "mine_version_mismatch", error: "old" }),
    ).toBe("Mine updated. Your save is restored; start a fresh trip.");
    expect(cashOutErrorMessage({ error: "server said no" })).toBe(
      "server said no",
    );
    expect(cashOutErrorMessage(null)).toBe("cash out failed");
    expect(isMineVersionMismatch({ code: "mine_version_mismatch" })).toBe(true);
  });

  it("keeps the same request shapes for mine store wrappers", async () => {
    const fetchMock = vi.mocked(fetch);

    await loadMineWorld();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/mine/world");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toBeUndefined();

    await loadMineGear();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/gear");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toBeUndefined();

    await loadSaveSlotSummaries();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/save-slots");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toBeUndefined();

    await switchRemoteSaveSlot(2, { create: true });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/save-slots");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      slot: 2,
      create: true,
    });

    await deleteRemoteSaveSlot(3);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/save-slots");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "DELETE",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      slot: 3,
      confirm: deleteSaveSlotConfirmation(3),
    });

    await submitMineBank({
      seed: 1,
      tripIndex: 2,
      moves: ["down"],
      gear: { pickaxe: 1 },
      consumables: NO_CONSUMABLES,
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/mine/bank");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)),
    ).toMatchObject({
      seed: 1,
      tripIndex: 2,
      mineVersion: MINE_VERSION,
    });

    await buyRemoteConsumable("ladder", 4);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/consumables/buy");
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      item: "ladder",
      quantity: 4,
    });

    await buyRemoteGearUpgrade("lantern");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/gear/upgrade");
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      track: "lantern",
    });

    await buyRemoteElevator();
    expect(fetchMock.mock.calls.at(-1)).toEqual([
      "/api/elevator/upgrade",
      { method: "POST" },
    ]);

    await teleportRemoteBase(7);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/mine/base-teleport");
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      cost: 7,
    });
  });

  it("reports network failures with a null status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(loadMineWorld()).resolves.toEqual({
      ok: false,
      status: null,
      body: null,
    });
  });

  it("treats invalid success JSON as a failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
    );

    await expect(loadMineWorld()).resolves.toEqual({
      ok: false,
      status: 200,
      body: {},
    });
  });
});
