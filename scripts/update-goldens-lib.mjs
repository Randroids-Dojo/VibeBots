// The plan behind `pnpm test:goldens:update -- --reason <text>`: which
// commands run, how, and what to say when one cannot start. Pure so the
// Windows case is a unit test instead of a machine (F-251).

/** The reason after `--reason`, trimmed; empty when missing. */
export function parseReason(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const index = args.indexOf("--reason");
  return index >= 0 ? (args[index + 1] ?? "").trim() : "";
}

export const USAGE =
  "Golden updates require: pnpm test:goldens:update -- --reason <text>";

/**
 * The two spawns of an update, in order: the vitest runner that rewrites
 * the vectors and the manifest, then biome on the files it wrote, because
 * the runner prints one-element arrays across lines and the Quality gate
 * wants them on one.
 *
 * On Windows `pnpm` is a `.cmd` shim, which `spawnSync` cannot start
 * without a shell: the spawn fails with a null status, which the script
 * used to turn into a silent exit 1.
 */
export function goldenUpdatePlan({ platform, reason, env = {} }) {
  const shell = platform === "win32";
  return {
    run: {
      command: "pnpm",
      args: [
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.goldens.config.ts",
        "tests/goldens/update-runner.test.ts",
        "--reporter=verbose",
      ],
      shell,
      env: {
        ...env,
        VIBEBOTS_GOLDEN_REASON: reason,
        VIBEBOTS_UPDATE_GOLDENS: "1",
      },
    },
    format: {
      command: "pnpm",
      args: ["exec", "biome", "format", "--write", "tests/goldens"],
      shell,
    },
  };
}

/** What to print when a spawn never started or ended without a status. */
export function spawnFailure(step, result) {
  if (result.error) {
    return `Golden update: ${step} could not start (${result.error.message}).`;
  }
  if (result.status === null) {
    return `Golden update: ${step} ended without an exit status${
      result.signal ? ` (signal ${result.signal})` : ""
    }.`;
  }
  return null;
}
