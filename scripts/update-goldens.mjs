import { spawnSync } from "node:child_process";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const reasonIndex = args.indexOf("--reason");
const reason = reasonIndex >= 0 ? args[reasonIndex + 1]?.trim() : "";

if (!reason) {
  console.error(
    "Golden updates require: pnpm test:goldens:update -- --reason <text>",
  );
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "tests/goldens/update-runner.test.ts",
    "--reporter=verbose",
  ],
  {
    env: {
      ...process.env,
      VIBEBOTS_GOLDEN_REASON: reason,
      VIBEBOTS_UPDATE_GOLDENS: "1",
    },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
