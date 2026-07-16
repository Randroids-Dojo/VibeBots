import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GEAR, MINE_VERSION, NO_CONSUMABLES } from "@/sim/mine";
import {
  accountCloudLoadFromResponse,
  accountErrorMessageFromResponse,
  accountHandoffStartFromResponse,
  accountStatusFromResponse,
  accountTripFromResponse,
  buyRemoteConsumable,
  buyRemoteElevator,
  buyRemoteGearUpgrade,
  cashOutErrorMessage,
  claimRemoteAccountSave,
  clearRemoteAccountTrip,
  consumablesFromResponse,
  deleteRemoteSaveSlot,
  deleteSaveSlotConfirmation,
  finishRemoteAccountHandoff,
  isMineVersionMismatch,
  isStaleTripCheckpoint,
  isTripAlreadyCashedOut,
  loadAccountStatus,
  loadMineGear,
  loadMineWorld,
  loadRemoteAccountSave,
  loadRemoteAccountTrip,
  loadSaveSlotSummaries,
  saveSlotSummariesFromResponse,
  startRemoteAccountHandoff,
  storeRemoteAccountTrip,
  submitMineBank,
  switchRemoteSaveSlot,
  teleportRemoteBase,
  worldVersionFromResponse,
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

  it("maps account error codes to player copy, prose to the fallback", () => {
    expect(
      accountErrorMessageFromResponse(
        { error: "anything", code: "guest_save_not_found" },
        "claim failed",
      ),
    ).toBe("guest save not found");
    // Prose without a code never drives copy: the wording is not a contract.
    expect(
      accountErrorMessageFromResponse(
        { error: "guest save not found" },
        "claim failed",
      ),
    ).toBe("claim failed");
    expect(
      accountErrorMessageFromResponse(
        { error: "boom", code: "not_a_real_code" },
        "claim failed",
      ),
    ).toBe("claim failed");
    expect(accountErrorMessageFromResponse(null, "claim failed")).toBe(
      "claim failed",
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

  it("parses account status responses", () => {
    expect(
      accountStatusFromResponse({
        mode: "conflict",
        providerStatus: {
          provider: "clerk",
          ready: true,
          reason: null,
          issues: [],
        },
        activeSlot: 2,
        account: { provider: "clerk", email: "pilot@example.com" },
        currentSave: {
          exists: true,
          createdAt: "2026-07-04T00:00:00.000Z",
          balance: 12,
          deepestDepth: 4,
          partsOwned: 3,
          designs: 2,
          stamps: 1,
        },
        accountSave: {
          exists: true,
          createdAt: "2026-07-03T00:00:00.000Z",
          balance: 20,
          deepestDepth: 9,
          partsOwned: 5,
          designs: 4,
          stamps: 3,
        },
      }),
    ).toEqual({
      mode: "conflict",
      providerStatus: {
        provider: "clerk",
        ready: true,
        reason: null,
        issues: [],
      },
      activeSlot: 2,
      account: { provider: "clerk", email: "pilot@example.com" },
      currentSave: {
        exists: true,
        createdAt: "2026-07-04T00:00:00.000Z",
        balance: 12,
        deepestDepth: 4,
        partsOwned: 3,
        designs: 2,
        stamps: 1,
      },
      accountSave: {
        exists: true,
        createdAt: "2026-07-03T00:00:00.000Z",
        balance: 20,
        deepestDepth: 9,
        partsOwned: 5,
        designs: 4,
        stamps: 3,
      },
    });
    expect(accountStatusFromResponse({ mode: "guest" })).toMatchObject({
      providerStatus: {
        provider: "clerk",
        ready: false,
        reason: null,
        issues: [],
      },
    });
    expect(
      accountStatusFromResponse({
        mode: "guest",
        providerStatus: {
          provider: "clerk",
          ready: false,
          reason: "sdk_not_wired",
          issues: [
            "sdk_not_wired",
            "publishable_key_missing",
            "secret_key_missing",
            "public_sign_in_url_missing",
            "public_sign_in_fallback_url_missing",
            "public_sign_up_fallback_url_missing",
          ],
        },
      }),
    ).toMatchObject({
      providerStatus: {
        provider: "clerk",
        ready: false,
        reason: "sdk_not_wired",
        issues: [
          "sdk_not_wired",
          "publishable_key_missing",
          "secret_key_missing",
          "public_sign_in_url_missing",
          "public_sign_in_fallback_url_missing",
          "public_sign_up_fallback_url_missing",
        ],
      },
    });
    expect(
      accountStatusFromResponse({
        mode: "guest",
        providerStatus: {
          provider: "clerk",
          ready: false,
          reason: "sdk_not_wired",
        },
      }),
    ).toMatchObject({
      providerStatus: {
        reason: "sdk_not_wired",
        issues: ["sdk_not_wired"],
      },
    });
    expect(
      accountStatusFromResponse({
        mode: "guest",
        providerStatus: {
          provider: "clerk",
          ready: true,
          reason: "sdk_not_wired",
          issues: ["sdk_not_wired"],
        },
      }),
    ).toMatchObject({
      providerStatus: {
        ready: false,
        reason: "sdk_not_wired",
        issues: ["sdk_not_wired"],
      },
    });
    expect(
      accountStatusFromResponse({
        mode: "guest",
        providerStatus: {
          provider: "other",
          ready: true,
          reason: null,
          issues: [],
        },
      }),
    ).toMatchObject({
      providerStatus: {
        provider: "clerk",
        ready: false,
        reason: null,
        issues: [],
      },
    });
    expect(
      accountStatusFromResponse({
        mode: "guest",
        providerStatus: {
          provider: "clerk",
          ready: true,
          reason: "unexpected_setup_issue",
          issues: ["unexpected_setup_issue"],
        },
      }),
    ).toMatchObject({
      providerStatus: {
        provider: "clerk",
        ready: false,
        reason: null,
        issues: [],
      },
    });
  });

  it("rejects invalid account status roots", () => {
    expect(accountStatusFromResponse({ mode: "other" })).toBeNull();
    expect(accountStatusFromResponse(null)).toBeNull();
  });

  it("rejects account-owned status modes without their required fields", () => {
    expect(
      accountStatusFromResponse({
        mode: "signed_in",
        activeSlot: 1,
        currentSave: { exists: true },
      }),
    ).toBeNull();
    expect(
      accountStatusFromResponse({
        mode: "cloud_loaded",
        activeSlot: 1,
        account: { provider: "clerk", email: "pilot@example.com" },
        currentSave: { exists: true },
      }),
    ).toBeNull();
    expect(
      accountStatusFromResponse({
        mode: "conflict",
        activeSlot: 1,
        account: { provider: "clerk", email: "pilot@example.com" },
        accountSave: { exists: false },
      }),
    ).toBeNull();
  });

  it("rejects malformed account metadata before rendering status", () => {
    expect(
      accountStatusFromResponse({
        mode: "signed_in",
        activeSlot: 1,
        account: { provider: "clerk auth", email: "pilot@example.com" },
      }),
    ).toBeNull();
    expect(
      accountStatusFromResponse({
        mode: "signed_in",
        activeSlot: 1,
        account: {
          provider: "clerk",
          email: "pilot@example.com\ncc@example.com",
        },
      }),
    ).toBeNull();
    expect(
      accountStatusFromResponse({
        mode: "signed_in",
        activeSlot: 1,
        account: { provider: "clerk", email: 42 },
      }),
    ).toBeNull();
    expect(
      accountStatusFromResponse({
        mode: "signed_in",
        activeSlot: 1,
        account: { provider: "clerk", email: { at: "pilot@example.com" } },
      }),
    ).toBeNull();
    expect(
      accountStatusFromResponse({
        mode: "signed_in",
        activeSlot: 1,
        account: {
          provider: " Clerk ",
          email: " Pilot@Example.com ",
        },
      }),
    ).toMatchObject({
      account: { provider: "clerk", email: "Pilot@Example.com" },
    });
  });

  it("parses account handoff start responses", () => {
    expect(
      accountHandoffStartFromResponse({
        handoffId: " handoff-1 ",
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "/mine",
      }),
    ).toEqual({
      handoffId: "handoff-1",
      expiresAt: "2026-07-04T00:10:00.000Z",
      returnTo: "/mine",
    });
    expect(
      accountHandoffStartFromResponse({ handoffId: "handoff-1" }),
    ).toBeNull();
    expect(
      accountHandoffStartFromResponse({
        handoffId: "handoff-2",
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "https://evil.test/capture",
      }),
    ).toEqual({
      handoffId: "handoff-2",
      expiresAt: "2026-07-04T00:10:00.000Z",
      returnTo: "/mine",
    });
    expect(
      accountHandoffStartFromResponse({
        handoffId: "handoff-3",
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "/mine\n?accountHandoff=bad",
      }),
    ).toEqual({
      handoffId: "handoff-3",
      expiresAt: "2026-07-04T00:10:00.000Z",
      returnTo: "/mine",
    });
    expect(
      accountHandoffStartFromResponse({
        handoffId: "handoff/1",
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "/mine",
      }),
    ).toBeNull();
    expect(
      accountHandoffStartFromResponse({
        handoffId: "h".repeat(129),
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "/mine",
      }),
    ).toBeNull();
  });

  it("parses cloud-load responses only when the account save is present", () => {
    expect(
      accountCloudLoadFromResponse({
        mode: "cloud_loaded",
        activeSlot: 2,
        accountSave: {
          exists: true,
          createdAt: "2026-07-04T00:00:00.000Z",
          balance: 20,
          deepestDepth: 9,
          partsOwned: 5,
          designs: 4,
          stamps: 3,
        },
      }),
    ).toEqual({
      mode: "cloud_loaded",
      activeSlot: 2,
      accountSave: {
        exists: true,
        createdAt: "2026-07-04T00:00:00.000Z",
        balance: 20,
        deepestDepth: 9,
        partsOwned: 5,
        designs: 4,
        stamps: 3,
      },
    });
    expect(
      accountCloudLoadFromResponse({
        mode: "cloud_loaded",
        activeSlot: 4,
        accountSave: { exists: true },
      }),
    ).toBeNull();
    expect(
      accountCloudLoadFromResponse({
        mode: "cloud_loaded",
        activeSlot: 1,
        accountSave: { exists: false },
      }),
    ).toBeNull();
    expect(
      accountCloudLoadFromResponse({
        mode: "conflict",
        activeSlot: 1,
        accountSave: { exists: true },
      }),
    ).toBeNull();
  });

  it("parses account trip checkpoint responses", () => {
    expect(
      accountTripFromResponse({
        trip: {
          mineVersion: MINE_VERSION,
          seed: 123,
          tripIndex: 2,
          gear: { ...DEFAULT_GEAR, pickaxe: 2 },
          consumables: NO_CONSUMABLES,
          baseDiff: [],
          moves: ["down"],
        },
      }),
    ).toMatchObject({
      mineVersion: MINE_VERSION,
      seed: 123,
      tripIndex: 2,
      moves: ["down"],
      gear: { pickaxe: 2, warpcoil: 1, recall: 1 },
    });
    expect(accountTripFromResponse({ trip: null })).toBeNull();
    expect(
      accountTripFromResponse({
        trip: {
          mineVersion: MINE_VERSION,
          seed: 123,
          tripIndex: 2,
          gear: {},
          consumables: NO_CONSUMABLES,
          baseDiff: [],
          moves: ["bad"],
        },
      }),
    ).toBeNull();
  });

  it("validates the pending bunker shape on trip checkpoints", () => {
    const validPendingBunker = {
      claimCol: 3,
      claimRow: 4,
      claimedAtMoveCount: 6,
      bunker: {
        footprint: { col: 3, row: 4, width: 3, height: 3 },
        parts: [],
      },
      inventory: {
        "wall-panel": 1,
        "floor-panel": 2,
        "roof-panel": 2,
        "door-panel": 1,
        "basic-turret": 0,
        "floor-spikes": 0,
      },
    };
    const baseTrip = {
      mineVersion: MINE_VERSION,
      seed: 123,
      tripIndex: 2,
      gear: { ...DEFAULT_GEAR },
      consumables: NO_CONSUMABLES,
      baseDiff: [],
      moves: ["down"],
    };

    expect(
      accountTripFromResponse({
        trip: { ...baseTrip, pendingBunker: validPendingBunker },
      }),
    ).toMatchObject({ pendingBunker: validPendingBunker });
    expect(
      accountTripFromResponse({ trip: { ...baseTrip, pendingBunker: null } }),
    ).toMatchObject({ pendingBunker: null });
    expect(accountTripFromResponse({ trip: baseTrip })).toMatchObject({
      pendingBunker: null,
    });
    expect(
      accountTripFromResponse({
        trip: { ...baseTrip, pendingBunker: "not-an-object" },
      }),
    ).toBeNull();
    expect(
      accountTripFromResponse({
        trip: {
          ...baseTrip,
          pendingBunker: { ...validPendingBunker, claimCol: "3" },
        },
      }),
    ).toBeNull();
    expect(
      accountTripFromResponse({
        trip: {
          ...baseTrip,
          pendingBunker: {
            ...validPendingBunker,
            bunker: { footprint: {}, parts: "nope" },
          },
        },
      }),
    ).toBeNull();
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

  it("recognizes a lost cash-out race by its code", () => {
    expect(isTripAlreadyCashedOut({ code: "trip_already_cashed_out" })).toBe(
      true,
    );
    expect(isTripAlreadyCashedOut({ error: "trip already cashed out" })).toBe(
      false,
    );
    expect(isTripAlreadyCashedOut(null)).toBe(false);
    expect(isStaleTripCheckpoint({ code: "stale_trip_checkpoint" })).toBe(true);
    expect(isStaleTripCheckpoint({ code: "trip_already_cashed_out" })).toBe(
      false,
    );
  });

  it("parses world version probes and rejects malformed ones", () => {
    expect(
      worldVersionFromResponse({ world: { seed: 4243, tripCount: 7 } }),
    ).toEqual({ seed: 4243, tripCount: 7 });
    expect(worldVersionFromResponse({ world: null })).toBeNull();
    expect(
      worldVersionFromResponse({ world: { seed: "4243", tripCount: 7 } }),
    ).toBeNull();
    expect(worldVersionFromResponse(null)).toBeNull();
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

    await loadAccountStatus();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/account/status");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toBeUndefined();

    await claimRemoteAccountSave();
    expect(fetchMock.mock.calls.at(-1)).toEqual([
      "/api/account/claim",
      {
        method: "POST",
        headers: { "x-vibebots-account-mutation": "1" },
      },
    ]);

    await loadRemoteAccountSave();
    expect(fetchMock.mock.calls.at(-1)).toEqual([
      "/api/account/load",
      {
        method: "POST",
        headers: { "x-vibebots-account-mutation": "1" },
      },
    ]);

    await loadRemoteAccountTrip();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/account/trip");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toBeUndefined();

    await storeRemoteAccountTrip({
      mineVersion: MINE_VERSION,
      seed: 123,
      tripIndex: 2,
      gear: DEFAULT_GEAR,
      consumables: NO_CONSUMABLES,
      baseDiff: [],
      moves: ["down"],
    });
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/account/trip");
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "PUT",
      headers: expect.objectContaining({
        "x-vibebots-account-mutation": "1",
      }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      trip: expect.objectContaining({
        mineVersion: MINE_VERSION,
        seed: 123,
        moves: ["down"],
      }),
    });

    await clearRemoteAccountTrip();
    expect(fetchMock.mock.calls.at(-1)).toEqual([
      "/api/account/trip",
      {
        method: "DELETE",
        headers: { "x-vibebots-account-mutation": "1" },
      },
    ]);

    await startRemoteAccountHandoff("/mine?panel=account");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/account/handoff/start");
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toMatchObject({
      "content-type": "application/json",
      "x-vibebots-account-mutation": "1",
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      returnTo: "/mine?panel=account",
    });

    await finishRemoteAccountHandoff(" handoff-1 ");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      "/api/account/handoff/finish",
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toMatchObject({
      "content-type": "application/json",
      "x-vibebots-account-mutation": "1",
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      handoffId: "handoff-1",
    });

    const callsBeforeInvalidHandoff = fetchMock.mock.calls.length;
    await expect(finishRemoteAccountHandoff("handoff/1")).resolves.toEqual({
      ok: false,
      status: 400,
      body: { error: "handoff id required" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeInvalidHandoff);

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

    await buyRemoteElevator(-17);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/elevator/upgrade");
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      column: -17,
    });

    await buyRemoteElevator();
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual(
      {},
    );

    await buyRemoteElevator(-17, 3);
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      column: -17,
      expectedDepth: 3,
    });

    await buyRemoteElevator(undefined, 4);
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toEqual({
      expectedDepth: 4,
    });

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

describe("account trip pending bunker depth normalization", () => {
  it("normalizes pre-depth pendingBunker parts in account trips", () => {
    const trip = accountTripFromResponse({
      trip: {
        mineVersion: MINE_VERSION,
        seed: 5,
        tripIndex: 1,
        gear: DEFAULT_GEAR,
        consumables: NO_CONSUMABLES,
        baseDiff: [],
        moves: [],
        pendingBunker: {
          claimCol: 4,
          claimRow: 8,
          claimedAtMoveCount: 0,
          bunker: {
            footprint: { col: 1, row: 4, width: 7, height: 5 },
            parts: [{ partId: "wall-panel", col: 2, row: 5, durability: 90 }],
          },
          inventory: {},
        },
      },
    });

    expect(trip?.pendingBunker?.bunker.parts).toEqual([
      { partId: "wall-panel", col: 2, row: 5, depth: 0, durability: 90 },
    ]);
  });
});
