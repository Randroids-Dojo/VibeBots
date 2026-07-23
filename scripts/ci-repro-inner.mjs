#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseReproArgs, resolveFunctionalCase } from "./ci-repro-lib.mjs";

function run(command, args, options = {}) {
  console.log(`+ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const options = parseReproArgs(process.argv.slice(2));
const inventoryPath = "playwright-report/ci-repro-inventory.json";

console.log(
  `Runtime: Node ${process.version}, pnpm ${spawnSync("pnpm", ["--version"], {
    encoding: "utf8",
  }).stdout.trim()}`,
);
run("pnpm", ["install", "--frozen-lockfile"]);
run("pnpm", ["ci:inventory", "--", "--output", inventoryPath]);

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const selector = options.caseId
  ? [resolveFunctionalCase(inventory.cases, options.caseId)]
  : ["--grep", "@functional", "--shard", options.shard];

run("pnpm", ["build"]);
run("pnpm", [
  "exec",
  "playwright",
  "test",
  ...selector,
  "--project=chromium",
  "--fully-parallel",
  "--workers=1",
]);
