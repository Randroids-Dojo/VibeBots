import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  safeAccountHandoffId,
  safeAccountReturnTo,
  safeLocalAccountReturnTo,
} from "./account-handoff-contract";

describe("account handoff contract", () => {
  it("keeps return paths local to the app", () => {
    expect(safeAccountReturnTo("/mine")).toBe("/mine");
    expect(safeAccountReturnTo("/mine?panel=account")).toBe(
      "/mine?panel=account",
    );
    expect(safeAccountReturnTo("/mine#account")).toBe("/mine#account");
    expect(safeAccountReturnTo("https://evil.test")).toBe("/mine");
    expect(safeAccountReturnTo("//evil.test")).toBe("/mine");
    expect(safeAccountReturnTo("/mine\\evil")).toBe("/mine");
    expect(safeAccountReturnTo("/mine\n?accountHandoff=abc")).toBe("/mine");
    expect(safeAccountReturnTo("/mine\u0000?accountHandoff=abc")).toBe("/mine");
    expect(safeAccountReturnTo("")).toBe("/mine");
    expect(safeAccountReturnTo(null)).toBe("/mine");
  });

  it("keeps account callbacks on the mine route", () => {
    expect(safeAccountReturnTo("/workshop")).toBe("/mine");
    expect(safeAccountReturnTo("/api/account/status")).toBe("/mine");
    expect(safeAccountReturnTo("/sign-in?redirect_url=/mine")).toBe("/mine");
    expect(safeAccountReturnTo("/mine/extra")).toBe("/mine");
  });

  it("separates local path safety from the app route allowlist", () => {
    const safeProfileReturnTo = (value: unknown) =>
      safeLocalAccountReturnTo(value, {
        fallbackPath: "/profile",
        allowPath: (path) =>
          path === "/profile" || path.startsWith("/profile?"),
      });

    expect(safeProfileReturnTo("/profile")).toBe("/profile");
    expect(safeProfileReturnTo("/profile?tab=account")).toBe(
      "/profile?tab=account",
    );
    expect(safeProfileReturnTo("/mine")).toBe("/profile");
    expect(safeProfileReturnTo("https://evil.test/profile")).toBe("/profile");
    expect(safeProfileReturnTo("//evil.test/profile")).toBe("/profile");
    expect(safeProfileReturnTo("/profile\\evil")).toBe("/profile");
    expect(safeProfileReturnTo("/profile\n?tab=account")).toBe("/profile");
    expect(
      safeLocalAccountReturnTo("/profile?tab=account", {
        fallbackPath: "/profile",
        allowPath: (path) => path.startsWith("/profile"),
        maxLength: 8,
      }),
    ).toBe("/profile");
  });

  it("accepts only bounded handoff id tokens", () => {
    expect(safeAccountHandoffId(" handoff-1 ")).toBe("handoff-1");
    expect(safeAccountHandoffId("019f2db1-fd9a-74b0-a6bc-aabbd9c178bf")).toBe(
      "019f2db1-fd9a-74b0-a6bc-aabbd9c178bf",
    );
    expect(safeAccountHandoffId("")).toBeNull();
    expect(safeAccountHandoffId("handoff 1")).toBeNull();
    expect(safeAccountHandoffId("handoff/1")).toBeNull();
    expect(safeAccountHandoffId("h".repeat(129))).toBeNull();
    expect(safeAccountHandoffId(null)).toBeNull();
  });

  it("stays reusable without app, provider, framework, or storage imports", () => {
    const source = readFileSync("src/lib/account-handoff-contract.ts", "utf8");

    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toContain("clerk");
    expect(source).not.toContain("next/");
    expect(source).not.toContain("@/");
    expect(source).not.toContain("db");
    expect(source).not.toContain("cookie");
  });
});
