import { describe, expect, it } from "vitest";
import { accountJson } from "./account-response";

describe("accountJson", () => {
  it("marks account responses as non-cacheable", async () => {
    const res = accountJson({ ok: true });

    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("preserves status while adding no-store", () => {
    const res = accountJson(
      { error: "account sign-in required" },
      { status: 401 },
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
