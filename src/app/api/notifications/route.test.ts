import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import {
  disableWebPushSubscription,
  sendReleasePushNotifications,
  upsertWebPushSubscription,
  webPushConfigured,
  webPushPublicKey,
} from "@/server/web-push";
import { GET as configGet } from "./config/route";
import { POST as releasePost } from "./release/route";
import {
  DELETE as subscriptionDelete,
  POST as subscriptionPost,
} from "./subscription/route";

vi.mock("@/server/db", () => ({
  db: vi.fn(async () => "sql"),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

vi.mock("@/server/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/web-push")>();
  return {
    ...actual,
    disableWebPushSubscription: vi.fn(),
    sendReleasePushNotifications: vi.fn(async () => ({
      attempted: 2,
      sent: 1,
      expired: 1,
      failed: 0,
    })),
    upsertWebPushSubscription: vi.fn(),
    webPushConfigured: vi.fn(() => true),
    webPushPublicKey: vi.fn(() => "public-key"),
  };
});

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const mockedConfigured = vi.mocked(webPushConfigured);
const mockedPublicKey = vi.mocked(webPushPublicKey);
const mockedUpsert = vi.mocked(upsertWebPushSubscription);
const mockedDisable = vi.mocked(disableWebPushSubscription);
const mockedSend = vi.mocked(sendReleasePushNotifications);

const subscription = {
  endpoint: "https://push.example.test/subscription-1",
  keys: {
    p256dh: "p256dh-key",
    auth: "auth-key",
  },
};

function subscribe(body: unknown): Promise<Response> {
  return subscriptionPost(
    new Request("http://localhost/api/notifications/subscription", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Vitest",
      },
      body: JSON.stringify(body),
    }),
  );
}

function unsubscribe(body: unknown): Promise<Response> {
  return subscriptionDelete(
    new Request("http://localhost/api/notifications/subscription", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function dispatch(token: string | null): Promise<Response> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return releasePost(
    new Request("http://localhost/api/notifications/release", {
      method: "POST",
      headers,
    }),
  );
}

describe("notification API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.mockResolvedValue("sql" as never);
    mockedPlayer.mockResolvedValue("player-1");
    mockedStorageConfigured.mockReturnValue(true);
    mockedConfigured.mockReturnValue(true);
    mockedPublicKey.mockReturnValue("public-key");
    process.env.NOTIFICATION_ADMIN_TOKEN = "secret-token";
  });

  it("returns the public Web Push config and current release summary", async () => {
    const res = await configGet();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      configured: true,
      vapidPublicKey: "public-key",
      releaseNoticeId: "2026-09-04-0.1.314-weapon-angle",
      releaseSummary:
        "Angle your weapon: A weapon on a rigid mount can now sit level, tilt up 15 or 30, or down 15 or 30, from the Angle control in the part inspector. It is the second lever the sim reads, and it was measured before it shipped: the starter spike, level, loses to Gravestone; tilted up 15 it gets over the bar and wins. The debrief now says so after a loss to a rung an angle flips.",
    });
  });

  it("saves a subscription for the active player", async () => {
    const res = await subscribe({ subscription, platform: "android" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ subscribed: true });
    expect(mockedUpsert).toHaveBeenCalledWith({
      sql: "sql",
      playerId: "player-1",
      subscription,
      platform: "android",
      userAgent: "Vitest",
    });
  });

  it("rejects subscription writes when storage is unavailable", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await subscribe({ subscription, platform: "android" });

    expect(res.status).toBe(503);
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("marks a subscription disabled by endpoint", async () => {
    const res = await unsubscribe({ endpoint: subscription.endpoint });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ subscribed: false });
    expect(mockedDisable).toHaveBeenCalledWith("sql", subscription.endpoint);
  });

  it("requires the admin token before dispatching release pushes", async () => {
    const res = await dispatch("wrong-token");

    expect(res.status).toBe(401);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("rejects release dispatch when Web Push keys are unavailable", async () => {
    mockedConfigured.mockReturnValue(false);

    const res = await dispatch("secret-token");

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "web push not configured",
    });
    expect(mockedDb).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("dispatches the current release summary once authorized", async () => {
    const res = await dispatch("secret-token");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      releaseNoticeId: "2026-09-04-0.1.314-weapon-angle",
      attempted: 2,
      sent: 1,
      expired: 1,
      failed: 0,
    });
    expect(mockedSend).toHaveBeenCalledWith("sql", expect.any(Object));
  });
});
