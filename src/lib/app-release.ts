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
  // Baked by next.config.ts at build time; the only reliable source in
  // a deployed runtime, where there is no git checkout to count (and
  // the Vercel build clone is shallow, so counting there lies too).
  const baked = Number(process.env.NEXT_PUBLIC_APP_BUILD);
  if (Number.isInteger(baked) && baked > 0) return baked;
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
