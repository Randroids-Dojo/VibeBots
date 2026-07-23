#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

function attempts(report) {
  return new Map(
    report.records.map((record) => [
      `${record.caseId}#${record.attempt}`,
      record,
    ]),
  );
}

export function compareShadowReports(hosted, pinned) {
  const hostedAttempts = attempts(hosted);
  const pinnedAttempts = attempts(pinned);
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

  return {
    schemaVersion: 1,
    commitSha: hosted.commitSha,
    hostedStatus: hosted.status,
    pinnedStatus: pinned.status,
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
    report.outcomeMismatches.length
  ) {
    throw new Error(
      "Pinned runtime discovery or outcomes differ from the hosted runtime",
    );
  }
}
