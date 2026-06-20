import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAppRelease } from "@/lib/app-release";
import { db, storageConfigured } from "@/server/db";
import { dispatchReleasePushOnce, webPushConfigured } from "@/server/web-push";
import { GET } from "./route";

vi.mock("@/lib/app-release", () => ({
  getAppRelease: vi.fn(() => ({
    version: "0.1.119.123",
    noticeId: "2026-06-20-0.1.119-jump-button-placement",
  })),
}));

vi.mock("@/server/db", () => ({
  db: vi.fn(async () => "sql"),
  storageConfigured: vi.fn(() => false),
}));

vi.mock("@/server/web-push", () => ({
  dispatchReleasePushOnce: vi.fn(async () => ({
    dispatched: true,
    attempted: 1,
    sent: 1,
    expired: 0,
    failed: 0,
  })),
  webPushConfigured: vi.fn(() => false),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedDispatchReleasePushOnce = vi.mocked(dispatchReleasePushOnce);
const mockedWebPushConfigured = vi.mocked(webPushConfigured);

describe("version API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorageConfigured.mockReturnValue(false);
    mockedWebPushConfigured.mockReturnValue(false);
    mockedDb.mockResolvedValue("sql" as never);
  });

  it("returns the current app release version without cache", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ version: "0.1.119.123" });
    expect(getAppRelease).toHaveBeenCalledOnce();
    expect(mockedDispatchReleasePushOnce).not.toHaveBeenCalled();
  });

  it("dispatches the current release notification once when configured", async () => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedWebPushConfigured.mockReturnValue(true);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(mockedDb).toHaveBeenCalledOnce();
    expect(mockedDispatchReleasePushOnce).toHaveBeenCalledWith(
      "sql",
      expect.objectContaining({
        version: "0.1.119.123",
        noticeId: "2026-06-20-0.1.119-jump-button-placement",
      }),
    );
  });
});
