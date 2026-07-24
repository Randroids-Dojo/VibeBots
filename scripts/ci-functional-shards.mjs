#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

export function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function buildFunctionalShardPlan(
  inventory,
  baseline,
  shardCount,
  commitSha = inventory.commitSha,
) {
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.cases)) {
    throw new Error("Inventory must use schema version 1 and contain cases");
  }
  if (
    baseline.schemaVersion !== 1 ||
    !baseline.durationsMs ||
    !Number.isInteger(baseline.fallbackDurationMs)
  ) {
    throw new Error("Duration baseline must use schema version 1");
  }
  positiveInteger(shardCount, "shard count");
  const functional = inventory.cases.filter(
    (testCase) => testCase.capability === "@functional",
  );
  if (functional.length === 0) {
    throw new Error("Inventory contains no functional cases");
  }
  const ids = new Set();
  const weighted = functional.map((testCase) => {
    if (
      typeof testCase.caseId !== "string" ||
      !testCase.caseId ||
      typeof testCase.file !== "string" ||
      !testCase.file ||
      !Number.isInteger(testCase.line) ||
      testCase.line < 1
    ) {
      throw new Error("Functional inventory contains invalid case metadata");
    }
    if (ids.has(testCase.caseId)) {
      throw new Error(`Duplicate functional case ID ${testCase.caseId}`);
    }
    ids.add(testCase.caseId);
    const measured = baseline.durationsMs[testCase.caseId];
    const estimatedDurationMs =
      Number.isInteger(measured) && measured > 0
        ? measured
        : baseline.fallbackDurationMs;
    return {
      caseId: testCase.caseId,
      file: testCase.file,
      line: testCase.line,
      estimatedDurationMs,
      timingSource:
        Number.isInteger(measured) && measured > 0 ? "measured" : "fallback",
    };
  });
  weighted.sort(
    (left, right) =>
      right.estimatedDurationMs - left.estimatedDurationMs ||
      left.caseId.localeCompare(right.caseId),
  );
  const shards = Array.from({ length: shardCount }, (_, index) => ({
    index: index + 1,
    estimatedDurationMs: 0,
    cases: [],
  }));
  for (const testCase of weighted) {
    const target = [...shards].sort(
      (left, right) =>
        left.estimatedDurationMs - right.estimatedDurationMs ||
        left.index - right.index,
    )[0];
    target.cases.push(testCase);
    target.estimatedDurationMs += testCase.estimatedDurationMs;
  }
  for (const shard of shards) {
    shard.cases.sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.line - right.line ||
        left.caseId.localeCompare(right.caseId),
    );
  }
  const estimates = shards.map((shard) => shard.estimatedDurationMs);
  return {
    schemaVersion: 1,
    commitSha,
    generatedAt: new Date().toISOString(),
    algorithm: "longest-processing-time-first",
    workerCount: 1,
    shardCount,
    functionalCaseCount: functional.length,
    fallbackCaseCount: weighted.filter(
      (testCase) => testCase.timingSource === "fallback",
    ).length,
    source: baseline.source,
    predicted: {
      minDurationMs: Math.min(...estimates),
      p95DurationMs: percentile(estimates, 0.95),
      maxDurationMs: Math.max(...estimates),
    },
    shards,
  };
}

export function summarizeFunctionalResults(plan, reports) {
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.shards)) {
    throw new Error("Functional shard plan must use schema version 1");
  }
  const expected = new Map();
  for (const shard of plan.shards) {
    for (const testCase of shard.cases ?? []) {
      if (expected.has(testCase.caseId)) {
        throw new Error(`Shard plan repeats ${testCase.caseId}`);
      }
      expected.set(testCase.caseId, shard.index);
    }
  }
  const seenAttempts = new Set();
  const observed = new Set();
  const outcomes = {};
  const shardDurations = new Map(plan.shards.map((shard) => [shard.index, 0]));
  for (const report of reports) {
    if (report.commitSha !== plan.commitSha) {
      throw new Error(
        `Functional report commit ${report.commitSha ?? "missing"} does not match plan ${plan.commitSha}`,
      );
    }
    if (!Array.isArray(report.records)) {
      throw new Error("Functional report must contain records");
    }
    for (const record of report.records) {
      const shardIndex = expected.get(record.caseId);
      if (!shardIndex) {
        throw new Error(
          `Functional report contains unexpected ${record.caseId}`,
        );
      }
      if (!Number.isInteger(record.attempt) || record.attempt < 1) {
        throw new Error(`Functional report contains an invalid attempt`);
      }
      const attemptKey = `${record.caseId}#${record.attempt}`;
      if (seenAttempts.has(attemptKey)) {
        throw new Error(`Functional reports repeat ${attemptKey}`);
      }
      seenAttempts.add(attemptKey);
      observed.add(record.caseId);
      outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1;
      if (Number.isFinite(record.durationMs) && record.durationMs >= 0) {
        shardDurations.set(
          shardIndex,
          shardDurations.get(shardIndex) + record.durationMs,
        );
      }
    }
  }
  const missingCaseIds = [...expected.keys()]
    .filter((caseId) => !observed.has(caseId))
    .sort();
  if (missingCaseIds.length > 0) {
    throw new Error(
      `Functional discovery is incomplete: ${missingCaseIds.join(", ")}`,
    );
  }
  const observedDurations = [...shardDurations.entries()]
    .map(([index, durationMs]) => ({ index, durationMs }))
    .sort((left, right) => left.index - right.index);
  return {
    schemaVersion: 1,
    commitSha: plan.commitSha,
    functionalCaseCount: expected.size,
    observedCaseCount: observed.size,
    attemptCount: seenAttempts.size,
    outcomes,
    shardDurations: observedDurations,
    p95ShardDurationMs: percentile(
      observedDurations.map((shard) => shard.durationMs),
      0.95,
    ),
  };
}

if (process.argv[1]?.endsWith("ci-functional-shards.mjs")) {
  const inventory = JSON.parse(
    readFileSync(requiredArgument("--inventory"), "utf8"),
  );
  const baseline = JSON.parse(
    readFileSync(requiredArgument("--baseline"), "utf8"),
  );
  const plan = buildFunctionalShardPlan(
    inventory,
    baseline,
    positiveInteger(requiredArgument("--count"), "shard count"),
  );
  const output = requiredArgument("--output");
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(
    `Balanced ${plan.functionalCaseCount} functional cases across ${plan.shardCount} shards; ` +
      `predicted p95 ${plan.predicted.p95DurationMs}ms, max ${plan.predicted.maxDurationMs}ms`,
  );
}
