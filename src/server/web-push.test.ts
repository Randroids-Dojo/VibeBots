import { beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import type { AppRelease } from "@/lib/app-release-types";
import {
  dispatchReleasePushOnce,
  hashPushEndpoint,
  sendSaveSyncPushToOtherDevices,
} from "./web-push";

vi.mock("web-push", () => ({
  default: {
    sendNotification: vi.fn(async () => undefined),
    setVapidDetails: vi.fn(),
  },
}));

const release: AppRelease = {
  version: "0.1.127.127",
  build: 123,
  ref: "test-ref",
  noticeId: "2026-06-21-0.1.127-bunker-builder-controls",
  intro: "Base building is compact and walkable.",
  changes: [
    {
      build: 123,
      text: "Remove mode now owns placed-part taps, returns undamaged parts to inventory, and the builder includes walk buttons for moving while it stays open.",
    },
  ],
  notes: [
    {
      version: "0.1.127",
      date: "2026-06-21",
      title: "Bunker builder controls",
      intro: "Base building is compact and walkable.",
      changes: [
        {
          build: 123,
          text: "Remove mode now owns placed-part taps, returns undamaged parts to inventory, and the builder includes walk buttons for moving while it stays open.",
        },
      ],
    },
  ],
  showToAll: true,
};

interface SqlCall {
  query: string;
  values: unknown[];
}

function makeSql({
  claimed,
  reclaimed = false,
}: {
  claimed: boolean;
  reclaimed?: boolean;
}): {
  calls: SqlCall[];
  sql: never;
} {
  const calls: SqlCall[] = [];
  const sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("INSERT INTO release_push_dispatches")) {
      return claimed ? [{ notice_id: release.noticeId }] : [];
    }
    if (
      query.includes("UPDATE release_push_dispatches") &&
      query.includes("status IN ('failed', 'partial', 'sending')")
    ) {
      return reclaimed ? [{ notice_id: release.noticeId }] : [];
    }
    if (query.includes("SELECT endpoint, p256dh, auth")) {
      return [
        {
          endpoint: "https://push.example.test/device-1",
          p256dh: "p256dh-key",
          auth: "auth-key",
        },
      ];
    }
    return [];
  }) as never;
  return { calls, sql };
}

describe("release web push dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VAPID_PUBLIC_KEY = "public-key";
    process.env.VAPID_PRIVATE_KEY = "private-key";
  });

  it("does not send when another request already claimed the release", async () => {
    const { calls, sql } = makeSql({ claimed: false });

    const result = await dispatchReleasePushOnce(sql, release);

    expect(result).toEqual({
      dispatched: false,
      attempted: 0,
      sent: 0,
      expired: 0,
      failed: 0,
    });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it("claims, sends, and records one release dispatch", async () => {
    const { calls, sql } = makeSql({ claimed: true });

    const result = await dispatchReleasePushOnce(sql, release);

    expect(result).toEqual({
      dispatched: true,
      attempted: 1,
      sent: 1,
      expired: 0,
      failed: 0,
    });
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      "mailto:support@randroid.dev",
      "public-key",
      "private-key",
    );
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example.test/device-1",
        keys: {
          p256dh: "p256dh-key",
          auth: "auth-key",
        },
      },
      expect.stringContaining("Bunker builder controls"),
    );
    expect(
      calls.some((call) => call.query.includes("last_release_notice_id")),
    ).toBe(true);
    expect(
      calls.some((call) =>
        call.query.includes("UPDATE release_push_dispatches"),
      ),
    ).toBe(true);
  });

  it("recovers a stale sending release dispatch claim", async () => {
    const { calls, sql } = makeSql({ claimed: false, reclaimed: true });

    const result = await dispatchReleasePushOnce(sql, release);

    expect(result).toEqual({
      dispatched: true,
      attempted: 1,
      sent: 1,
      expired: 0,
      failed: 0,
    });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(
      calls.some((call) =>
        call.query.includes("status IN ('failed', 'partial', 'sending')"),
      ),
    ).toBe(true);
  });
});

describe("sendSaveSyncPushToOtherDevices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VAPID_PUBLIC_KEY = "public-key";
    process.env.VAPID_PRIVATE_KEY = "private-key";
  });

  function saveSyncSql(targets: unknown[]) {
    const calls: SqlCall[] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        calls.push({ query, values });
        return query.includes("SELECT endpoint") ? targets : [];
      },
    );
    return { sql: sql as never, calls };
  }

  const targets = [
    { endpoint: "https://push.example/one", p256dh: "p1", auth: "a1" },
    { endpoint: "https://push.example/two", p256dh: "p2", auth: "a2" },
  ];

  it("does nothing while web push is unconfigured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const { sql } = saveSyncSql(targets);

    const result = await sendSaveSyncPushToOtherDevices({
      sql,
      playerId: "player-1",
      excludeEndpointHash: null,
    });

    expect(result).toEqual({
      attempted: 0,
      sent: 0,
      expired: 0,
      failed: 0,
      skipped: 0,
    });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("wakes the player's other devices and stamps the rate limit", async () => {
    const { sql, calls } = saveSyncSql(targets);

    const result = await sendSaveSyncPushToOtherDevices({
      sql,
      playerId: "player-1",
      excludeEndpointHash: hashPushEndpoint("https://push.example/one"),
    });

    expect(result).toEqual({
      attempted: 1,
      sent: 1,
      expired: 0,
      failed: 0,
      skipped: 1,
    });
    // Only the non-originating endpoint is contacted.
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, payload] = vi.mocked(webpush.sendNotification).mock
      .calls[0];
    expect(subscription).toMatchObject({
      endpoint: "https://push.example/two",
    });
    expect(JSON.parse(String(payload))).toMatchObject({
      type: "save-sync",
      tag: "vibebots-save-sync",
      url: "/mine",
    });
    expect(
      calls.some((call) => call.query.includes("SET last_save_sync_at")),
    ).toBe(true);
  });

  it("disables expired subscriptions instead of retrying them", async () => {
    const { sql, calls } = saveSyncSql([targets[0]]);
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(
      Object.assign(new Error("gone"), { statusCode: 410 }),
    );

    const result = await sendSaveSyncPushToOtherDevices({
      sql,
      playerId: "player-1",
      excludeEndpointHash: null,
    });

    expect(result).toEqual({
      attempted: 1,
      sent: 0,
      expired: 1,
      failed: 0,
      skipped: 0,
    });
    expect(
      calls.some((call) => call.query.includes("SET enabled = false")),
    ).toBe(true);
  });
});
