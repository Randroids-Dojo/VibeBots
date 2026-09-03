import { describe, expect, it } from "vitest";
import {
  goldenUpdatePlan,
  parseReason,
  spawnFailure,
} from "./update-goldens-lib.mjs";

describe("parseReason", () => {
  it("reads the text after --reason and drops pnpm's separator", () => {
    expect(parseReason(["--", "--reason", " Tower core reshaped "])).toBe(
      "Tower core reshaped",
    );
  });

  it("is empty when the flag or its value is missing", () => {
    expect(parseReason([])).toBe("");
    expect(parseReason(["--reason"])).toBe("");
    expect(parseReason(["--reason", "   "])).toBe("");
  });
});

describe("goldenUpdatePlan", () => {
  it("runs the update runner with the two env vars, then formats what it wrote", () => {
    const plan = goldenUpdatePlan({
      platform: "linux",
      reason: "sim version 8",
      env: { PATH: "/bin" },
    });
    expect(plan.run.command).toBe("pnpm");
    expect(plan.run.args).toContain("tests/goldens/update-runner.test.ts");
    expect(plan.run.env).toMatchObject({
      PATH: "/bin",
      VIBEBOTS_GOLDEN_REASON: "sim version 8",
      VIBEBOTS_UPDATE_GOLDENS: "1",
    });
    expect(plan.run.shell).toBe(false);
    expect(plan.format.args).toEqual([
      "exec",
      "biome",
      "format",
      "--write",
      "tests/goldens",
    ]);
  });

  it("starts pnpm through a shell on Windows, where it is a .cmd shim (F-251)", () => {
    const plan = goldenUpdatePlan({ platform: "win32", reason: "x" });
    expect(plan.run.shell).toBe(true);
    expect(plan.format.shell).toBe(true);
  });
});

describe("spawnFailure", () => {
  it("names a spawn that never started", () => {
    expect(
      spawnFailure("the update runner", {
        error: new Error("spawnSync pnpm ENOENT"),
        status: null,
      }),
    ).toBe(
      "Golden update: the update runner could not start (spawnSync pnpm ENOENT).",
    );
  });

  it("names a spawn that died without a status, and is silent on a real exit", () => {
    expect(spawnFailure("biome", { status: null, signal: "SIGKILL" })).toBe(
      "Golden update: biome ended without an exit status (signal SIGKILL).",
    );
    expect(spawnFailure("biome", { status: 1 })).toBeNull();
    expect(spawnFailure("biome", { status: 0 })).toBeNull();
  });
});
