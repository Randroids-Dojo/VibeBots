import { execFileSync } from "node:child_process";
import packageJson from "../../package.json";
import type { AppRelease, AppReleaseNote } from "./app-release-types";

const RELEASE_NOTICE_ID = "2026-06-17-0.1.1-fall-harness";

function releaseNotes(build: number | null): AppReleaseNote[] {
  return [
    {
      version: "0.1.1",
      date: "2026-06-17",
      title: "Mine movement, recovery, and fall fixes",
      intro:
        "Thanks for the feedback. This update tightens mine movement, recovery, cargo overflow, and fall risk.",
      changes: [
        {
          build,
          text: "Unsupported side moves now free fall until landing. Falls over 4 cells are fatal unless Fall Harness upgrades raise the limit.",
        },
        {
          build,
          text: "Planks no longer auto-deploy. Use the plank button to place one left or right, including under a solid block before mining it.",
        },
        {
          build,
          text: "Collect mode lets you select visible placed ladders and planks, then return them to inventory with replay-safe accounting.",
        },
        {
          build,
          text: "Elevator rail construction now refunds ladders it replaces, and ladders or planks cannot be placed while riding the rail.",
        },
        {
          build,
          text: "A full cargo hold no longer blocks digging. Overflow ore falls to the nearest surface, stacks with a count, and can be picked up later.",
        },
        {
          build,
          text: "Dropped cargo now gets a locator chip that pulses faster as you get closer.",
        },
        {
          build,
          text: "Cash-out messages such as Sold for 3 vibes now auto-hide after a short delay.",
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
