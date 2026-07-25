import { describe, expect, it } from "vitest";
import {
  localDateKey,
  missedDateKeys,
  parseRenderArgs,
  renderEnvironment,
  renderTierStatus,
  selectedRenderTiers,
  summarizeTierResults,
} from "./ci-render-lib.mjs";

describe("ci render arguments", () => {
  it("selects all capability tiers by default", () => {
    expect(parseRenderArgs(["--sha", "abc123"])).toEqual({
      sha: "abc123",
      tier: "all",
      root: null,
      scheduled: false,
    });
    expect(selectedRenderTiers("all")).toEqual(["render", "visual", "soak"]);
  });

  it("accepts one tier and scheduled mode", () => {
    expect(
      parseRenderArgs([
        "--sha",
        "abc123",
        "--tier",
        "render",
        "--root",
        "./tmp",
        "--scheduled",
      ]),
    ).toMatchObject({
      sha: "abc123",
      tier: "render",
      scheduled: true,
    });
  });

  it("rejects an unknown tier", () => {
    expect(() =>
      parseRenderArgs(["--sha", "abc123", "--tier", "pixels"]),
    ).toThrow("--tier must be all, render, visual, or soak");
  });

  it("keeps only operational host variables and blanks app configuration", () => {
    expect(
      renderEnvironment({
        PATH: "/usr/bin",
        HOME: "/tmp/home",
        NEXT_PUBLIC_ANALYTICS_ID: "host-value",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "host-key",
        DATABASE_URL: "postgres://host",
        VIBEBOTS_E2E_MODE: "1",
        UNRELATED_HOST_TOGGLE: "enabled",
      }),
    ).toEqual(
      expect.objectContaining({
        PATH: "/usr/bin",
        HOME: "/tmp/home",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
        DATABASE_URL: "",
        VIBEBOTS_E2E_MODE: "",
      }),
    );
    const result = renderEnvironment({
      NEXT_PUBLIC_ANALYTICS_ID: "host-value",
      UNRELATED_HOST_TOGGLE: "enabled",
    });
    expect(result).not.toHaveProperty("NEXT_PUBLIC_ANALYTICS_ID");
    expect(result).not.toHaveProperty("UNRELATED_HOST_TOGGLE");
  });
});

describe("ci render heartbeat", () => {
  it("uses the Chicago calendar day", () => {
    expect(
      localDateKey(new Date("2026-07-25T03:00:00.000Z"), "America/Chicago"),
    ).toBe("2026-07-24");
  });

  it("lists schedule windows missed between runs", () => {
    expect(missedDateKeys("2026-07-21", "2026-07-25")).toEqual([
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
    ]);
  });

  it("summarizes failure without hiding skipped tiers", () => {
    expect(
      summarizeTierResults([
        { status: "passed" },
        { status: "skipped" },
        { status: "failed" },
      ]),
    ).toBe("failure");
  });

  it("fails a tier when an earlier attempt was flaky", () => {
    expect(renderTierStatus(0, ["failed", "passed"])).toBe("failed");
    expect(renderTierStatus(0, ["passed", "skipped"])).toBe("passed");
    expect(renderTierStatus(0, ["skipped"])).toBe("skipped");
  });
});
