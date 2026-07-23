#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { outputPathFromArgs } from "./ci-inventory-args.mjs";
import {
  collectCases,
  summarizeInventory,
  validateInventory,
} from "./ci-inventory-lib.mjs";
import {
  fileFromSourceLocation,
  inventorySourcePath,
} from "./ci-source-location.mjs";

function testCallSources(report) {
  const locations = new Set();
  function visitSuite(suite) {
    for (const spec of suite.specs ?? []) {
      locations.add(`${spec.file}:${spec.line}`);
    }
    for (const child of suite.suites ?? []) visitSuite(child);
  }
  for (const suite of report.suites ?? []) visitSuite(suite);

  const sourceByLocation = new Map();
  const files = [...new Set([...locations].map(fileFromSourceLocation))];
  for (const file of files) {
    const filePath = inventorySourcePath(file);
    const source = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "test"
      ) {
        const line =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
        const key = `${file}:${line}`;
        if (locations.has(key))
          sourceByLocation.set(key, node.getText(sourceFile));
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return sourceByLocation;
}

const startedAt = Date.now();
const playwright = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);
const discovery = spawnSync(playwright, ["test", "--list", "--reporter=json"], {
  encoding: "utf8",
  env: process.env,
});
if (discovery.status !== 0) {
  process.stderr.write(discovery.stderr || discovery.stdout);
  process.exit(discovery.status ?? 1);
}

const report = JSON.parse(discovery.stdout);
const quarantine = JSON.parse(
  readFileSync("tests/e2e/quarantine.json", "utf8"),
);
const validation = validateInventory(collectCases(report), quarantine, {
  sourceByLocation: testCallSources(report),
});
const summary = summarizeInventory(validation.cases);
const artifact = {
  schemaVersion: 1,
  commitSha: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  generatedAt: new Date().toISOString(),
  discoveryDurationMs: Date.now() - startedAt,
  summary,
  errors: validation.errors,
  cases: validation.cases,
};

const outputPath = outputPathFromArgs(process.argv.slice(2));
if (outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
}

console.log(
  `Discovered ${summary.total} cases in ${artifact.discoveryDurationMs}ms: ` +
    Object.entries(summary.capabilities)
      .map(([tag, count]) => `${tag}=${count}`)
      .join(" "),
);
if (validation.errors.length > 0) {
  for (const error of validation.errors) console.error(`ERROR ${error}`);
  process.exit(1);
}
