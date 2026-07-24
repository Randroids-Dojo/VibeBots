import { describe, expect, test } from "vitest";
import {
  buildFunctionalShardPlan,
  summarizeFunctionalResults,
} from "./ci-functional-shards.mjs";

const inventory = {
  schemaVersion: 1,
  commitSha: "abc123",
  cases: [
    {
      caseId: "E2E-A-0001",
      capability: "@functional",
      file: "a.spec.ts",
      line: 10,
    },
    {
      caseId: "E2E-B-0001",
      capability: "@functional",
      file: "b.spec.ts",
      line: 20,
    },
    {
      caseId: "E2E-C-0001",
      capability: "@functional",
      file: "c.spec.ts",
      line: 30,
    },
    {
      caseId: "E2E-R-0001",
      capability: "@render",
      file: "render.spec.ts",
      line: 40,
    },
  ],
};
const baseline = {
  schemaVersion: 1,
  fallbackDurationMs: 60_000,
  source: { runId: 1 },
  durationsMs: {
    "E2E-A-0001": 90_000,
    "E2E-B-0001": 50_000,
  },
};

describe("functional shard planning", () => {
  test("balances every functional case once using measured durations", () => {
    const plan = buildFunctionalShardPlan(inventory, baseline, 2);
    expect(plan.functionalCaseCount).toBe(3);
    expect(plan.fallbackCaseCount).toBe(1);
    expect(plan.shards.map((shard) => shard.estimatedDurationMs)).toEqual([
      90_000, 110_000,
    ]);
    expect(
      plan.shards.flatMap((shard) => shard.cases.map((item) => item.caseId)),
    ).toEqual(["E2E-A-0001", "E2E-B-0001", "E2E-C-0001"]);
  });

  test("rejects duplicate or invalid functional metadata", () => {
    expect(() =>
      buildFunctionalShardPlan(
        {
          ...inventory,
          cases: [...inventory.cases, inventory.cases[0]],
        },
        baseline,
        2,
      ),
    ).toThrow("Duplicate functional case ID");
    expect(() => buildFunctionalShardPlan(inventory, baseline, 0)).toThrow(
      "positive integer",
    );
  });

  test("proves complete discovery and computes observed p95", () => {
    const plan = buildFunctionalShardPlan(inventory, baseline, 2);
    const records = plan.shards.map((shard) => ({
      schemaVersion: 1,
      commitSha: plan.commitSha,
      records: shard.cases.map((item) => ({
        caseId: item.caseId,
        attempt: 1,
        outcome: "passed",
        durationMs: item.estimatedDurationMs,
      })),
    }));
    expect(summarizeFunctionalResults(plan, records)).toMatchObject({
      functionalCaseCount: 3,
      observedCaseCount: 3,
      attemptCount: 3,
      outcomes: { passed: 3 },
      p95TestDurationMs: 110_000,
    });
  });

  test("rejects wrong commits, duplicates, and incomplete discovery", () => {
    const plan = buildFunctionalShardPlan(inventory, baseline, 2);
    expect(() =>
      summarizeFunctionalResults(plan, [{ commitSha: "wrong", records: [] }]),
    ).toThrow("does not match plan");
    expect(() =>
      summarizeFunctionalResults(plan, [
        {
          commitSha: plan.commitSha,
          records: [
            {
              caseId: "E2E-A-0001",
              attempt: 1,
              outcome: "passed",
              durationMs: 1,
            },
          ],
        },
      ]),
    ).toThrow("discovery is incomplete");
  });
});
