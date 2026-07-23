import { describe, expect, test } from "vitest";
import { compareShadowReports } from "./ci-shadow-compare.mjs";

function report(records, status = "passed") {
  return {
    schemaVersion: 1,
    commitSha: "abc123",
    status,
    records,
  };
}

function record(caseId, outcome, durationMs, attempt = 1) {
  return { caseId, outcome, durationMs, attempt };
}

describe("runtime shadow comparison", () => {
  test("compares IDs, outcomes, and durations", () => {
    const comparison = compareShadowReports(
      report([record("E2E-A-0001", "passed", 100)]),
      report([record("E2E-A-0001", "passed", 125)]),
    );
    expect(comparison).toMatchObject({
      missingFromHosted: [],
      missingFromPinned: [],
      outcomeMismatches: [],
      cases: [
        {
          key: "E2E-A-0001#1",
          hostedDurationMs: 100,
          pinnedDurationMs: 125,
          durationRatio: 1.25,
        },
      ],
    });
  });

  test("reports missing cases and outcome drift", () => {
    const comparison = compareShadowReports(
      report([
        record("E2E-A-0001", "failed", 100),
        record("E2E-B-0001", "passed", 200),
      ]),
      report([
        record("E2E-A-0001", "passed", 110),
        record("E2E-C-0001", "passed", 300),
      ]),
    );
    expect(comparison.outcomeMismatches).toEqual(["E2E-A-0001#1"]);
    expect(comparison.missingFromHosted).toEqual(["E2E-C-0001#1"]);
    expect(comparison.missingFromPinned).toEqual(["E2E-B-0001#1"]);
  });
});
