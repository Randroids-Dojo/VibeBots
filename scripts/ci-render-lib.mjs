import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const RENDER_TIERS = ["render", "visual", "soak"];

const HOST_ENV_ALLOWLIST = [
  "ALL_PROXY",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NO_PROXY",
  "PATH",
  "PNPM_HOME",
  "SHELL",
  "SSH_AUTH_SOCK",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
];

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return args[index + 1];
}

export function parseRenderArgs(args) {
  const tier = args.includes("--tier")
    ? argumentValue(args, "--tier")
    : "render";
  if (tier !== "all" && !RENDER_TIERS.includes(tier)) {
    throw new Error("--tier must be all, render, visual, or soak");
  }
  const root = args.includes("--root")
    ? path.resolve(argumentValue(args, "--root"))
    : null;
  return {
    sha: argumentValue(args, "--sha"),
    tier,
    root,
    scheduled: args.includes("--scheduled"),
  };
}

function processIsActive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function readLockOwner(lockPath) {
  const owner = JSON.parse(readFileSync(lockPath, "utf8"));
  if (
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.startedAt !== "string"
  ) {
    throw new Error(`Real-render lock has an invalid owner: ${lockPath}`);
  }
  return owner;
}

export function acquireRenderLock(lockPath) {
  const owner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx");
      writeFileSync(descriptor, `${JSON.stringify(owner, null, 2)}\n`);
      closeSync(descriptor);
      descriptor = undefined;
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        unlinkSync(lockPath);
      }
      if (error?.code !== "EEXIST") throw error;

      const currentOwner = readLockOwner(lockPath);
      if (!processIsActive(currentOwner.pid)) {
        unlinkSync(lockPath);
        continue;
      }
      throw new Error(
        `Real-render run already active under process ${currentOwner.pid}`,
      );
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        const currentOwner = readLockOwner(lockPath);
        if (
          currentOwner.pid === owner.pid &&
          currentOwner.startedAt === owner.startedAt
        ) {
          unlinkSync(lockPath);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    };
  }

  throw new Error(`Could not acquire real-render lock: ${lockPath}`);
}

export function selectedRenderTiers(tier) {
  return tier === "all" ? [...RENDER_TIERS] : [tier];
}

export function renderEnvironment(hostEnvironment) {
  const environment = {};
  for (const name of HOST_ENV_ALLOWLIST) {
    const value = hostEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }
  return {
    ...environment,
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: "",
    AUTH_SECRET: "",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    WEB_PUSH_CONTACT_EMAIL: "",
    CLERK_SECRET_KEY: "",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
    VIBEBOTS_E2E_MODE: "",
  };
}

export function localDateKey(date, timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function missedDateKeys(previousKey, currentKey) {
  if (!previousKey || previousKey >= currentKey) return [];
  const missed = [];
  const cursor = new Date(`${previousKey}T12:00:00.000Z`);
  const current = new Date(`${currentKey}T12:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor < current) {
    missed.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return missed;
}

export function scheduledHeartbeatDateKey(heartbeat) {
  return heartbeat?.source === "scheduled" &&
    typeof heartbeat.dateKey === "string"
    ? heartbeat.dateKey
    : null;
}

export function summarizeTierResults(tiers) {
  if (tiers.some((tier) => tier.status === "failed")) return "failure";
  if (tiers.every((tier) => tier.status === "skipped")) return "skipped";
  return "success";
}

export function renderTierStatus(exitCode, outcomes) {
  if (
    exitCode !== 0 ||
    outcomes.some((outcome) =>
      ["failed", "timedOut", "interrupted"].includes(outcome),
    )
  ) {
    return "failed";
  }
  return outcomes.every((outcome) => outcome === "skipped")
    ? "skipped"
    : "passed";
}
