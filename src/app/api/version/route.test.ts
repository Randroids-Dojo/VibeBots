import { describe, expect, it, vi } from "vitest";
import { getAppRelease } from "@/lib/app-release";
import { GET } from "./route";

vi.mock("@/lib/app-release", () => ({
  getAppRelease: vi.fn(() => ({ version: "0.1.56.123" })),
}));

describe("version API route", () => {
  it("returns the current app release version without cache", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ version: "0.1.56.123" });
    expect(getAppRelease).toHaveBeenCalledOnce();
  });
});
