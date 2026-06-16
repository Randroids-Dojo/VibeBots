import { execFileSync } from "node:child_process";
import packageJson from "../../package.json";
import type { AppRelease } from "./app-release-types";

const BACKFILL_RELEASE_INTRO =
  "Thanks for the feedback. Recent mining updates make runs clearer, fairer, and more rewarding.";
const BACKFILL_RELEASE_NOTES = [
  "Falling rocks now warn before they hit, tougher rocks give clearer bounce and spark feedback, and new SFX make digging, buying, warping, elevators, hazards, and rewards easier to read.",
  "Credits are now Vibe-Brainiums, or Vibes for short. Supply Depot buying is faster with quantity controls and clearer labels, and the ladder icon now matches what it does.",
  "If a run ends in a cave-in, your next run starts with 8 ladders and 4 planks. Abandon still gives you a clean way to leave a risky dig.",
  "Dynamite now collects the ore and parts it breaks, Blast Charge upgrades can grow much larger, and Warpcoil purchases now work.",
  "Upgrades and investments now include Pickaxe, Lamp Cell, Cargo Hold, Lantern, Elevator Speed, Warpcoil, Blast Charge, and Winch Tower rail depth.",
  "Embedded play is more reliable, and Settings can reopen these release notes anytime.",
];
const BACKFILL_NOTICE_ID = "2026-06-16-48h-backfill-v2";

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function currentBuild(): number | null {
  const raw = git(["rev-list", "--count", "HEAD"]);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function currentRef(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    git(["rev-parse", "--short", "HEAD"]) ??
    "local"
  );
}

export function getAppRelease(): AppRelease {
  const build = currentBuild();
  const ref = currentRef();
  const version =
    build === null
      ? `${packageJson.version}+${ref}`
      : `${packageJson.version}.${build}`;
  return {
    noticeId: BACKFILL_NOTICE_ID,
    version,
    build,
    ref,
    showToAll: true,
    intro: BACKFILL_RELEASE_INTRO,
    changes: BACKFILL_RELEASE_NOTES.map((text) => ({ build, text })),
  };
}
