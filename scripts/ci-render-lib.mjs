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
  const tier = args.includes("--tier") ? argumentValue(args, "--tier") : "all";
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
