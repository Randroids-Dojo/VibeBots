#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { summarizeFunctionalResults } from "./ci-functional-shards.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

function jsonFiles(root) {
  if (!existsSync(root)) {
    throw new Error("No functional shadow reports were downloaded");
  }
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("Functional shadow results contain a symbolic link");
    }
    if (entry.isDirectory()) {
      found.push(...jsonFiles(candidate));
    } else if (entry.isFile()) {
      if (candidate.endsWith(".json")) {
        found.push(candidate);
      }
    } else {
      throw new Error(
        "Functional shadow results contain a special filesystem entry",
      );
    }
  }
  return found.sort();
}

const plan = JSON.parse(readFileSync(argument("--plan"), "utf8"));
const reportFiles = jsonFiles(argument("--results-dir"));
if (reportFiles.length === 0) {
  throw new Error("No functional shadow reports were downloaded");
}
const reports = reportFiles.map((file) =>
  JSON.parse(readFileSync(file, "utf8")),
);
const summary = summarizeFunctionalResults(plan, reports);
const output = argument("--output");
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  `Observed all ${summary.observedCaseCount} functional cases across ` +
    `${plan.shardCount} shards; aggregate shard-time p95 ` +
    `${summary.p95ShardDurationMs}ms`,
);
console.table(summary.shardDurations);
