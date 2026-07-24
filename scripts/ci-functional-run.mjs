#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { inventorySourcePath } from "./ci-source-location.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

const plan = JSON.parse(readFileSync(argument("--plan"), "utf8"));
const expectedSha = argument("--sha");
if (plan.commitSha !== expectedSha) {
  throw new Error(
    `Functional shard plan SHA ${plan.commitSha ?? "missing"} does not match workflow SHA ${expectedSha}`,
  );
}
const shardIndex = Number(argument("--index"));
if (!Number.isInteger(shardIndex) || shardIndex < 1) {
  throw new Error("--index must be a positive integer");
}
const shard = plan.shards?.find((candidate) => candidate.index === shardIndex);
if (!shard || !Array.isArray(shard.cases) || shard.cases.length === 0) {
  throw new Error(`Functional shard ${shardIndex} is missing or empty`);
}
const selectors = shard.cases.map(
  (testCase) =>
    `${inventorySourcePath(testCase.file).replaceAll("\\", "/")}:${testCase.line}`,
);
console.log(
  `Running functional shard ${shardIndex}/${plan.shardCount}: ` +
    `${shard.cases.length} cases, predicted ${shard.estimatedDurationMs}ms`,
);
for (const testCase of shard.cases) {
  console.log(
    `${testCase.caseId} ${testCase.file}:${testCase.line} ${testCase.estimatedDurationMs}ms`,
  );
}
const command = "pnpm";
const args = [
  "exec",
  "playwright",
  "test",
  ...selectors,
  "--project=chromium",
  "--fully-parallel",
  "--workers=1",
];
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  throw new Error(
    `Failed to start ${[command, ...args].join(" ")}: ${result.error.message}`,
    { cause: result.error },
  );
}
if (result.status === null) {
  throw new Error(`${[command, ...args].join(" ")} returned no exit status`);
}
process.exit(result.status);
