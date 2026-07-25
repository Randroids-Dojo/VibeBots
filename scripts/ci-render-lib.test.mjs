import { describe, expect, it } from "vitest";
import {
  localDateKey,
  missedDateKeys,
  parseRenderArgs,
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
