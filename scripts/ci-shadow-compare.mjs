#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

function attempts(report, label) {
  if (!Array.isArray(report.records)) {
    throw new Error(`${label} report must contain a records array`);
  }
  const result = new Map();
  for (const record of report.records) {
    if (
      typeof record.caseId !== "string" ||
      !record.caseId ||
      !Number.isInteger(record.attempt) ||
      record.attempt < 1
    ) {
      throw new Error(`${label} report contains an invalid case ID or attempt`);
    }
    const key = `${record.caseId}#${record.attempt}`;
    if (result.has(key)) {
      throw new Error(`${label} report contains duplicate attempt ${key}`);
    }
    result.set(key, record);
  }
  return result;
}

export function compareShadowReports(hosted, pinned) {
  if (
    typeof hosted.commitSha !== "string" ||
    !hosted.commitSha ||
    typeof pinned.commitSha !== "string" ||
    !pinned.commitSha
  ) {
    throw new Error("Both shadow reports must identify their source commit");
  }
  if (hosted.commitSha !== pinned.commitSha) {
    throw new Error(
      `Shadow report commits differ: hosted ${hosted.commitSha}, pinned ${pinned.commitSha}`,
    );
  }
  const hostedAttempts = attempts(hosted, "Hosted");
  const pinnedAttempts = attempts(pinned, "Pinned");
  const keys = [
    ...new Set([...hostedAttempts.keys(), ...pinnedAttempts.keys()]),
  ].sort();
  const cases = keys.map((key) => {
    const oldRecord = hostedAttempts.get(key);
    const newRecord = pinnedAttempts.get(key);
    return {
      key,
      caseId: oldRecord?.caseId ?? newRecord?.caseId ?? null,
      attempt: oldRecord?.attempt ?? newRecord?.attempt ?? null,
      hostedOutcome: oldRecord?.outcome ?? null,
      pinnedOutcome: newRecord?.outcome ?? null,
      hostedDurationMs: oldRecord?.durationMs ?? null,
      pinnedDurationMs: newRecord?.durationMs ?? null,
      durationRatio:
        oldRecord && newRecord && oldRecord.durationMs > 0
          ? Number((newRecord.durationMs / oldRecord.durationMs).toFixed(3))
          : null,
    };
  });
  const missingFromHosted = cases
    .filter((entry) => entry.hostedOutcome === null)
    .map((entry) => entry.key);
  const missingFromPinned = cases
    .filter((entry) => entry.pinnedOutcome === null)
    .map((entry) => entry.key);
  const outcomeMismatches = cases
    .filter(
      (entry) =>
        entry.hostedOutcome !== null &&
        entry.pinnedOutcome !== null &&
        entry.hostedOutcome !== entry.pinnedOutcome,
    )
    .map((entry) => entry.key);
  const executionFailures = [];
  if (hosted.status !== "passed") {
    executionFailures.push(`hosted:${hosted.status ?? "missing"}`);
  }
  if (pinned.status !== "passed") {
    executionFailures.push(`pinned:${pinned.status ?? "missing"}`);
  }
  if (hostedAttempts.size === 0) executionFailures.push("hosted:no-cases");
  if (pinnedAttempts.size === 0) executionFailures.push("pinned:no-cases");

  return {
    schemaVersion: 1,
    commitSha: hosted.commitSha,
    hostedCommitSha: hosted.commitSha,
    pinnedCommitSha: pinned.commitSha,
    hostedStatus: hosted.status,
    pinnedStatus: pinned.status,
    executionFailures,
    missingFromHosted,
    missingFromPinned,
    outcomeMismatches,
    cases,
  };
}

if (process.argv[1]?.endsWith("ci-shadow-compare.mjs")) {
  const hostedPath = argument("--hosted");
  const pinnedPath = argument("--pinned");
  const outputPath = argument("--output");
  const report = compareShadowReports(
    JSON.parse(readFileSync(hostedPath, "utf8")),
    JSON.parse(readFileSync(pinnedPath, "utf8")),
  );
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.table(
    report.cases.map((entry) => ({
      case: entry.key,
      hosted: entry.hostedOutcome,
      pinned: entry.pinnedOutcome,
      hostedMs: entry.hostedDurationMs,
      pinnedMs: entry.pinnedDurationMs,
      ratio: entry.durationRatio,
    })),
  );
  if (
    report.missingFromHosted.length ||
    report.missingFromPinned.length ||
    report.outcomeMismatches.length ||
    report.executionFailures.length
  ) {
    throw new Error(
      "Pinned runtime discovery or outcomes differ from the hosted runtime",
    );
  }
}
