import path from "node:path";

export const RENDER_TIERS = ["render", "visual", "soak"];

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
