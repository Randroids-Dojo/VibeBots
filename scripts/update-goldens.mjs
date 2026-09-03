import { spawnSync } from "node:child_process";
import {
  goldenUpdatePlan,
  parseReason,
  spawnFailure,
  USAGE,
} from "./update-goldens-lib.mjs";

const reason = parseReason(process.argv.slice(2));

if (!reason) {
  console.error(USAGE);
  process.exit(1);
}

const plan = goldenUpdatePlan({
  platform: process.platform,
  reason,
  env: process.env,
});

const run = spawnSync(plan.run.command, plan.run.args, {
  env: plan.run.env,
  shell: plan.run.shell,
  stdio: "inherit",
});
const runFailure = spawnFailure("the update runner", run);
if (runFailure) {
  console.error(runFailure);
  process.exit(1);
}
if (run.status !== 0) process.exit(run.status);

// The runner writes JSON the Quality gate would reformat; settle it here so
// the update lands clean.
const format = spawnSync(plan.format.command, plan.format.args, {
  shell: plan.format.shell,
  stdio: "inherit",
});
const formatFailure = spawnFailure("biome", format);
if (formatFailure) {
  console.error(formatFailure);
  process.exit(1);
}
process.exit(format.status ?? 1);
