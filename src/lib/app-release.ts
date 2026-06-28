import { execFileSync } from "node:child_process";
import packageJson from "../../package.json";
import { RELEASE_NOTICE_ID, releaseNotes } from "./app-release-notes";
import type { AppRelease } from "./app-release-types";

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
  const notes = releaseNotes(build);
  const newest = notes[0];
  const version =
    build === null
      ? `${packageJson.version}+${ref}`
      : `${packageJson.version}.${build}`;
  return {
    noticeId: RELEASE_NOTICE_ID,
    version,
    build,
    ref,
    showToAll: true,
    intro: newest?.intro,
    changes: newest?.changes ?? [],
    notes,
  };
}
