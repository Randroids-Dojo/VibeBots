import { execFileSync } from "node:child_process";
import packageJson from "../../package.json";
import type { AppRelease, AppReleaseNote } from "./app-release-types";

const RELEASE_NOTICE_ID = "2026-06-17-0.1.12-mine-motion-polish";

function releaseNotes(build: number | null): AppReleaseNote[] {
  return [
    {
      version: "0.1.12",
      date: "2026-06-17",
      title: "Mine motion polish",
      intro:
        "Mine movement now animates as a smooth fixed step instead of a fast target chase.",
      changes: [
        {
          build,
          text: "The miner now moves through a short retargetable tween, so repeated inputs do not snap or asymptotically chase the next cell.",
        },
        {
          build,
          text: "The camera uses the same fixed-step motion shape, keeping the robot framed without the old twitchy catch-up feel.",
        },
        {
          build,
          text: "Held movement repeats have a little more breathing room, so the visual step settles before the next repeated action.",
        },
      ],
    },
    {
      version: "0.1.11",
      date: "2026-06-17",
      title: "Horizontal mine visibility",
      intro:
        "Mine visibility now respects the Lantern range left and right, not just below the miner.",
      changes: [
        {
          build,
          text: "Lantern visibility now applies left and right as well as downward, so distant horizontal cells stay hidden until you move closer.",
        },
        {
          build,
          text: "Zoom-out is capped horizontally by the current Lantern reach plus the same short dark falloff band.",
        },
        {
          build,
          text: "Dark-edge cells still use the same generated mine data that appears when the miner reaches those cells later.",
        },
      ],
    },
    {
      version: "0.1.10",
      date: "2026-06-17",
      title: "Mine action feel",
      intro:
        "Movement and mining now respond on press, then animate quickly enough to keep up with held input.",
      changes: [
        {
          build,
          text: "Fresh keyboard presses and new thumbstick directions fire immediately instead of waiting behind the held-repeat cadence.",
        },
        {
          build,
          text: "Held key and thumbstick repeats now use a much faster pickaxe-scaled cadence, so walking and multi-hit mining feel continuous.",
        },
        {
          build,
          text: "The miner and camera now glide with faster frame-rate-independent easing, keeping the visible robot close to the sim target.",
        },
        {
          build,
          text: "Pick swings, lunges, and too-hard bounces are shorter so each strike finishes before the next held repeat.",
        },
      ],
    },
    {
      version: "0.1.9",
      date: "2026-06-17",
      title: "Base return confirmation",
      intro:
        "Paid base return now confirms reliably from the surface without trying to bank again.",
      changes: [
        {
          build,
          text: "Base return can now be confirmed after touching the mine or returning from below ground.",
        },
        {
          build,
          text: "The paid return charges vibes and moves the miner to the shaft center without forcing a mine checkpoint.",
        },
        {
          build,
          text: "Surface auto-sell now only checks when the miner comes up from below ground, not on every surface step.",
        },
      ],
    },
    {
      version: "0.1.8",
      date: "2026-06-17",
      title: "Mine resource stacks",
      intro:
        "Depth, plank movement, and mined-resource feedback are clearer while deeper rows keep paying richer stacks.",
      changes: [
        {
          build,
          text: "The mine HUD now labels the current row as Depth, so the depth number is easier to scan while moving.",
        },
        {
          build,
          text: "Pressing down while standing on a plank is blocked, so the miner no longer falls through a plank cell.",
        },
        {
          build,
          text: "Mined ore now pops a short resource-colored label with the material name and exact stack count.",
        },
        {
          build,
          text: "Older resource tiers remain available as rare trace finds in deeper rows instead of disappearing completely.",
        },
        {
          build,
          text: "Ore cells now yield larger deterministic stacks as depth increases, scaling rewards toward the 1000-row cap.",
        },
      ],
    },
    {
      version: "0.1.7",
      date: "2026-06-17",
      title: "Surface base return",
      intro:
        "Walking far past the village now gets a clear route home and an optional paid return.",
      changes: [
        {
          build,
          text: "When no surface buildings are visible, an animated base indicator points back toward the village.",
        },
        {
          build,
          text: "Tapping the indicator opens a Base return menu with a distance-scaled vibe cost.",
        },
        {
          build,
          text: "The return button confirms before spending, disables when the wallet cannot cover the cost, and drops the miner at the shaft center.",
        },
        {
          build,
          text: "Surface returns and warp jumps now show a teleport burst, with the existing warp sound on paid base returns.",
        },
      ],
    },
    {
      version: "0.1.6",
      date: "2026-06-17",
      title: "Mine flow fixes",
      intro:
        "Surface banking, elevator travel, support recovery, and input cadence now match the current mining rules.",
      changes: [
        {
          build,
          text: "Reaching the surface with a haul now sells it automatically and puts the vibes straight in your wallet.",
        },
        {
          build,
          text: "Elevator rides auto-chain to the rail bottom or surface, with Elevator Speed upgrades making each automatic step longer and faster.",
        },
        {
          build,
          text: "Rail construction and a one-time account cleanup now return ladders and planks hidden behind elevator rails.",
        },
        {
          build,
          text: "Collect mode no longer opens a support list. Tap visible ladder or plank cells to mark them, then confirm the pickup.",
        },
        {
          build,
          text: "Walking and mining share one cadence for held input and repeated taps, with small speed gains from Pickaxe upgrades.",
        },
      ],
    },
    {
      version: "0.1.5",
      date: "2026-06-17",
      title: "Auto-bank upgrades",
      intro:
        "Surface upgrades now settle your haul first, and mine zoom has a darker falloff edge.",
      changes: [
        {
          build,
          text: "Buying an Upgrades stall item with hauled-up loot now banks that loot before spending.",
        },
        {
          build,
          text: "The upgraded gear immediately rebuilds the fresh trip, so Lantern zoom and visibility match the upgrade you just bought.",
        },
        {
          build,
          text: "The Upgrades sheet counts hauled-up vibes toward affordability and labels bank-first purchases.",
        },
        {
          build,
          text: "Zoom-out reaches slightly past the fully lit Lantern range, with outer rows fading into darkness until you walk closer.",
        },
      ],
    },
    {
      version: "0.1.4",
      date: "2026-06-17",
      title: "Lantern-gated mine zoom",
      intro:
        "The mine camera can zoom now, and stronger lanterns let you pull back farther.",
      changes: [
        {
          build,
          text: "Scroll wheel, two-finger pinch, and trigger or shoulder plus D-pad gamepad input adjust the mine camera zoom.",
        },
        {
          build,
          text: "Zoom-out is capped by the current lantern reach, so higher Lantern upgrades increase the camera's overview range.",
        },
        {
          build,
          text: "Rows revealed by zoom use the same generated mine cells you see when the miner gets closer.",
        },
      ],
    },
    {
      version: "0.1.3",
      date: "2026-06-17",
      title: "Robot battery wording",
      intro:
        "The miner is a robot, so its trip resource now reads as battery charge instead of lamp energy.",
      changes: [
        {
          build,
          text: "The former Lamp Cell upgrade is now Battery Cell in the Upgrades stall and gear payloads.",
        },
        {
          build,
          text: "Mine HUD, collapse, gas, and near-miss messages now refer to battery charge for the robot's endurance.",
        },
        {
          build,
          text: "Older saved gear snapshots and the existing storage column still work through a compatibility layer.",
        },
      ],
    },
    {
      version: "0.1.2",
      date: "2026-06-17",
      title: "Workshop inventory gates",
      intro:
        "This update connects the Workshop to the parts you have earned or bought.",
      changes: [
        {
          build,
          text: "The Workshop now checks owned part inventory before a part can be added to the active bot.",
        },
        {
          build,
          text: "The palette shows remaining owned copies after the parts already used in the current design.",
        },
        {
          build,
          text: "Saved designs are rejected if they use parts the player does not own.",
        },
        {
          build,
          text: "Server match verification can enforce owned inventory for the player's submitted design.",
        },
      ],
    },
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
