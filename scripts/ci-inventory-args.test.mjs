import path from "node:path";
import { describe, expect, test } from "vitest";
import { outputPathFromArgs } from "./ci-inventory-args.mjs";

describe("CI inventory arguments", () => {
  test("returns null when output is omitted", () => {
    expect(outputPathFromArgs([])).toBeNull();
  });

  test("rejects a missing output path", () => {
    expect(() => outputPathFromArgs(["--output"])).toThrow(
      "--output requires a file path",
    );
  });

  test("resolves a relative output path", () => {
    expect(outputPathFromArgs(["--output", "reports/cases.json"])).toBe(
      path.resolve("reports/cases.json"),
    );
  });

  test("preserves an absolute output path", () => {
    const output = path.resolve("/tmp", "cases.json");
    expect(outputPathFromArgs(["--output", output])).toBe(output);
  });
});
