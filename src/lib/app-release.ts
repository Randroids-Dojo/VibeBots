import { execFileSync } from "node:child_process";
import packageJson from "../../package.json";
import type { AppRelease } from "./app-release-types";

const BACKFILL_RELEASE_NOTE =
  "Last 48 hours: falling rocks, embedded save fixes, Vibe-Brainiums, death-only traversal refills, loot-collecting dynamite upgrades, Warpcoil and Blast Charge buys, elevator speed, and mining SFX.";
const BACKFILL_NOTICE_ID = "2026-06-16-48h-backfill";

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
    changes: [{ build, text: BACKFILL_RELEASE_NOTE }],
  };
}
