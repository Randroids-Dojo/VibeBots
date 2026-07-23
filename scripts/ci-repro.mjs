#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseReproArgs,
  pinnedRuntimeImage,
  shellQuote,
} from "./ci-repro-lib.mjs";

const options = parseReproArgs(process.argv.slice(2));
const root = process.cwd();
const status = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=normal"],
  { encoding: "utf8" },
).trim();
if (status) {
  throw new Error(
    "ci:repro requires a clean checkout so the reported commit is exact",
  );
}

const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const manifest = JSON.parse(
  readFileSync("ci/browser-runtime/runtime.json", "utf8"),
);
const image = pinnedRuntimeImage(manifest, options.imageDigest);
const temporary = mkdtempSync(path.join(os.tmpdir(), "vibebots-ci-repro-"));
for (const directory of ["home", "next", "node_modules", "pnpm-store"]) {
  mkdirSync(path.join(temporary, directory));
}

const dockerArgs = [
  "run",
  "--rm",
  "--init",
  "--ipc=host",
  "--user",
  `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
  "--env",
  "CI=true",
  "--env",
  `GITHUB_SHA=${commitSha}`,
  "--env",
  `CI_CASE_COMMIT_SHA=${commitSha}`,
  "--env",
  "HOME=/tmp/vibebots-home",
  "--env",
  "DATABASE_URL=",
  "--env",
  "AUTH_SECRET=",
  "--env",
  "VAPID_PUBLIC_KEY=",
  "--env",
  "VAPID_PRIVATE_KEY=",
  "--env",
  "WEB_PUSH_CONTACT_EMAIL=",
  "--env",
  "CLERK_SECRET_KEY=",
  "--env",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=",
  "--volume",
  `${root}:/workspace`,
  "--volume",
  `${path.join(temporary, "home")}:/tmp/vibebots-home`,
  "--volume",
  `${path.join(temporary, "next")}:/workspace/.next`,
  "--volume",
  `${path.join(temporary, "node_modules")}:/workspace/node_modules`,
  "--volume",
  `${path.join(temporary, "pnpm-store")}:/pnpm/store`,
  "--workdir",
  "/workspace",
  image,
  "node",
  "scripts/ci-repro-inner.mjs",
  ...(options.caseId ? ["--case", options.caseId] : []),
  ...(options.shard ? ["--shard", options.shard] : []),
];

console.log(`Commit: ${commitSha}`);
console.log(`Runtime: ${image}`);
console.log(`Inner command: docker ${dockerArgs.map(shellQuote).join(" ")}`);

try {
  const result = spawnSync("docker", dockerArgs, { stdio: "inherit" });
  if (result.error) {
    throw new Error(`Unable to start Docker: ${result.error.message}`);
  }
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
