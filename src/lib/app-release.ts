import { execFileSync } from "node:child_process";
import packageJson from "../../package.json";
import type { AppRelease, AppReleaseNote } from "./app-release-types";

const RELEASE_NOTICE_ID = "2026-06-17-0.1.1";

function releaseNotes(build: number | null): AppReleaseNote[] {
  return [
    {
      version: "0.1.1",
      date: "2026-06-17",
      title: "Mine movement and recovery fixes",
      intro:
        "Thanks for the feedback. This update tightens mine movement, recovery, and release visibility.",
      changes: [
        {
          build,
          text: "Unsupported side moves now fall through empty cells instead of refusing when planks are missing, while available planks still bridge gaps.",
        },
        {
          build,
          text: "The miner now settles after support disappears, so collapses no longer leave them floating.",
        },
        {
          build,
          text: "Placed ladders can be picked back up and reused with replay-safe accounting.",
        },
        {
          build,
          text: "Dropped cargo now gets a locator chip that pulses faster as you get closer.",
        },
        {
          build,
          text: "Cash-out messages such as Sold for 3 vibes now auto-hide after a short delay.",
        },
        {
          build,
          text: "VibeKit is pinned to v0.3.0.",
        },
      ],
    },
    {
      version: "0.1.0",
      date: "2026-06-16",
      title: "Mining and workshop foundation",
      intro:
        "Earlier mining updates made runs clearer, fairer, and more rewarding.",
      changes: [
        {
          build: null,
          text: "Falling rocks warn before they hit, tougher rocks have clearer feedback, and SFX cover digging, buying, warping, elevators, hazards, and rewards.",
        },
        {
          build: null,
          text: "Credits are now Vibe-Brainiums, or Vibes for short. Supply Depot buying has quantity controls and clearer labels.",
        },
        {
          build: null,
          text: "Cave-ins refill the next run to 8 ladders and 4 planks, while Abandon stays the clean way to leave a risky dig.",
        },
        {
          build: null,
          text: "Dynamite collects ore and parts it breaks, Blast Charge upgrades grow larger, and Warpcoil purchases work.",
        },
        {
          build: null,
          text: "Upgrades and investments include Pickaxe, Lamp Cell, Cargo Hold, Lantern, Elevator Speed, Warpcoil, Blast Charge, and Winch Tower rail depth.",
        },
        {
          build: null,
          text: "Embedded play is more reliable, and Settings can reopen release notes anytime.",
        },
      ],
    },
  ];
}

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
