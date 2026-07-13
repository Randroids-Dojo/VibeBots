import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BunkerRouteResponse } from "@/lib/bunker-api-types";
import { EMPTY_BASE_PART_INVENTORY } from "@/sim/bunker";
import {
  bunkerErrorMessage,
  buyRemoteBasePart,
  claimRemoteBunker,
  collectRemoteRaidPickup,
  finishRemoteBunkerRaid,
  loadRemoteBunker,
  moveRemoteBunkerPart,
  placeRemoteBunkerPart,
  removeRemoteBunkerPart,
  startRemoteBunkerRaid,
} from "./bunker-api-client";

const view: BunkerRouteResponse = {
  bunker: null,
  inventory: { ...EMPTY_BASE_PART_INVENTORY },
  activeRaid: null,
  player: {
    balance: 12,
    trackXp: 0,
    defenseXp: 20,
    overallLevel: 1,
    levelCap: 100,
    progressXp: 20,
    neededXp: 80,
    nextLevelXp: 100,
    beaconLimit: 2,
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function lastBody() {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body));
}

describe("bunker API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(view)));
  });

  it("keeps the load request shape", async () => {
    await expect(loadRemoteBunker()).resolves.toEqual({
      ok: true,
      status: 200,
      body: view,
    });
    expect(vi.mocked(fetch).mock.calls.at(-1)).toEqual(["/api/bunker"]);
  });

  it("keeps bunker mutation request shapes", async () => {
    await claimRemoteBunker(7, 5);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe("/api/bunker/claim");
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(lastBody()).toEqual({ col: 7, row: 5 });

    await buyRemoteBasePart("wall-panel", 3);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      "/api/bunker/parts/buy",
    );
    expect(lastBody()).toEqual({ partId: "wall-panel", quantity: 3 });

    await placeRemoteBunkerPart("door-panel", 8, 6);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      "/api/bunker/parts/place",
    );
    expect(lastBody()).toEqual({
      partId: "door-panel",
      col: 8,
      row: 6,
      depth: 0,
    });

    await placeRemoteBunkerPart("door-panel", 8, 6, 2);
    expect(lastBody()).toEqual({
      partId: "door-panel",
      col: 8,
      row: 6,
      depth: 2,
    });

    await removeRemoteBunkerPart(8, 6);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      "/api/bunker/parts/remove",
    );
    expect(lastBody()).toEqual({ col: 8, row: 6, depth: 0 });

    await removeRemoteBunkerPart(8, 6, 1);
    expect(lastBody()).toEqual({ col: 8, row: 6, depth: 1 });

    await moveRemoteBunkerPart(8, 6, 9, 6);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      "/api/bunker/parts/move",
    );
    expect(lastBody()).toEqual({
      fromCol: 8,
      fromRow: 6,
      toCol: 9,
      toRow: 6,
      fromDepth: 0,
      toDepth: 0,
    });

    await moveRemoteBunkerPart(8, 6, 8, 6, 0, 3);
    expect(lastBody()).toEqual({
      fromCol: 8,
      fromRow: 6,
      toCol: 8,
      toRow: 6,
      fromDepth: 0,
      toDepth: 3,
    });

    await startRemoteBunkerRaid();
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      "/api/bunker/raid/start",
    );
    expect(lastBody()).toEqual({ tier: 1 });

    await collectRemoteRaidPickup(9, 4);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      "/api/bunker/raid/collect",
    );
    expect(lastBody()).toEqual({ col: 9, row: 4 });

    await finishRemoteBunkerRaid();
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe(
      "/api/bunker/raid/finish",
    );
    expect(lastBody()).toEqual({});
  });

  it("returns non-ok responses with their parsed error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "blocked" }, 409)),
    );

    await expect(startRemoteBunkerRaid()).resolves.toEqual({
      ok: false,
      status: 409,
      body: { error: "blocked" },
    });
    expect(bunkerErrorMessage({ error: "blocked" }, "fallback")).toBe(
      "blocked",
    );
    expect(bunkerErrorMessage(null, "fallback")).toBe("fallback");
  });

  it("reports network failures with a null status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(loadRemoteBunker()).resolves.toEqual({
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

    await expect(loadRemoteBunker()).resolves.toEqual({
      ok: false,
      status: 200,
      body: {},
    });
  });
});
