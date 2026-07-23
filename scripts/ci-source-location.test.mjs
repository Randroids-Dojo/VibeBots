import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  fileFromSourceLocation,
  inventorySourcePath,
} from "./ci-source-location.mjs";

describe("CI source locations", () => {
  test("removes the final line suffix from a relative path", () => {
    expect(fileFromSourceLocation("mine-core.spec.ts:42")).toBe(
      "mine-core.spec.ts",
    );
  });

  test("preserves a Windows drive-letter colon", () => {
    expect(
      fileFromSourceLocation("C:\\repo\\tests\\e2e\\mine.spec.ts:123"),
    ).toBe("C:\\repo\\tests\\e2e\\mine.spec.ts");
  });

  test("resolves relative files under the test directory once", () => {
    expect(inventorySourcePath("mine-core.spec.ts")).toBe(
      path.join("tests/e2e", "mine-core.spec.ts"),
    );
    expect(inventorySourcePath("tests/e2e/mine-core.spec.ts")).toBe(
      path.normalize("tests/e2e/mine-core.spec.ts"),
    );
    expect(inventorySourcePath("tests\\e2e\\mine-core.spec.ts")).toBe(
      path.normalize("tests/e2e/mine-core.spec.ts"),
    );
  });

  test("preserves absolute source paths", () => {
    const absolute = path.resolve("tests/e2e/mine-core.spec.ts");
    expect(inventorySourcePath(absolute)).toBe(absolute);
    expect(inventorySourcePath("C:\\repo\\tests\\e2e\\mine.spec.ts")).toBe(
      path.normalize("C:/repo/tests/e2e/mine.spec.ts"),
    );
  });

  test("rejects a location without a numeric line suffix", () => {
    expect(() => fileFromSourceLocation("mine-core.spec.ts")).toThrow(
      "Invalid source location",
    );
    expect(() => fileFromSourceLocation("mine-core.spec.ts:line")).toThrow(
      "Invalid source location",
    );
  });
});
