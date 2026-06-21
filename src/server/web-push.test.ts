import { beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import type { AppRelease } from "@/lib/app-release-types";
import { dispatchReleasePushOnce } from "./web-push";

vi.mock("web-push", () => ({
  default: {
    sendNotification: vi.fn(async () => undefined),
    setVapidDetails: vi.fn(),
  },
}));

const release: AppRelease = {
  version: "0.1.124.124",
  build: 123,
  ref: "test-ref",
  noticeId: "2026-06-21-0.1.124-mine-terminal-state",
  intro: "Mine death and bunker UI now settle cleanly after reloads.",
  changes: [
    {
      build: 123,
      text: "Jump only appears when the sim says a jump is available, and diagnostics now log terminal replay and bunker-overlay input blockers.",
    },
  ],
  notes: [
    {
      version: "0.1.124",
      date: "2026-06-21",
      title: "Mine terminal state fix",
      intro: "Mine death and bunker UI now settle cleanly after reloads.",
      changes: [
        {
          build: 123,
          text: "Jump only appears when the sim says a jump is available, and diagnostics now log terminal replay and bunker-overlay input blockers.",
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
      expect.stringContaining("Mine terminal state fix"),
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
