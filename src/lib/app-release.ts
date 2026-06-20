import { execFileSync } from "node:child_process";
import packageJson from "../../package.json";
import type { AppRelease, AppReleaseNote } from "./app-release-types";

const RELEASE_NOTICE_ID = "2026-06-20-0.1.88-death-cam-flash";

function releaseNotes(build: number | null): AppReleaseNote[] {
  return [
    {
      version: "0.1.88",
      date: "2026-06-20",
      title: "Death cam flash fix",
      intro:
        "Mason, load your first save now. Death animations now keep the mine filled from the first frame.",
      changes: [
        {
          build,
          text: "Fatal falls and falling-rock crushes now prepare the death camera before the browser paints the next frame.",
        },
        {
          build,
          text: "The camera no longer gets one frame ahead of the populated underground cell window, removing the brief void flash.",
        },
        {
          build,
          text: "Mine rules, recovery, and replay behavior are unchanged.",
        },
      ],
    },
    {
      version: "0.1.87",
      date: "2026-06-20",
      title: "Mine zoom buttons",
      intro:
        "Mason, load your first save now. The mine HUD now has direct zoom controls.",
      changes: [
        {
          build,
          text: "The HUD now has on-screen zoom in and zoom out buttons in a clear camera dock for mouse, touch, and gamepad players who want direct camera control.",
        },
        {
          build,
          text: "Zoom out still caps at the active Lantern range, and each Lantern upgrade opens a meaningfully wider camera limit.",
        },
        {
          build,
          text: "The miner headlamp now scales with Lantern range so lit cells stay readable while the outer two-cell border keeps its dark falloff.",
        },
      ],
    },
    {
      version: "0.1.86",
      date: "2026-06-20",
      title: "Death cam fix",
      intro:
        "Mason, load your first save now. Death animations now stay inside the real mine view.",
      changes: [
        {
          build,
          text: "Fatal falls and falling-rock crushes keep rendering the populated underground cells around the death.",
        },
        {
          build,
          text: "The trip report still waits until the fall or crush impact finishes, but the camera no longer shows a sudden empty void.",
        },
        {
          build,
          text: "Mine rules, recovery, and replay behavior are unchanged.",
        },
      ],
    },
    {
      version: "0.1.85",
      date: "2026-06-20",
      title: "Save slot refresh",
      intro: "Mason, load your first save now.",
      changes: [
        {
          build,
          text: "After the server accepts a Load game slot switch, the client now reloads the mine world and gear for that slot before returning to the mine.",
        },
        {
          build,
          text: "This prevents a previously open save from staying visible after choosing another saved slot.",
        },
      ],
    },
    {
      version: "0.1.84",
      date: "2026-06-20",
      title: "Upgrade rebalance",
      intro: "Tool upgrades now stretch deeper into the long mine.",
      changes: [
        {
          build,
          text: "Pickaxe, battery, cargo, lantern, warpcoil, elevator speed, and fall harness tracks now have longer level ladders.",
        },
        {
          build,
          text: "Later upgrades require both bunker-earned player levels and durable deepest-depth progress before the shop will sell them.",
        },
        {
          build,
          text: "Balance events now record key per-player economy milestones for future tuning, including cash-outs, upgrades, purchases, elevator extensions, and raid rewards.",
        },
      ],
    },
    {
      version: "0.1.83",
      date: "2026-06-20",
      title: "Beacon depth gate",
      intro: "Warp Beacons now respect your current Warpcoil range.",
      changes: [
        {
          build,
          text: "Planting a Warp Beacon deeper than the current Warpcoil range is refused before a kit is spent.",
        },
        {
          build,
          text: "The beacon icon stays visible but dimmed at too-deep rows, so tapping it explains the needed upgrade.",
        },
        {
          build,
          text: "The surface tip rotation now reminds players that beacon placement is tied to Warpcoil range.",
        },
      ],
    },
    {
      version: "0.1.82",
      date: "2026-06-20",
      title: "Pickaxe gate hints",
      intro: "Hard rock walls now tell you which Pickaxe level they need.",
      changes: [
        {
          build,
          text: "When a rock or fallen rock is too hard, the mine shows a temporary floating Pickaxe level hint above the playfield.",
        },
        {
          build,
          text: "The hint uses normal HUD text, not canvas text, so it stays readable on mobile renderers.",
        },
        {
          build,
          text: "Pickaxe gate rules, mine replay behavior, and gameplay versions are unchanged.",
        },
      ],
    },
    {
      version: "0.1.81",
      date: "2026-06-20",
      title: "Bunker claim clarity",
      intro: "Bunker claim mode now marks blockers in red.",
      changes: [
        {
          build,
          text: "Every local cell that still needs clearing inside the 7x5 claim is highlighted in red in the mine view.",
        },
        {
          build,
          text: "The claim button stays disabled until the local mine and the banked checkpoint both have the full area clear, including the miner's row.",
        },
        {
          build,
          text: "Shallow claim attempts and clear-but-unbanked rooms now explain the next step instead of sending a failing claim request.",
        },
      ],
    },
    {
      version: "0.1.80",
      date: "2026-06-20",
      title: "Bag stacks and ore rebalance",
      intro:
        "The mine bag now stacks matching resources with lower ore values.",
      changes: [
        {
          build,
          text: "Each bag slot holds one resource type and stacks up to five chunks, so matching ore tops off existing stacks before using an empty slot.",
        },
        {
          build,
          text: "Ore chunks now sell for much smaller whole-vibe amounts to balance the larger stack capacity.",
        },
        {
          build,
          text: "When no compatible stack space remains, mined overflow drops to the floor and the HUD flashes with a full-bag sound.",
        },
        {
          build,
          text: "The open bag now shows resource graphics, stack counts, max-stack overlays, and drops the whole selected stack.",
        },
      ],
    },
    {
      version: "0.1.79",
      date: "2026-06-20",
      title: "Stamp catalog refresh",
      intro: "The Stamp Book now covers newer mine features.",
      changes: [
        {
          build,
          text: "New biome stamps track activating one distant biome portal and then both biome portals.",
        },
        {
          build,
          text: "New bag stamps track successful uses of Drop selected from the bag to make room during a trip.",
        },
        {
          build,
          text: "Already activated biome portals count from the saved mine diff, while new bag-drop stamp progress starts from successful recorded drops after this release.",
        },
      ],
    },
    {
      version: "0.1.78",
      date: "2026-06-20",
      title: "Falling rock durability",
      intro:
        "Falling rocks and boulders now take at least two hits to destroy.",
      changes: [
        {
          build,
          text: "Falling and fallen rocks or boulders still use their row pickaxe tier gate, but they cannot break in fewer than two pickaxe hits.",
        },
        {
          build,
          text: "Fully upgraded pickaxes still speed up ordinary rock, while falling hazards keep a short rescue window to stop the fall.",
        },
        {
          build,
          text: "The surface tip rotation now calls out the two-move timer and two-hit minimum together.",
        },
      ],
    },
    {
      version: "0.1.77",
      date: "2026-06-20",
      title: "Upward mining warning",
      intro: "Miners can now chip overhead cells and get a danger cue.",
      changes: [
        {
          build,
          text: "Pressing up into a solid diggable cell now mines that overhead block without spending a ladder or climbing into it.",
        },
        {
          build,
          text: "Held up input waits for release after the overhead block opens, so a ladder is only placed after a fresh up command.",
        },
        {
          build,
          text: "If that overhead dig starts a falling-rock countdown, the mine plays a dedicated warning sound and flashes amber particles at the unstable rock.",
        },
      ],
    },
    {
      version: "0.1.76",
      date: "2026-06-20",
      title: "Surface tip rotation",
      intro: "Surface tips now rotate while you are topside.",
      changes: [
        {
          build,
          text: "The mine surface tip slot now refreshes about every 15 seconds while the miner is on the surface.",
        },
        {
          build,
          text: "Some rotation slots intentionally stay empty so the HUD gets quiet moments instead of always showing advice.",
        },
        {
          build,
          text: "The tip copy stays current and no mine rules, replay behavior, or gameplay versions changed.",
        },
      ],
    },
    {
      version: "0.1.75",
      date: "2026-06-20",
      title: "Mine performance samples",
      intro: "The mine now collects lightweight frame samples from real play.",
      changes: [
        {
          build,
          text: "The mine samples real browser frame intervals after the canvas has rendered, then submits compact percentiles for later diagnosis.",
        },
        {
          build,
          text: "Samples include renderer mode, draw calls, viewport size, device pixel ratio, CPU and memory hints, app version, and mine version.",
        },
        {
          build,
          text: "The server stores samples by active player save so slow old laptops can be compared without changing deterministic mine gameplay.",
        },
      ],
    },
    {
      version: "0.1.74",
      date: "2026-06-20",
      title: "Stale trip recovery",
      intro: "Old in-flight mine trips now restore the original save cleanly.",
      changes: [
        {
          build,
          text: "The mine now records the gameplay version beside each local in-flight trip checkpoint.",
        },
        {
          build,
          text: "If a saved trip was played on older mine rules, the client clears only that stale checkpoint and reloads the durable save from the server.",
        },
        {
          build,
          text: "A production repair advanced one affected player's replay counter so their original save loads from the durable world instead of the stale trip.",
        },
      ],
    },
    {
      version: "0.1.73",
      date: "2026-06-20",
      title: "Falling rock crush",
      intro: "Falling rocks now always crush miners caught under them.",
      changes: [
        {
          build,
          text: "A dropping rock now treats every covered cell as lethal, including direct overlap edge cases from saved or replayed mine state.",
        },
        {
          build,
          text: "Crush deaths hold the camera underground for the impact before showing the trip report and hauling the miner back to the village.",
        },
        {
          build,
          text: "The miner visibly flattens under the hit with a burst, shake, and impact sound so the loss reads before the surface reset.",
        },
      ],
    },
    {
      version: "0.1.72",
      date: "2026-06-20",
      title: "Plank side buttons",
      intro: "Both bridge directions now stay visible in the mine HUD.",
      changes: [
        {
          build,
          text: "The mine now shows separate left and right plank buttons instead of swapping one button based on facing.",
        },
        {
          build,
          text: "Each side disables independently when that target cell cannot accept a plank.",
        },
        {
          build,
          text: "Plank placement rules, action logs, and replay behavior are unchanged.",
        },
      ],
    },
    {
      version: "0.1.71",
      date: "2026-06-19",
      title: "Ore yield tuning",
      intro: "Deeper ore and better pickaxes now pay more satisfyingly.",
      changes: [
        {
          build,
          text: "Copper, silver, and later ore tiers now sell for more vibes than shallow coal, with biome resources following the same curve.",
        },
        {
          build,
          text: "Ore swings now roll deterministic yield bursts: some strikes chip nothing loose, while others pop multiple chunks into the bag.",
        },
        {
          build,
          text: "Better Pickaxe levels modestly improve ore burst odds and caps without changing cargo limits or making one cell pay for a whole upgrade.",
        },
      ],
    },
    {
      version: "0.1.70",
      date: "2026-06-19",
      title: "Biome portal beacons",
      intro:
        "Winter and high-tech mine regions now have surface portals to base.",
      changes: [
        {
          build,
          text: "The winter band spans columns -100 through -50 with snow dirt, icy rocks, and cold ore variants.",
        },
        {
          build,
          text: "The high-tech band spans columns 100 through 150 with circuit terrain and minable gadget resources.",
        },
        {
          build,
          text: "Activating a biome surface beacon makes it a free portal to base and a Warp Pad destination, and far surface tiles keep the right grass, snow, or metal top layer.",
        },
      ],
    },
    {
      version: "0.1.69",
      date: "2026-06-19",
      title: "Installed app refresh",
      intro: "Installed mine apps now notice stale builds almost immediately.",
      changes: [
        {
          build,
          text: "The mine checks for a newer build as soon as the app opens instead of waiting thirty seconds.",
        },
        {
          build,
          text: "Returning to an installed app now rechecks the current build when the window regains focus or visibility.",
        },
        {
          build,
          text: "The mine route now renders dynamically so refreshed app shells are not reused as static pages.",
        },
      ],
    },
    {
      version: "0.1.68",
      date: "2026-06-19",
      title: "Ladder removal cleanup",
      intro: "Ladders now use the same edit pickup flow as other supports.",
      changes: [
        {
          build,
          text: "The dedicated ladder removal button is gone from the mine HUD.",
        },
        {
          build,
          text: "Use Edit placed pickups to select planted ladders, then confirm Pick up to remove them.",
        },
        {
          build,
          text: "Plank placement, ladder physics, support salvage value, and replay rules are unchanged.",
        },
      ],
    },
    {
      version: "0.1.67",
      date: "2026-06-19",
      title: "Release note accuracy",
      intro:
        "Release notes now match the Settings feedback entry point and current push setup.",
      changes: [
        {
          build,
          text: "The latest feedback release copy now names Settings as the place to send feedback.",
        },
        {
          build,
          text: "The native alert summary now uses the corrected release wording for subscribed Android and installed iPhone or iPad players.",
        },
        {
          build,
          text: "The release history keeps feedback, native alerts, and Vercel push setup notes in current deployment order.",
        },
      ],
    },
    {
      version: "0.1.66",
      date: "2026-06-19",
      title: "Bag drop controls",
      intro: "The open bag can now drop selected ore slots to make room.",
      changes: [
        {
          build,
          text: "Tap one or more ore cells in the open bag, then use Drop selected to leave those chunks on the current underground cell.",
        },
        {
          build,
          text: "Manual drops merge with existing floor piles, and walk-over pickup takes older floor ore before reclaiming chunks you just dropped.",
        },
        {
          build,
          text: "Dropping from the open bag never auto-picks floor ore from the same cell, so standing on a pile stays predictable until you move away and back.",
        },
      ],
    },
    {
      version: "0.1.65",
      date: "2026-06-19",
      title: "Tool satchel bag",
      intro: "The open bag now looks like a mine-worn tool satchel.",
      changes: [
        {
          build,
          text: "The bag window now opens as a soft satchel with a handle, latches, stitched rim, and folded center.",
        },
        {
          build,
          text: "The lid summarizes ore pockets, scrap, and parts while the tray keeps the capacity grid.",
        },
        {
          build,
          text: "Every carried ore unit and every empty capacity slot stays visible in the scrollable tray.",
        },
      ],
    },
    {
      version: "0.1.64",
      date: "2026-06-19",
      title: "Feedback window",
      intro:
        "Settings now has feedback, and ladder gravity asks for a quick reaction.",
      changes: [
        {
          build,
          text: "Settings now opens a Feedback window with common categories, a comment box, and an optional email field.",
        },
        {
          build,
          text: "When mining support makes ladders fall, a mechanic-specific prompt appears after the fall animation settles.",
        },
        {
          build,
          text: "Submitted feedback saves to player_feedback with the active player id, context, contact email, and a reviewed flag for later CLI review.",
        },
      ],
    },
    {
      version: "0.1.63",
      date: "2026-06-19",
      title: "Native release alerts",
      intro:
        "New releases now send native OS alerts automatically after deployment.",
      changes: [
        {
          build,
          text: "The version check now claims each release notice id, recovers stale in-flight claims, and sends the one-line release summary to enabled Web Push subscriptions.",
        },
        {
          build,
          text: "Android launchers and installed iPhone or iPad Home Screen apps use the same service worker notification path.",
        },
        {
          build,
          text: "The Vercel setup helper rotates notification secrets, and the manual admin dispatch route remains available as an operations fallback.",
        },
      ],
    },
    {
      version: "0.1.62",
      date: "2026-06-19",
      title: "Refresh availability guard",
      intro: "Refresh prompts now wait until the new mine page is ready.",
      changes: [
        {
          build,
          text: "The mine now checks a cache-busted page document before showing the New version available prompt.",
        },
        {
          build,
          text: "Players only see the Refresh button once the version returned by /api/version matches the page they would load.",
        },
        {
          build,
          text: "The Refresh button navigates to a fresh page URL without touching the release-note dismissal state.",
        },
      ],
    },
    {
      version: "0.1.61",
      date: "2026-06-19",
      title: "Ladder gravity",
      intro:
        "Placed ladders now fall when their bottom support is mined away or salvaged.",
      changes: [
        {
          build,
          text: "A ladder hanging over an empty shaft now slides down until it lands on solid ground or another ladder.",
        },
        {
          build,
          text: "Stacked ladders settle bottom-up from the changed support, so whole vertical chains move together without scanning the full mine.",
        },
        {
          build,
          text: "Fallen ladders kick up a small wood-chip trail and landing dust so the change reads in motion.",
        },
      ],
    },
    {
      version: "0.1.60",
      date: "2026-06-19",
      title: "Dismissible windows",
      intro:
        "Mine alert windows now close from outside taps, Escape, and gamepad back.",
      changes: [
        {
          build,
          text: "Release notes, falling-rock warnings, Home Screen prompts, save slots, stamp book, and bag windows now share outside-tap dismissal.",
        },
        {
          build,
          text: "Escape and gamepad cancel/back now dismiss alert windows, including the bunker claim panel.",
        },
        {
          build,
          text: "The bunker builder can collapse back to a compact Bunker button so the mine view is easy to recover.",
        },
      ],
    },
    {
      version: "0.1.59",
      date: "2026-06-19",
      title: "Bunker claim HUD",
      intro: "The bunker claim button now stays clear of the lower mine HUD.",
      changes: [
        {
          build,
          text: "Underground players without a bunker now see the compact Bunker claim button higher on the left side of the mine.",
        },
        {
          build,
          text: "The button no longer crowds the lower action controls, while the explicit claim-mode flow stays unchanged.",
        },
        {
          build,
          text: "The bunker claim smoke test now measures the button position before opening the builder panel.",
        },
      ],
    },
    {
      version: "0.1.58",
      date: "2026-06-19",
      title: "Dropped bag gravity",
      intro: "Recoverable bags now fall when their support is removed.",
      changes: [
        {
          build,
          text: "A dropped bag resting above a mined-out cell now falls to the next stable cell instead of hanging in midair.",
        },
        {
          build,
          text: "Picking up a ladder or plank that was holding a bag also lets the bag drop through the opened shaft.",
        },
        {
          build,
          text: "The lost-cargo locator follows the bag to its new resting cell so recovery still points to the right place.",
        },
      ],
    },
    {
      version: "0.1.57",
      date: "2026-06-19",
      title: "Bag grid",
      intro: "The mine HUD now keeps one simple bag capacity chip.",
      changes: [
        {
          build,
          text: "The HUD shows one bag chip with current ore count and capacity instead of a separate contents chip.",
        },
        {
          build,
          text: "Tapping the bag opens a scrollable cell grid for upgraded bags, where capacity is shown as slots and each carried ore chunk fills one cell.",
        },
        {
          build,
          text: "Tap outside the bag, press Escape, or use gamepad cancel/back to return to mining.",
        },
      ],
    },
    {
      version: "0.1.56",
      date: "2026-06-19",
      title: "Version refresh prompt",
      intro:
        "VibeBots now offers a refresh button when a newer build is deployed.",
      changes: [
        {
          build,
          text: "The mine checks the deployed app version after the page has been open and keeps checking once per minute.",
        },
        {
          build,
          text: "When the server reports a newer build, a compact prompt appears above the game with a Refresh button.",
        },
        {
          build,
          text: "The check uses the same app release version that powers release notes and update alerts.",
        },
      ],
    },
    {
      version: "0.1.55",
      date: "2026-06-19",
      title: "Mine metal floor",
      intro: "Row 1000 is now the hard bottom of the mine.",
      changes: [
        {
          build,
          text: "Every cell on row 1000 now generates as impenetrable metal across the full mine width.",
        },
        {
          build,
          text: "The miner cannot dig, blast, step, fall, warp, or ride an elevator through the metal floor.",
        },
        {
          build,
          text: "Older saved world diffs cannot overwrite the metal row, and server replay now rejects old mine-version trips.",
        },
      ],
    },
    {
      version: "0.1.54",
      date: "2026-06-19",
      title: "Death bag recovery",
      intro:
        "Empty-battery deaths now leave a visible bag where the miner fell.",
      changes: [
        {
          build,
          text: "A collapse or abandoned dig with cargo now drops a recoverable bag into the persistent mine world.",
        },
        {
          build,
          text: "Walking over the bag on the next descent restores its carried resources, support scrap, and parts.",
        },
        {
          build,
          text: "Falling-rock deaths attach the bag to the fallen rock's rest cell so the pouch stays visible on top of the rubble.",
        },
        {
          build,
          text: "Dropped bags render as pouch markers in the mine scene and clear the locator once recovered.",
        },
      ],
    },
    {
      version: "0.1.53",
      date: "2026-06-19",
      title: "Mine balance pass",
      intro:
        "Depth rewards and upgrade prices now scale cleanly toward row 1,000.",
      changes: [
        {
          build,
          text: "Ore reserves now grow in authored depth steps through row 1,000, keeping deep finds valuable without runaway cell payouts.",
        },
        {
          build,
          text: "Upgrade prices were retuned so early gear is reachable, mid-depth gear takes focused runs, and late transport remains a finite goal.",
        },
        {
          build,
          text: "Elevator rail pricing now stays bounded through the row 1,000 target instead of exploding past practical play.",
        },
      ],
    },
    {
      version: "0.1.52",
      date: "2026-06-19",
      title: "Safari notification setup",
      intro:
        "Mobile Safari players now get a Home Screen reminder before enabling notifications.",
      changes: [
        {
          build,
          text: "Mobile Safari now shows a Home Screen reminder for notifications when VibeBots is opened outside the installed app.",
        },
        {
          build,
          text: "Players can tap Ok to dismiss the reminder for the current page session or Never show again to keep it hidden.",
        },
        {
          build,
          text: "Safari cannot open the install sheet from page JavaScript, so the alert gives manual Share to Add to Home Screen guidance and the install metadata now includes PNG app icons.",
        },
      ],
    },
    {
      version: "0.1.51",
      date: "2026-06-19",
      title: "Update alerts",
      intro:
        "Players can opt into native browser alerts for one-line version summaries.",
      changes: [
        {
          build,
          text: "The Settings menu now has an update-alerts opt-in that uses the browser's native notification prompt from a tap.",
        },
        {
          build,
          text: "Android Chrome can subscribe from the browser, while iPhone and iPad players are guided to install the Home Screen web app first.",
        },
        {
          build,
          text: "A server dispatch route can send each new release summary once to every enabled Web Push subscription.",
        },
      ],
    },
    {
      version: "0.1.50",
      date: "2026-06-19",
      title: "Falling rock alert",
      intro:
        "The mine now teaches the falling-rock danger at the moment it starts.",
      changes: [
        {
          build,
          text: "A warning dialog appears when an action first starts a falling-rock countdown.",
        },
        {
          build,
          text: "The warning explains that the miner must avoid being under the rock in the next 2 turns.",
        },
        {
          build,
          text: "Ok dismisses the current warning, while Never Show Again stores the browser preference and hides future falling-rock alerts.",
        },
      ],
    },
    {
      version: "0.1.49",
      date: "2026-06-19",
      title: "Mine tip wrap",
      intro: "Long mine tips now stay inside narrow phone screens.",
      changes: [
        {
          build,
          text: "Surface tips now wrap inside the mine HUD instead of clipping off the right edge on phone-width screens.",
        },
        {
          build,
          text: "Other HUD chips keep their compact single-line layout.",
        },
        {
          build,
          text: "Tip copy and mine rules are unchanged.",
        },
      ],
    },
    {
      version: "0.1.48",
      date: "2026-06-18",
      title: "Starter base parts",
      intro:
        "Bunker claims now stay visual, while new claims get a real starter build kit.",
      changes: [
        {
          build,
          text: "Claiming a bunker no longer presents the 7x5 claim as placed base boxes. The claim is a non-colliding outline.",
        },
        {
          build,
          text: "New claims now start with 2 walls, 3 floors, 3 roofs, and 1 door so players can build a small 3x1 starter base. Older starter inventories receive missing floor and roof rows once.",
        },
        {
          build,
          text: "The Hardware Store and bunker builder now name the actual Wall, Floor, Roof, Door, Floor Spikes, and Basic Turret parts.",
        },
      ],
    },
    {
      version: "0.1.47",
      date: "2026-06-18",
      title: "Bunker claim alignment",
      intro:
        "Bunker claims now place the miner on the bottom-center cell of the new base.",
      changes: [
        {
          build,
          text: "The 7x5 claim preview now aligns from the miner's current cell instead of centering around the miner.",
        },
        {
          build,
          text: "When the claim is placed, the miner's cell is the bottom row halfway between the left and right sides.",
        },
        {
          build,
          text: "The server uses the same footprint helper as the preview, so claim validation and saved bunker placement now match the visible overlay.",
        },
      ],
    },
    {
      version: "0.1.46",
      date: "2026-06-18",
      title: "Clanker pathing",
      intro:
        "Bunker raids now spawn and move Clankers more cleanly around the base.",
      changes: [
        {
          build,
          text: "Clankers now spawn on an open approach cell above the bunker instead of inside dirt, ore, or part-cache cells.",
        },
        {
          build,
          text: "Raid planning now reads the saved mine world, prefers existing open cells, and only chews through dirt or ore when that route is better.",
        },
        {
          build,
          text: "Clankers spread their targets and animate along their planned paths so they do not all stack in the same cell.",
        },
      ],
    },
    {
      version: "0.1.45",
      date: "2026-06-18",
      title: "Hardware Store",
      intro: "The Hardware Store now sells the first bunker stock.",
      changes: [
        {
          build,
          text: "The Hardware Store sells Panel, Door, Floor Spikes, and the level 2 Basic Turret.",
        },
        {
          build,
          text: "Supply Depot is focused back on mine consumables: dynamite, recall rope, ladders, planks, and warp beacons.",
        },
        {
          build,
          text: "Basic Turrets cost 160 vibes, cap at one owned or deployed, and break after 5 surviving-Clanker hits. Floor Spikes cap at 4 total at level 1 and 6 total from level 2.",
        },
      ],
    },
    {
      version: "0.1.44",
      date: "2026-06-18",
      title: "Player level two",
      intro:
        "Surviving bunker defenses now advances player level progress up to Level 2.",
      changes: [
        {
          build,
          text: "The bunker HUD shows player level, defense XP progress, and the current beacon cap.",
        },
        {
          build,
          text: "Surviving enough Clanker raids reaches Level 2 and raises the owned beacon cap from 2 to 3.",
        },
        {
          build,
          text: "Battle results now report defense XP gained, level-up rewards, vibes, and the first-defense stamp.",
        },
      ],
    },
    {
      version: "0.1.43",
      date: "2026-06-18",
      title: "Blast Charge prices",
      intro:
        "Blast Charge unlocks are now priced for the current mining economy.",
      changes: [
        {
          build,
          text: "The three Blast Charge unlocks now cost 300, 1000, and 4000 vibes.",
        },
        {
          build,
          text: "Tier 2 and tier 3 dynamite are now reachable goals instead of placeholder-priced upgrades.",
        },
        {
          build,
          text: "The lamp-radius tier remains a late premium purchase, and mine tips now point players to Blast Charge for stronger dynamite.",
        },
      ],
    },
    {
      version: "0.1.42",
      date: "2026-06-18",
      title: "Explicit bunker claim",
      intro:
        "Bunker claiming now starts only when the player chooses the claim tool underground.",
      changes: [
        {
          build,
          text: "Going underground no longer opens the full bunker claim panel automatically.",
        },
        {
          build,
          text: "A compact Bunker claim HUD button starts the claim preview when the player is ready.",
        },
        {
          build,
          text: "Claim mode now has a Cancel claim action that hides the preview without changing the mine.",
        },
      ],
    },
    {
      version: "0.1.41",
      date: "2026-06-18",
      title: "Beacon names",
      intro:
        "Warp beacons now have a clear two-anchor cap and custom short names in the Warp Pad.",
      changes: [
        {
          build,
          text: "Beacon ownership is capped at two total beacons, counting both packed kits and planted anchors.",
        },
        {
          build,
          text: "Each deployed beacon row in the Warp Pad can be renamed with short custom text.",
        },
        {
          build,
          text: "Saved beacon names replay with the mine action log, and capped buyers are reminded they can collect deployed beacons for scrap.",
        },
      ],
    },
    {
      version: "0.1.40",
      date: "2026-06-18",
      title: "Save slot deletion",
      intro:
        "The Load game menu can now permanently delete an existing save slot.",
      changes: [
        {
          build,
          text: "Each existing save slot now has a separate Delete button beside Load.",
        },
        {
          build,
          text: "Deleting a save requires a second confirmation after a red destructive-action warning.",
        },
        {
          build,
          text: "A deleted slot clears its local trip checkpoint and removes that slot's mine, upgrades, stamps, purchases, parts, bots, bunker, wallet, and checkpoint data so it starts fresh next time.",
        },
      ],
    },
    {
      version: "0.1.39",
      date: "2026-06-18",
      title: "Bunker vertical slice",
      intro:
        "The mine now has the first bunker claim, building, and Clanker defense loop.",
      changes: [
        {
          build,
          text: "Clear and bank an underground room, then stake a 7x5 bunker footprint from the in-mine builder panel.",
        },
        {
          build,
          text: "Buy wall and door panels at the Supply Depot, place or remove them one cell at a time, and see the bunker overlay in the mine.",
        },
        {
          build,
          text: "Trigger a tier-one Clanker raid, let the server resolve the 180 second defense, then claim vibes and defense XP if the layout survives.",
        },
      ],
    },
    {
      version: "0.1.38",
      date: "2026-06-18",
      title: "Resource sale copy",
      intro:
        "The mine now treats the bag as resources and vibes as currency everywhere in the cash-out flow.",
      changes: [
        {
          build,
          text: "The HUD bag chip now lists carried resources such as Coal x2 instead of showing the bag as vibes while underground.",
        },
        {
          build,
          text: "Surface cash-out text now says which resources were sold and how many vibes they paid in total.",
        },
        {
          build,
          text: "Failure and salvage feedback now distinguishes resources, scrap, parts, and wallet vibes more clearly.",
        },
      ],
    },
    {
      version: "0.1.37",
      date: "2026-06-18",
      title: "Multi-beacon warp",
      intro:
        "Warp beacons now work as multiple placed anchors instead of one movable target.",
      changes: [
        {
          build,
          text: "Place multiple beacon kits underground and pick the destination from a newest-first Warp Pad list.",
        },
        {
          build,
          text: "Out-of-range beacons stay visible in the list but cannot be selected until Warpcoil range catches up.",
        },
        {
          build,
          text: "Edit pickup mode can now salvage placed beacons for carried vibe value, removing them from the warp list.",
        },
      ],
    },
    {
      version: "0.1.36",
      date: "2026-06-18",
      title: "Mine surface tips",
      intro:
        "The mine surface now shows varied one-line gameplay tips instead of repeating the same ladder reminder.",
      changes: [
        {
          build,
          text: "The surface HUD now picks from a small gameplay-tip set when the mine panel opens.",
        },
        {
          build,
          text: "Tips cover partial ore reserves, ladder recovery, dynamite harvesting, falling-rock timing, Buyer appraisal, and upgrade timing.",
        },
        {
          build,
          text: "The old ladder reminder remains in the rotation, so zero-ladder runs still point at Recall, Abandon, and the Supply Depot.",
        },
      ],
    },
    {
      version: "0.1.35",
      date: "2026-06-18",
      title: "Mine cash-out diagnostics",
      intro:
        "Cash-out failures now produce structured traces before they become hard-to-debug sell errors.",
      changes: [
        {
          build,
          text: "Invalid JSON and request-shape failures now log safe request summaries with mine version, move count, gear levels, and consumable counts.",
        },
        {
          build,
          text: "Version, ownership, replay, and persistence failures include hashed player context whenever an existing player cookie is present, and stale mine trips now ask players to reload.",
        },
        {
          build,
          text: "Successful sells now write info-grade cash-out traces with credited value, charged consumables, and remaining stock.",
        },
      ],
    },
    {
      version: "0.1.34",
      date: "2026-06-18",
      title: "Support selection outlines",
      intro:
        "Support salvage selections now show clear red outlines around the selected cells.",
      changes: [
        {
          build,
          text: "Selected ladder and plank cells now get a bright red full-cell outline in salvage mode.",
        },
        {
          build,
          text: "The whole eligible cell is now tappable, so selecting thin ladder and plank meshes is less fragile.",
        },
        {
          build,
          text: "The support itself still brightens as secondary feedback, but the cell outline is the main multi-select signal.",
        },
      ],
    },
    {
      version: "0.1.33",
      date: "2026-06-18",
      title: "Save slots",
      intro:
        "The mine pause menu now lets this device keep three separate saves.",
      changes: [
        {
          build,
          text: "Open settings from the mine and choose Load game to switch between three save slots.",
        },
        {
          build,
          text: "Existing progress moves into Slot 1 automatically, while new slots start as brand new saves.",
        },
        {
          build,
          text: "Each slot keeps its own mine, upgrades, stamps, purchases, parts, saved bots, and in-flight trip checkpoint.",
        },
      ],
    },
    {
      version: "0.1.32",
      date: "2026-06-18",
      title: "Partial ore mining",
      intro:
        "Ore deposits now pay small resource units on every hit and take longer to fully clear.",
      changes: [
        {
          build,
          text: "Every ore strike now adds a small amount of that resource immediately instead of waiting for the final break swing.",
        },
        {
          build,
          text: "Rich deposits such as diamond and core crystal hold larger reserves, so they take many hits before the cell clears.",
        },
        {
          build,
          text: "Dynamite now harvests part of rich ore deposits instead of deleting a high-value cell in one blast.",
        },
      ],
    },
    {
      version: "0.1.31",
      date: "2026-06-18",
      title: "Mine drop markers",
      intro:
        "Dropped cargo piles now avoid the in-scene text path that could render as white cards on mobile.",
      changes: [
        {
          build,
          text: "Ore pile counts now render as small 3D markers instead of font glyphs inside the mine canvas.",
        },
        {
          build,
          text: "The mine scene no longer imports the drei text renderer for dropped cargo, matching the earlier edit-mode artifact fix.",
        },
        {
          build,
          text: "A deep saved-trip smoke test covers the planted beacon plus dropped ore pile case from the report.",
        },
      ],
    },
    {
      version: "0.1.30",
      date: "2026-06-18",
      title: "Large support cash-out",
      intro:
        "Long-running miners with very large ladder or plank stock can sell normally again.",
      changes: [
        {
          build,
          text: "Cash-out now accepts legitimate high owned consumable counts from long-running accounts instead of rejecting them at request validation.",
        },
        {
          build,
          text: "Server-owned inventory remains authoritative for replay, so fake paid consumable claims still fail before payout.",
        },
        {
          build,
          text: "This targets large saved ladder and plank stock from long-running mines without changing replay rules or payout math.",
        },
      ],
    },
    {
      version: "0.1.29",
      date: "2026-06-18",
      title: "Dynamite tiers",
      intro:
        "Dynamite is now selected from four blast shapes with a live mine-cell preview before deployment.",
      changes: [
        {
          build,
          text: "The dynamite HUD opens a tier selector, previews the cells that would be destroyed, and deploys only after the check button is pressed.",
        },
        {
          build,
          text: "Locked tiers remain visible in the selector with helper text pointing to the Upgrades stall.",
        },
        {
          build,
          text: "Blast Charge is now a one-time unlock ladder for stronger dynamite tiers, with old radius-upgrade purchases reset.",
        },
      ],
    },
    {
      version: "0.1.28",
      date: "2026-06-18",
      title: "Mining stamp book",
      intro:
        "Depth progress now fills a cosmetic Stamp Book instead of paying extra vibes.",
      changes: [
        {
          build,
          text: "Depth bonuses no longer add surprise vibes at cash-out, keeping the mine economy tied to the loot you actually carry home.",
        },
        {
          build,
          text: "The pause menu now opens a Stamp Book with every mining achievement visible, including locked stamps and progress.",
        },
        {
          build,
          text: "Existing records can fill stamps where the game already knows the history, such as deepest depth, gear levels, and elevator rail progress.",
        },
      ],
    },
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
