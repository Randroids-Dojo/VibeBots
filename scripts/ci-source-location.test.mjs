import { describe, expect, test } from "vitest";
import { fileFromSourceLocation } from "./ci-source-location.mjs";

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

  test("rejects a location without a numeric line suffix", () => {
    expect(() => fileFromSourceLocation("mine-core.spec.ts")).toThrow(
      "Invalid source location",
    );
    expect(() => fileFromSourceLocation("mine-core.spec.ts:line")).toThrow(
      "Invalid source location",
    );
  });
});
