import { after } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUSH_ENDPOINT_HASH_HEADER } from "@/lib/mine-api-codes";
import {
  pushEndpointHashFromRequest,
  queueSaveSyncPush,
} from "./save-sync-push";
import { sendSaveSyncPushToOtherDevices } from "./web-push";

vi.mock("next/server", () => ({
  after: vi.fn((task: () => unknown) => {
    void task();
  }),
}));

vi.mock("./web-push", () => ({
  sendSaveSyncPushToOtherDevices: vi.fn(async () => ({
    attempted: 0,
    sent: 0,
    expired: 0,
    failed: 0,
    skipped: 0,
  })),
}));

const mockedAfter = vi.mocked(after);
const mockedSend = vi.mocked(sendSaveSyncPushToOtherDevices);

function requestWithHash(hash?: string): Request {
  return new Request("https://vibe-bots.test/api/mine/bank", {
    method: "POST",
    headers: hash ? { [PUSH_ENDPOINT_HASH_HEADER]: hash } : {},
  });
}

describe("pushEndpointHashFromRequest", () => {
  it("accepts only a hex sha-256", () => {
    const hash = "a".repeat(64);
    expect(pushEndpointHashFromRequest(requestWithHash(hash))).toBe(hash);
    expect(pushEndpointHashFromRequest(requestWithHash())).toBeNull();
    expect(pushEndpointHashFromRequest(requestWithHash("nope"))).toBeNull();
    expect(
      pushEndpointHashFromRequest(requestWithHash("Z".repeat(64))),
    ).toBeNull();
  });
});

describe("queueSaveSyncPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules the push after the response", () => {
    queueSaveSyncPush({
      sql: "sql" as never,
      playerId: "player-1",
      excludeEndpointHash: null,
    });

    expect(mockedAfter).toHaveBeenCalledOnce();
    expect(mockedSend).toHaveBeenCalledWith({
      sql: "sql",
      playerId: "player-1",
      excludeEndpointHash: null,
    });
  });

  it("still sends when no request scope exists", () => {
    mockedAfter.mockImplementationOnce(() => {
      throw new Error("after called outside a request scope");
    });

    queueSaveSyncPush({
      sql: "sql" as never,
      playerId: "player-1",
      excludeEndpointHash: "a".repeat(64),
    });

    expect(mockedSend).toHaveBeenCalledWith({
      sql: "sql",
      playerId: "player-1",
      excludeEndpointHash: "a".repeat(64),
    });
  });

  it("swallows push failures", async () => {
    mockedSend.mockRejectedValueOnce(new Error("push service down"));

    expect(() =>
      queueSaveSyncPush({
        sql: "sql" as never,
        playerId: "player-1",
        excludeEndpointHash: null,
      }),
    ).not.toThrow();
    // Let the queued task settle; the rejection must not surface.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
