import { describe, expect, it } from "vitest";
import { parseE2EGlobalTimeout } from "./playwright-global-timeout";

describe("parseE2EGlobalTimeout", () => {
  it("is undefined when unset or empty (no global timeout)", () => {
    expect(parseE2EGlobalTimeout(undefined)).toBeUndefined();
    expect(parseE2EGlobalTimeout("")).toBeUndefined();
  });

  it("accepts a positive integer of milliseconds", () => {
    expect(parseE2EGlobalTimeout("60000")).toBe(60000);
    expect(parseE2EGlobalTimeout("780000")).toBe(780000);
  });

  it("throws on a malformed value rather than running unbounded", () => {
    expect(() => parseE2EGlobalTimeout("0")).toThrow();
    expect(() => parseE2EGlobalTimeout("00")).toThrow();
    expect(() => parseE2EGlobalTimeout("-1")).toThrow();
    expect(() => parseE2EGlobalTimeout("12.5")).toThrow();
    expect(() => parseE2EGlobalTimeout("16min")).toThrow();
  });

  it("accepts a value at the 24-hour maximum but rejects beyond it", () => {
    expect(parseE2EGlobalTimeout("86400000")).toBe(86_400_000);
    expect(() => parseE2EGlobalTimeout("86400001")).toThrow();
    // A precision-losing / absurd digit string is rejected, not silently rounded.
    expect(() => parseE2EGlobalTimeout("99999999999999999999")).toThrow();
  });
});
