import { describe, expect, test } from "vitest";
import {
  CI_CAPABILITY_TAGS,
  CI_POLICY_TAGS,
} from "../tests/e2e/support/ci-case";
import {
  CAPABILITY_TAGS,
  collectCases,
  POLICY_TAGS,
  summarizeInventory,
  validateInventory,
} from "./ci-inventory-lib.mjs";

function report({
  title = "case title",
  tags = ["functional", "critical"],
  annotations = [{ type: "case-id", description: "E2E-MINE-0001" }],
} = {}) {
  return {
    suites: [
      {
        title: "mine.spec.ts",
        specs: [
          {
            title,
            file: "mine.spec.ts",
            line: 10,
            tags,
            tests: [{ projectName: "chromium", annotations }],
          },
        ],
      },
    ],
  };
}

const emptyQuarantine = { schemaVersion: 1, entries: [] };

describe("CI inventory", () => {
  test("uses the canonical capability and policy tag sets", () => {
    expect(CAPABILITY_TAGS).toEqual(CI_CAPABILITY_TAGS);
    expect(POLICY_TAGS).toEqual(CI_POLICY_TAGS);
  });

  test("collects stable metadata independently of the title", () => {
    const first = collectCases(report({ title: "before" }));
    const renamed = collectCases(report({ title: "after" }));
    const firstResult = validateInventory(first, emptyQuarantine);
    const renamedResult = validateInventory(renamed, emptyQuarantine);
    expect(firstResult.errors).toEqual([]);
    expect(renamedResult.errors).toEqual([]);
    expect(firstResult.cases[0].caseId).toBe(renamedResult.cases[0].caseId);
    expect(firstResult.cases[0].capability).toBe("@functional");
    expect(firstResult.cases[0].policyTags).toEqual(["@critical"]);
  });

  test("rejects missing, duplicate, multiple, and unknown metadata", () => {
    const cases = collectCases(
      report({
        tags: ["functional", "render", "mystery"],
        annotations: [],
      }),
    );
    const result = validateInventory(cases, emptyQuarantine);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("exactly one capability tag"),
        expect.stringContaining("unknown tags"),
        expect.stringContaining("exactly one case-id annotation"),
      ]),
    );
  });

  test("rejects duplicate IDs and critical render cases", () => {
    const cases = collectCases(report({ tags: ["render", "critical"] }));
    cases.push({ ...cases[0], line: 11 });
    const result = validateInventory(cases, emptyQuarantine);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("duplicates case id"),
        expect.stringContaining("uses @critical outside @functional"),
      ]),
    );
  });

  test("rejects pixel assertions in functional cases", () => {
    const cases = collectCases(report());
    const sourceByLocation = new Map([
      ["mine.spec.ts:10", "await canvas.screenshot()"],
    ]);
    const result = validateInventory(cases, emptyQuarantine, {
      sourceByLocation,
    });
    expect(result.errors).toContain(
      "mine.spec.ts:10 uses pixel assertions inside @functional",
    );
  });

  test("rejects discovered cases that cannot be matched to source", () => {
    const cases = collectCases(report());
    const result = validateInventory(cases, emptyQuarantine, {
      sourceByLocation: new Map(),
    });
    expect(result.errors).toContain(
      "mine.spec.ts:10 could not be matched to its source test call",
    );
  });

  test("rejects expired, stale, and overlong quarantine entries", () => {
    const cases = collectCases(report());
    const quarantine = {
      schemaVersion: 1,
      entries: [
        {
          caseId: "E2E-MINE-0001",
          capability: "@functional",
          owner: "owner",
          tracking: "F-001",
          failureFingerprint: "abc",
          evidenceRuns: ["1"],
          addedDate: "2026-01-01",
          expiresOn: "2026-01-16",
          reason: "reason",
          disposition: "fix",
        },
        {
          caseId: "E2E-MINE-9999",
          capability: "@render",
          owner: "owner",
          tracking: "F-002",
          failureFingerprint: "def",
          evidenceRuns: ["2"],
          addedDate: "2026-01-10",
          expiresOn: "2026-01-12",
          reason: "reason",
          disposition: "fix",
        },
      ],
    };
    const result = validateInventory(cases, quarantine, {
      today: "2026-01-20",
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expiry must be within 14 days"),
        expect.stringContaining("expired on"),
        expect.stringContaining("does not match a discovered case"),
      ]),
    );
  });

  test("rejects calendar dates that JavaScript would normalize", () => {
    const cases = collectCases(report());
    const quarantine = {
      schemaVersion: 1,
      entries: [
        {
          caseId: "E2E-MINE-0001",
          capability: "@functional",
          owner: "owner",
          tracking: "F-001",
          failureFingerprint: "abc",
          evidenceRuns: ["1"],
          addedDate: "2026-02-30",
          expiresOn: "2026-03-01",
          reason: "reason",
          disposition: "fix",
        },
      ],
    };
    const result = validateInventory(cases, quarantine, {
      today: "2026-02-01",
    });
    expect(result.errors).toContain(
      "quarantine E2E-MINE-0001 requires ISO addedDate and expiresOn values",
    );
  });

  test("summarizes capability and policy totals", () => {
    const cases = validateInventory(
      collectCases(report()),
      emptyQuarantine,
    ).cases;
    expect(summarizeInventory(cases)).toMatchObject({
      total: 1,
      capabilities: { "@functional": 1 },
      policies: { "@critical": 1 },
    });
  });
});
