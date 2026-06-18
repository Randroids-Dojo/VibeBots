import { execFileSync } from "node:child_process";
import packageJson from "../../package.json";
import type { AppRelease, AppReleaseNote } from "./app-release-types";

const RELEASE_NOTICE_ID = "2026-06-18-0.1.27-mine-progression-pacing";

function releaseNotes(build: number | null): AppReleaseNote[] {
  return [
    {
      version: "0.1.27",
      date: "2026-06-18",
      title: "Mine progression pacing",
      intro:
        "Held mining and movement now start slower and ramp with mining progression.",
      changes: [
        {
          build,
          text: "Held keyboard and thumbstick actions now begin at a calmer cadence instead of the recent fast-repeat pace.",
        },
        {
          build,
          text: "Mining progression across Pickaxe, Battery Cell, Cargo Hold, Lantern, and Fall Harness gradually tightens the held-action cadence as the miner improves.",
        },
        {
          build,
          text: "The miner's visible step animation follows the same progression curve, so early movement reads slower while upgraded runs still feel responsive.",
        },
      ],
    },
    {
      version: "0.1.26",
      date: "2026-06-18",
      title: "Mine falling rocks",
      intro:
        "Falling rocks are now diggable obstacles when your pickaxe is strong enough for their current depth.",
      changes: [
        {
          build,
          text: "A teetering rock or boulder can be mined before it drops if the current row's rock tier is within your pickaxe level.",
        },
        {
          build,
          text: "A landed falling boulder can be mined afterward instead of becoming a permanent blocked path.",
        },
        {
          build,
          text: "Fallen rocks use the tier for the row they occupy, so a deeper landing still asks for the deeper pickaxe upgrade.",
        },
      ],
    },
    {
      version: "0.1.25",
      date: "2026-06-18",
      title: "Support salvage",
      intro:
        "Support cleanup now salvages ladders and planks for partial vibes instead of refunding full consumables.",
      changes: [
        {
          build,
          text: "Only ladders and planks in the miner's adjacent 3x3 salvage range brighten, so nearby targets are easier to pick out in the mine.",
        },
        {
          build,
          text: "Selected supports now use a simple red outline instead of yellow circles or floating text labels.",
        },
        {
          build,
          text: "Salvaged supports now add carried partial vibe value. Planks can also be broken for salvage after repeated pickaxe hits.",
        },
      ],
    },
    {
      version: "0.1.24",
      date: "2026-06-18",
      title: "Smarter battle targeting",
      intro:
        "Battle bots now pick weak points instead of only driving at the enemy core.",
      changes: [
        {
          build,
          text: "Bots score enemy parts by category, remaining health, structural importance, exposure, reachability, and weapon danger.",
        },
        {
          build,
          text: "Weaponed bots line up their weapon side with the chosen target instead of treating every hit as a center ram.",
        },
        {
          build,
          text: "Out-weaponed or damaged bots try safer flank approaches and can switch to mobility kills.",
        },
        {
          build,
          text: "The deterministic match version moved to SIM_VERSION 3, so official results reject older sim-version requests.",
        },
      ],
    },
    {
      version: "0.1.23",
      date: "2026-06-18",
      title: "Workshop part merging",
      intro:
        "The Workshop now lets you merge duplicate robot parts into a stronger selected part, and portrait phone screens stack the Workshop panels cleanly.",
      changes: [
        {
          build,
          text: "Select a non-core part in the Workshop and use Merge selected to spend another owned copy on that part.",
        },
        {
          build,
          text: "Merged parts gain combat durability at level 2 and level 3 while keeping their mass, power, connectors, and shape unchanged.",
        },
        {
          build,
          text: "On portrait phones, the build controls and parts shop now stack into one column so the menus do not overlap.",
        },
      ],
    },
    {
      version: "0.1.22",
      date: "2026-06-17",
      title: "Elevator rail controls",
      intro:
        "Elevators now behave like a real built rail: step onto it, then choose up or down from that floor.",
      changes: [
        {
          build,
          text: "Buttons appear only while you stand on an elevator rail cell, so the controls match the world you can see.",
        },
        {
          build,
          text: "Any owned rail floor can start a ride down or back up, so you do not have to return to the surface first.",
        },
        {
          build,
          text: "The mistaken current-column ride behavior is gone, so elevator placement, rail cleanup, and mined paths stay predictable.",
        },
      ],
    },
    {
      version: "0.1.21",
      date: "2026-06-17",
      title: "Support stock repair",
      intro:
        "Affected long-running accounts can have support stock corrected without adding hidden cash-out rules.",
      changes: [
        {
          build,
          text: "Successful cash-out now returns authoritative consumable counts so the browser stops carrying stale ladder or plank stock into the next trip.",
        },
        {
          build,
          text: "A dry-run-first repair command can raise ladder and plank stock for a known affected player without touching vibes, resources, paid consumables, gear, or trip state.",
        },
        {
          build,
          text: "Cash-out replay stays simple: server-owned stock is still authoritative, and dynamite, rope, and beacon overclaims still fail before replay.",
        },
      ],
    },
    {
      version: "0.1.20",
      date: "2026-06-17",
      title: "Superseded elevator experiment",
      intro:
        "This release briefly tried current-column elevator rides. Version 0.1.22 replaced that with rail-only floor controls.",
      changes: [
        {
          build,
          text: "The experiment made ride buttons appear away from the built rail.",
        },
        {
          build,
          text: "It was superseded because elevator controls should require standing on the elevator cell.",
        },
        {
          build,
          text: "See 0.1.22 for the corrected behavior.",
        },
      ],
    },
    {
      version: "0.1.19",
      date: "2026-06-17",
      title: "Mine base offset",
      intro:
        "The mine HUD now shows how far left or right you are from the home shaft.",
      changes: [
        {
          build,
          text: "The Depth chip now includes a signed Base offset, so left of home shows a negative number and right of home shows a positive number.",
        },
        {
          build,
          text: "The signed offset is exposed as a stable HUD data attribute for smoke coverage.",
        },
      ],
    },
    {
      version: "0.1.18",
      date: "2026-06-17",
      title: "Support snapshot cash-out fix",
      intro:
        "Older mine trips with stale ladder or plank counts can now finish selling at the surface.",
      changes: [
        {
          build,
          text: "Server replay now uses the ladder and plank stock saved on the player row instead of failing when an old client snapshot is off by a rung.",
        },
        {
          build,
          text: "Dynamite, rope, and beacon snapshots still hard-fail when they exceed server-owned stock, so paid consumables cannot be faked.",
        },
        {
          build,
          text: "The fix is based on production alert logs that showed repeated support-only cash-out rejects for one long-running mine.",
        },
      ],
    },
    {
      version: "0.1.17",
      date: "2026-06-17",
      title: "Fall death feedback",
      intro:
        "Fatal free falls now stay on camera through the drop and impact instead of snapping straight to the surface report.",
      changes: [
        {
          build,
          text: "The mine camera follows the miner in real time during fatal falls and shows the landing before the trip report appears.",
        },
        {
          build,
          text: "A new impact burst and fall-death SFX play at the bottom of the drop.",
        },
        {
          build,
          text: "Fall deaths now say Fell too far instead of incorrectly reporting a boulder crush.",
        },
        {
          build,
          text: "The sim still uses the same deterministic death recovery and lost-cargo rules; only the result metadata and presentation changed.",
        },
      ],
    },
    {
      version: "0.1.16",
      date: "2026-06-17",
      title: "Base return danger confirm",
      intro:
        "Paid base return now makes the final confirmation look like the costly action it is.",
      changes: [
        {
          build,
          text: "The Base return button stays teal for the first Teleport tap, then turns red when it asks for final confirmation.",
        },
        {
          build,
          text: "The disabled and insufficient-vibes states keep their muted styling, so only the armed paid action reads as destructive.",
        },
      ],
    },
    {
      version: "0.1.15",
      date: "2026-06-17",
      title: "Legacy support cash-out",
      intro:
        "Long-running mines can now sell surfaced hauls even if an old trip carried historical ladder or plank stock.",
      changes: [
        {
          build,
          text: "Old in-flight ladder and plank snapshots are reconciled once against the starter support floor instead of blocking auto-sell.",
        },
        {
          build,
          text: "Dynamite, rope, and beacon stock still validate against server ownership, so paid consumables cannot be faked for extra payout.",
        },
        {
          build,
          text: "The active mine HUD now says Selling haul and Sold instead of showing bank wording during auto-sell.",
        },
        {
          build,
          text: "Cash-out failures and legacy support reconciliations now emit structured alert logs for ongoing monitoring.",
        },
      ],
    },
    {
      version: "0.1.14",
      date: "2026-06-17",
      title: "Thumbstick cadence",
      intro:
        "Held thumbstick movement now keeps a steadier rhythm while walking in one direction.",
      changes: [
        {
          build,
          text: "Touch repeats now trust the thumbstick's own pacing instead of passing through a second repeat gate.",
        },
        {
          build,
          text: "The missed-beat pause that could show up during long one-direction walks is removed.",
        },
        {
          build,
          text: "Keyboard held-repeat throttling stays in place, so browser key repeat cannot spam extra actions.",
        },
      ],
    },
    {
      version: "0.1.13",
      date: "2026-06-17",
      title: "Buyer appraisal",
      intro:
        "The Buyer now has a clearer job after surface auto-sell: appraisal and mining goals.",
      changes: [
        {
          build,
          text: "The Buyer shows current haul value, carried parts, hold space, and next depth target without adding a manual sell button.",
        },
        {
          build,
          text: "Carried ore is itemized by resource with stack counts and vibe values so the surface haul is easier to understand.",
        },
        {
          build,
          text: "Auto-sell remains the rule: reaching the surface with a haul puts vibes straight into the wallet.",
        },
      ],
    },
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
