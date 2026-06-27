import { describe, expect, it } from "vitest";
import { parsePlaywrightWorkerCount } from "./playwright-workers";

describe("parsePlaywrightWorkerCount", () => {
  it("defaults to two workers when unset", () => {
    expect(parsePlaywrightWorkerCount(undefined)).toBe(2);
  });

  it("accepts positive integer strings", () => {
    expect(parsePlaywrightWorkerCount("1")).toBe(1);
    expect(parsePlaywrightWorkerCount("12")).toBe(12);
  });

  it("rejects partial or non-positive values", () => {
    expect(parsePlaywrightWorkerCount("2.5")).toBeNaN();
    expect(parsePlaywrightWorkerCount("2workers")).toBeNaN();
    expect(parsePlaywrightWorkerCount("0")).toBeNaN();
  });
});
