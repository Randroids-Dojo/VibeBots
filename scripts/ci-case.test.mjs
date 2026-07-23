import { describe, expect, test } from "vitest";
import { ciCase } from "../tests/e2e/support/ci-case";

describe("ciCase", () => {
  test("places the capability before policy tags", () => {
    expect(
      ciCase("E2E-MINE-0001", "@functional", ["@critical", "@serial"]).tag,
    ).toEqual(["@functional", "@critical", "@serial"]);
  });

  test("defaults policy tags to an empty list", () => {
    expect(ciCase("E2E-MINE-0001", "@render").tag).toEqual(["@render"]);
  });

  test("emits the stable case-id annotation", () => {
    expect(ciCase("E2E-MINE-0001", "@functional").annotation).toEqual([
      { type: "case-id", description: "E2E-MINE-0001" },
    ]);
  });
});
