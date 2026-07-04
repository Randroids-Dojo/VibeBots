import type { AppReleaseNote } from "./app-release-types";

export const RELEASE_NOTICE_ID = "2026-07-03-0.1.178-workshop-carousel";

export function releaseNotes(build: number | null): AppReleaseNote[] {
  return [
    {
      version: "0.1.178",
      date: "2026-07-03",
      title: "One part in hand",
      intro: "Picking a part feels like holding it now.",
      changes: [
        {
          build,
          text: "The Build tab shows one real part at a time on a slow spin, so you can look it over instead of scanning a long list.",
        },
        {
          build,
          text: "Step through parts with the arrows to find the one you want; the part in your hand shows its stats and how many you own.",
        },
        {
          build,
          text: "MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.177",
      date: "2026-07-03",
      title: "Workshop feel",
      intro: "The build bench feels alive now.",
      changes: [
        {
          build,
          text: "Parts pop into place when you add them and give a satisfying bump when they merge, so every edit lands with a snap.",
        },
        {
          build,
          text: "Placement ghosts gently glow so the open spots are easy to spot, and their tap targets are bigger for thumbs.",
        },
        {
          build,
          text: "MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.176",
      date: "2026-07-03",
      title: "Merge on the bench",
      intro: "Upgrade a part without leaving the build.",
      changes: [
        {
          build,
          text: "While you are placing a part, any matching part already on the bot glows gold: tap it to merge the two into a stronger one instead of adding another.",
        },
        {
          build,
          text: "The placement list offers the merge right beside the open spots, and it works even when the bot has no room left for a new part.",
        },
        {
          build,
          text: "MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.175",
      date: "2026-07-03",
      title: "Part inspector",
      intro: "Every part shows its stats now.",
      changes: [
        {
          build,
          text: "Selecting a part on the bench opens a compact inspector with its level pips, a durability bar, and Rotate, Merge, and Remove right there, so you act on the part you are looking at instead of hunting a menu.",
        },
        {
          build,
          text: "Merged parts wear glowing level pips on the bench, so a stronger part reads at a glance without opening anything.",
        },
        {
          build,
          text: "MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.174",
      date: "2026-07-03",
      title: "Tap to place parts",
      intro: "Building a bot is hands-on now.",
      changes: [
        {
          build,
          text: "Pick a part and the bot lights up every spot it can go; tap a glowing ghost, or a slot in the list, to drop it exactly there instead of letting the workshop choose the spot for you.",
        },
        {
          build,
          text: "The placement list names each open mount, so you always know where a part will land before you commit to it.",
        },
        {
          build,
          text: "MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.173",
      date: "2026-07-03",
      title: "Workshop tabs",
      intro: "The build bench is organized now.",
      changes: [
        {
          build,
          text: "The workshop's controls are sorted into Build, Tune, Garage, and Shop tabs, so you see one clear set of options at a time instead of a stack of panels.",
        },
        {
          build,
          text: "A slim header stays pinned above your bot with its name, whether it is arena-legal, Undo and Redo, and the buttons to test a fight, all in reach on every tab.",
        },
        {
          build,
          text: "The parts shop moved into its own tab inside the workshop instead of floating over the bench. MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.172",
      date: "2026-07-03",
      title: "Workshop glow-up",
      intro: "The build bench finally got the pit's lighting.",
      changes: [
        {
          build,
          text: "Your bot under construction now uses the arena's material language: weapons shine like polished steel, cores glow, and a studio light rig with cool and warm accents rakes the hull.",
        },
        {
          build,
          text: "On phones the part panels no longer bury the bench: the lists pin to the top and bottom with your bot always visible between them.",
        },
        {
          build,
          text: "Reflections and bloom join in where the hardware pays for them easily. MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.171",
      date: "2026-07-03",
      title: "Living atmosphere",
      intro: "The village follows your clock now.",
      changes: [
        {
          build,
          text: "Surface light follows your real time of day: warm gold at dawn and dusk, bright at noon, cool and moody after dark, always bright enough to play.",
        },
        {
          build,
          text: "The deep strata press the fog in closer the farther you descend, so the deep tunnels feel like deep tunnels.",
        },
        {
          build,
          text: "Lamp-lit dust drifts through the air instead of just spinning in place. All presentation: MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.170",
      date: "2026-07-03",
      title: "Mine glow",
      intro: "Everything that glows finally casts its light.",
      changes: [
        {
          build,
          text: "A new post-processing stack makes glowing things bloom: the headlamp halos in the dark, magma smolders, gas membranes pulse, and crystal light spills onto the rock around it.",
        },
        {
          build,
          text: "A soft vignette grades the frame edges down so the lamp-lit center of the tunnel holds your eye.",
        },
        {
          build,
          text: "Runs only where the hardware pays for it easily; phones and battery-saver mode keep their exact current cost. MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.169",
      date: "2026-07-03",
      title: "Shinier treasure",
      intro: "Ore crystals catch the light like real gems now.",
      changes: [
        {
          build,
          text: "Crystals are smooth-shaded and answer the studio lighting like curved glass, while metal and rock pick up stronger reflections against soil that stays matte.",
        },
        {
          build,
          text: "The reflectivity pass is tuned per material, so treasure pops out of the tunnel wall instead of blending into it.",
        },
        {
          build,
          text: "Phones and battery-saver mode keep their exact current cost: the response pass only runs where the hardware pays for it easily. MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.168",
      date: "2026-07-03",
      title: "Crush tumble",
      intro: "Getting crushed finally looks like it hurts.",
      changes: [
        {
          build,
          text: "A falling block now sends the miner into a physical tumble: the hit launches the bot, it bounces and spins out its energy, and the wreck settles right where the report finds it.",
        },
        {
          build,
          text: "Every crush plays a little differently, seeded by where it happened, and the Holodeck's Crush clip loops the new tumble for a closer look.",
        },
        {
          build,
          text: "Pure presentation: the sim, your odds, and your loot math are untouched. MINE_VERSION stays at 50; SIM_VERSION is unchanged.",
        },
      ],
    },
    {
      version: "0.1.167",
      date: "2026-07-03",
      title: "Gas leaks",
      intro: "Cave-ins can uncork gas pockets now.",
      changes: [
        {
          build,
          text: "A falling block that opens a path past a gas pocket uncorks it: the pocket leaks glowing wisps into your tunnel, one cell per move, until its pressure is spent.",
        },
        {
          build,
          text: "Wisps are survivable: push through one for a little battery, vent the whole leak with a single dig, or wall it off, since gas never crosses ladders, planks, or beacons.",
        },
        {
          build,
          text: "Leaked wisps thin out on their own after a while, and falling rocks smash straight through them. MINE_VERSION bumps to 50; SIM_VERSION is unchanged.",
        },
      ],
    },
    {
      version: "0.1.166",
      date: "2026-07-03",
      title: "Tunnel collapses",
      intro: "Wide tunnels shake their roof loose now.",
      changes: [
        {
          build,
          text: "Carve an unpropped tunnel five cells wide and the whole ceiling starts to shake: dirt and ore fall too, not just rock, on a slower countdown that gives you time to react.",
        },
        {
          build,
          text: "Planks now place on solid ground as roof props: one plank splits the span, steadies the cell above it, and calms a shaking roof before it drops.",
        },
        {
          build,
          text: "Teetering blocks visibly tremble again: a rendering regression had silenced the escalating shake that warns of a fall. MINE_VERSION bumps to 49; SIM_VERSION is unchanged.",
        },
      ],
    },
    {
      version: "0.1.165",
      date: "2026-07-03",
      title: "Rival fights",
      intro: "Your bot can fight other players' bots.",
      changes: [
        {
          build,
          text: "A Fight a rival button in the workshop pulls another player's saved design into the pit; verified results count on your record and toward stamps.",
        },
        {
          build,
          text: "Rival fights run under the same deterministic rules as everything else, so the server's verdict is the one that counts.",
        },
        {
          build,
          text: "No rivals saved yet? The stock bots keep the pit warm. MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.164",
      date: "2026-07-03",
      title: "Fight records",
      intro: "Verified wins go on the books.",
      changes: [
        {
          build,
          text: "Every server-verified workshop fight is recorded, and your win-loss record shows up right after verification.",
        },
        {
          build,
          text: "Three battle stamps join the Stamp Book: First Blood, Pit Veteran, and Buzzkill for winning with a saw blade mounted.",
        },
        {
          build,
          text: "Records only count verified fights; exhibitions stay casual. MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.163",
      date: "2026-07-03",
      title: "Bot temperament",
      intro: "Your bot fights its own way now.",
      changes: [
        {
          build,
          text: "Three temperament sliders in the workshop shape how your bot fights on its own: aggression, flanking, and patience.",
        },
        {
          build,
          text: "The stock fighters got personalities to match their builds: the Bulldozer shoves relentlessly while the Whirligig darts wide to bring its saw in.",
        },
        {
          build,
          text: "Neutral sliders reproduce the classic fighting style exactly, so existing bots behave the same until you tune them. MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.162",
      date: "2026-07-03",
      title: "Saw blades",
      intro: "The first powered weapon spins into the arena.",
      changes: [
        {
          build,
          text: "The Spin Mount and Saw Blade arrive in the shop: bolt the mount to your bot's nose and its blade spins up on its own motor, shredding whatever it touches.",
        },
        {
          build,
          text: "A new stock fighter, the Whirligig, brings the saw to exhibition matches, which now rotate through four matchups.",
        },
        {
          build,
          text: "Powered axles are a new simulation capability, so SIM_VERSION steps to 4; older replays re-simulate under their original version. MINE_VERSION is unchanged.",
        },
      ],
    },
    {
      version: "0.1.161",
      date: "2026-07-03",
      title: "New parts shipment",
      intro: "Five new robot parts hit the workshop shop.",
      changes: [
        {
          build,
          text: "Plow Blade, Hammer Head, Armor Wedge, Roller Drum, and Mast Pole: wide pushers, top-heavy strikers, sacrificial armor, low tracked drums, and tall character masts.",
        },
        {
          build,
          text: "A new stock heavy, the Bulldozer, joins the arena, and exhibition matches now rotate through different matchups.",
        },
        {
          build,
          text: "Every new part fights under the same deterministic match rules. MINE_VERSION and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.160",
      date: "2026-07-03",
      title: "Arena fight night",
      intro: "Battles became a show worth watching.",
      changes: [
        {
          build,
          text: "Matches open with a countdown, the camera rides the action close, and every hit throws sparks, with big bursts when a part is destroyed.",
        },
        {
          build,
          text: "The arena became a lit stage: a concrete pit with barrier walls, a center ring, corner glow in each fighter's color, and real material surfaces on every part that scar as they take damage.",
        },
        {
          build,
          text: "Match rules and outcomes are unchanged, and so are MINE_VERSION and SIM_VERSION.",
        },
      ],
    },
    {
      version: "0.1.159",
      date: "2026-07-02",
      title: "Playtest polish",
      intro: "Three fixes straight from playtesting.",
      changes: [
        {
          build,
          text: "Getting crushed no longer squashes the miner into a pancake: the bot crumples with buckled knees and a dropped pick.",
        },
        {
          build,
          text: "The miner's feet now stand on the surface grass instead of sinking shin-deep into the first row of dirt.",
        },
        {
          build,
          text: "The Holodeck camera is yours on mobile: pinch to zoom, swipe to pan, double-tap to recenter. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.158",
      date: "2026-07-02",
      title: "Juicier breaks",
      intro: "Digging feedback got richer and faster.",
      changes: [
        {
          build,
          text: "Breaking an ore now showers sparkles in its color, with the rare glowing tiers lingering longest, and venting a gas pocket sends up a rising hiss of fumes.",
        },
        {
          build,
          text: "The particle engine was rebuilt to draw every burst in three batches instead of hundreds of separate pieces, so heavy digging stays smooth.",
        },
        {
          build,
          text: "Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.157",
      date: "2026-07-02",
      title: "The village dressed up",
      intro: "Surface shops got real materials and lived-in clutter.",
      changes: [
        {
          build,
          text: "Shop walls now read as quarried stone, sawn timber shows its wood grain, and metal trim catches the light.",
        },
        {
          build,
          text: "Crates, barrels, and grain sacks settle between the stalls, each cluster a little different.",
        },
        {
          build,
          text: "Same fast path on phones. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.156",
      date: "2026-07-02",
      title: "Gem-grade ores",
      intro: "Ore crystals now look worth digging for.",
      changes: [
        {
          build,
          text: "Every ore's crystals became glassy faceted clusters with lit edges: coal reads as dark chunks, copper as warm nuggets, and the rare glowing tiers now breathe with light.",
        },
        {
          build,
          text: "Richer clusters per block, still unique per cell, and phones keep their fast path.",
        },
        {
          build,
          text: "Mine rules, ore values, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.155",
      date: "2026-07-02",
      title: "Living blocks",
      intro: "The mine's blocks got real surfaces.",
      changes: [
        {
          build,
          text: "Dirt now shows soil grain and grit, rock carries crag striations with a cool sheen, bedrock metal is brushed steel, and gas pockets churn, all rendered per block with no two alike.",
        },
        {
          build,
          text: "The detail runs in the shader on capable devices and steps back to the classic flat look on phones, so nothing gets slower.",
        },
        {
          build,
          text: "A Holodeck Block Gallery lines up every block kind for a close look. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.154",
      date: "2026-07-02",
      title: "Real light in the mine",
      intro: "Shadows and studio lighting land on the surface.",
      changes: [
        {
          build,
          text: "The sun now casts soft real-time shadows across the surface village, and a studio environment gives every surface, metal, and crystal true ambient light and reflections.",
        },
        {
          build,
          text: "The lighting fades as you descend, so the deep mine keeps its lamp-lit darkness.",
        },
        {
          build,
          text: "A graphics quality tier keeps phones fast: the low tier skips the heavy passes automatically. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.153",
      date: "2026-07-02",
      title: "Miner glow-up",
      intro: "The mining robot got a full visual overhaul.",
      changes: [
        {
          build,
          text: "The miner was rebuilt: armored hull with rim lighting, an animated chest screen and breathing visor, a bright headlamp lens, a backpack battery with glowing charge bars, a blinking beacon, toe caps, and a second arm bracing the walk.",
        },
        {
          build,
          text: "The pick gained a twin-blade steel head, and every surface uses new materials that read in the dark on both the WebGPU and WebGL paths.",
        },
        {
          build,
          text: "The Holodeck Miner Showcase camera now dollies in close for inspection, and stratum banners always finish their fade on slow devices. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.152",
      date: "2026-07-02",
      title: "Miner Showcase",
      intro: "A Holodeck stage shows off the miner's moves.",
      changes: [
        {
          build,
          text: "The Holodeck gained a Miner Showcase scenario: the robot on an empty stage with an animation selector (idle, walk, dig, rebuff, crush) and a turntable to inspect it from every angle.",
        },
        {
          build,
          text: "The miner's animation now runs through one shared rig everywhere, so the Holodeck plays the exact moves you see in the mine.",
        },
        {
          build,
          text: "Mine rules, world generation, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.151",
      date: "2026-07-01",
      title: "Crash reports wait for the crash",
      intro: "Fatal falls and crushes finish on screen before the report.",
      changes: [
        {
          build,
          text: "The trip report after a fatal fall or falling-rock crush now waits for the visible impact instead of racing it on a timer, so slow devices no longer see the report before the crash lands.",
        },
        {
          build,
          text: "If the scene cannot render the impact at all, the report still arrives after a short safety delay.",
        },
        {
          build,
          text: "Mine rules, world generation, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.150",
      date: "2026-06-29",
      title: "Holodeck test scenes",
      intro: "A new Holodeck mode loads focused, looping mine test scenes.",
      changes: [
        {
          build,
          text: "A new Holodeck entry in the mine options menu loads small, controlled test scenes through a scenario selector.",
        },
        {
          build,
          text: "The first scenario auto-mines a single block on a deterministic loop, with live controls for pickaxe level and block type that reconfigure the scene without a reload.",
        },
        {
          build,
          text: "Holodeck runs in its own isolated session, so it never touches your live mine trip. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.149",
      date: "2026-06-29",
      title: "Route-aware ladders",
      intro: "The ladder warning now respects clear paths home.",
      changes: [
        {
          build,
          text: "The ladder chip now checks known clear routes to the surface, so it stops warning when a nearby ladder shaft already gets you home.",
        },
        {
          build,
          text: "If there is no known clear route home, the ladder chip says route blocked instead of showing a fake needed count.",
        },
        {
          build,
          text: "The route estimate is sparse and capped for mobile performance. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.148",
      date: "2026-06-29",
      title: "Visible raid XP pickups",
      intro: "Stale raid XP now has a bright pickup object.",
      changes: [
        {
          build,
          text: "Survived-raid XP pickups now render as larger bright objects with a cyan halo, gold rays, and a stronger green core.",
        },
        {
          build,
          text: "The stale-pickup smoke test now samples the mine canvas while collection is pending, so the XP here state must also have visible world pixels.",
        },
        {
          build,
          text: "The mine tip now says the XP arrow leads to the bright pickup. Mine rules, raid rewards, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.147",
      date: "2026-06-29",
      title: "Stratum banner fade",
      intro: "Mine stratum banners now fade away cleanly.",
      changes: [
        {
          build,
          text: "Entering Clay Beds and later stratum banners now fade out and clear themselves after they appear.",
        },
        {
          build,
          text: "Continuing to descend through the same stratum no longer cancels the banner timeout and leaves stale text on screen.",
        },
        {
          build,
          text: "Mine tips were reviewed and remain current. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.146",
      date: "2026-06-29",
      title: "Raid XP here marker",
      intro: "Stale raid XP now stays marked at the pickup.",
      changes: [
        {
          build,
          text: "When the miner reaches an old survived-raid XP drop, the HUD now switches from the direction arrow to an XP here marker instead of disappearing.",
        },
        {
          build,
          text: "The marker stays visible while pickup collection is still pending, so stale XP is not invisible at the destination.",
        },
        {
          build,
          text: "The mine tip now mentions the XP here state. Mine rules, raid rewards, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.145",
      date: "2026-06-28",
      title: "Raid XP recovery",
      intro: "Old raid XP drops now point the way back.",
      changes: [
        {
          build,
          text: "Survived bunker raids with uncollected XP now show a HUD locator pointing back to the nearest pickup, even after later mine deaths.",
        },
        {
          build,
          text: "The bunker builder stays usable after the raid combat is resolved, so you can adjust parts while the XP reward is still waiting.",
        },
        {
          build,
          text: "Finish raid still waits for the XP pickups. Live raids and failed raids still keep bunker editing locked.",
        },
      ],
    },
    {
      version: "0.1.144",
      date: "2026-06-28",
      title: "Raid XP pickup visibility",
      intro: "Raid XP pickups now match the visible overlap area.",
      changes: [
        {
          build,
          text: "Raid XP collection now accepts the visible overlap area around the pickup, so standing beside a marker that covers the miner still collects it.",
        },
        {
          build,
          text: "All explosion visuals now dissipate. Clanker self-destruct bursts fade out instead of permanently covering collectible XP markers.",
        },
        {
          build,
          text: "XP markers draw above raid effects while collectible, and regression coverage now keeps burst and explosion animations finite.",
        },
      ],
    },
    {
      version: "0.1.143",
      date: "2026-06-28",
      title: "Raid XP pickup retry",
      intro: "Raid XP pickups now retry while the miner stands on them.",
      changes: [
        {
          build,
          text: "Standing on a survived raid XP drop now retries collection if the first server response still leaves the pickup on the ground.",
        },
        {
          build,
          text: "The retry stays tied to the same pickup and miner cell, so moving away does not keep collecting old drops.",
        },
        {
          build,
          text: "This changes pickup reliability only. Mine rules, raid rewards, MINE_VERSION, and SIM_VERSION are unchanged.",
        },
      ],
    },
    {
      version: "0.1.142",
      date: "2026-06-28",
      title: "Crash recovery logging",
      intro:
        "App crashes now show a recovery screen and log bounded telemetry.",
      changes: [
        {
          build,
          text: "Crashes now show a VibeBots recovery screen with Try again, Reload, and Mine buttons instead of leaving iOS on a broken page.",
        },
        {
          build,
          text: "Client errors, global browser errors, and unhandled promise rejections now post bounded telemetry with hashed player identifiers.",
        },
        {
          build,
          text: "Legacy bunker raid rows now normalize missing fields on load, and release notes stay above the mine loader so the first-run dialog remains tappable.",
        },
      ],
    },
    {
      version: "0.1.141",
      date: "2026-06-27",
      title: "Release metadata cleanup",
      intro: "Release notes now live in a clearer owned module.",
      changes: [
        {
          build,
          text: "Release-note archive data now lives in its own typed module instead of sharing a file with release-version logic.",
        },
        {
          build,
          text: "getAppRelease remains the public release API for version routes, release popups, and Web Push summaries.",
        },
        {
          build,
          text: "This cleanup does not change player behavior, mine rules, save data, MINE_VERSION, or SIM_VERSION.",
        },
      ],
    },
    {
      version: "0.1.140",
      date: "2026-06-27",
      title: "Fall death camera",
      intro: "Fatal falls now stay visible until the landing impact.",
      changes: [
        {
          build,
          text: "Long fatal falls now keep the camera and miner moving all the way to the landing cell before the trip report appears.",
        },
        {
          build,
          text: "The death animation now waits for the full fall distance instead of clearing from a fixed short timeout.",
        },
        {
          build,
          text: "Held keyboard and touch movement now cancel on death, so respawning at the surface starts from a clean control state.",
        },
      ],
    },
    {
      version: "0.1.139",
      date: "2026-06-25",
      title: "Mine renderer cleanup",
      intro: "The mine renderer is split into clearer owned modules.",
      changes: [
        {
          build,
          text: "Mine render palettes, terrain colors, hash helpers, block meshes, particle spawning, support selection, bunker overlays, miner rig pieces, and surface buildings now live in focused component modules.",
        },
        {
          build,
          text: "The main mine canvas still owns the scene state machine, frame sampling, camera motion, miner motion, lighting, diagnostics, and event-to-effect bridge.",
        },
        {
          build,
          text: "This is a render-only ownership cleanup. Mine rules, replay behavior, save data, gameplay versions, and renderer dependencies are unchanged.",
        },
      ],
    },
    {
      version: "0.1.138",
      date: "2026-06-24",
      title: "Death playback cleanup",
      intro: "Mine death playback now has a clearer render bridge.",
      changes: [
        {
          build,
          text: "Fatal-fall and falling-rock-crush playback now live in a focused mine death playback helper instead of the main canvas scene.",
        },
        {
          build,
          text: "The helper owns terminal result mapping, the synchronous store subscription, the fallback clear timer, and the short fall window used for camera framing.",
        },
        {
          build,
          text: "The mine canvas stays focused on frame sampling, camera and miner transforms, particles, impact sounds, and diagnostics.",
        },
      ],
    },
    {
      version: "0.1.137",
      date: "2026-06-23",
      title: "Mine panel cleanup",
      intro: "The mine UI is split into clearer owned modules.",
      changes: [
        {
          build,
          text: "Release notes, bag, save slots, stamp book, feedback, settings prompts, stalls, and bunker controls now live in their own component files.",
        },
        {
          build,
          text: "MinePanel now stays focused on mine state, viewport, HUD, and action routing instead of owning every dialog and sheet.",
        },
        {
          build,
          text: "Smoke coverage now checks the moved release notes, settings, feedback, bag, save slot, bunker, and stall surfaces.",
        },
      ],
    },
    {
      version: "0.1.136",
      date: "2026-06-22",
      title: "Clanker chew and XP pickups",
      intro: "Clankers now chew blockers and drop readable XP.",
      changes: [
        {
          build,
          text: "Clankers that reach blocking base parts now spend their remaining battery chewing for repeated damage instead of exploding on contact.",
        },
        {
          build,
          text: "Raid XP now drops on a reachable approach cell unless the blocker is destroyed, so walking over the pickup collects it normally.",
        },
        {
          build,
          text: "XP pickups are now smaller green and gold markers with a blue ring so they read as XP instead of a large loose gem.",
        },
      ],
    },
    {
      version: "0.1.135",
      date: "2026-06-22",
      title: "Roof cell polish",
      intro: "Bunker roof cells now sit cleanly together.",
      changes: [
        {
          build,
          text: "Roof base parts now render as bounded gabled cells instead of loose triangular caps.",
        },
        {
          build,
          text: "Adjacent roof cells share a consistent eave, ridge, and shingle silhouette that lines up above walls and floors.",
        },
        {
          build,
          text: "Production-mode visual verification now checks a three-roof starter-base layout.",
        },
      ],
    },
    {
      version: "0.1.134",
      date: "2026-06-22",
      title: "Clanker visuals",
      intro: "Clankers now look like polished robotic creatures.",
      changes: [
        {
          build,
          text: "Raid attackers now render as low armored spider-bots with eight articulated legs, plated bodies, glowing sensors, and front cutters.",
        },
        {
          build,
          text: "The crawl animation now bobs the chassis, cycles each leg, sweeps the sensor head, and works along the existing raid path timing.",
        },
        {
          build,
          text: "Self-destructs now flash with a larger burst ring and metal fragments instead of a plain orange sphere.",
        },
      ],
    },
    {
      version: "0.1.133",
      date: "2026-06-22",
      title: "Clanker open paths",
      intro: "Clankers now prefer open bunker routes to the player cell.",
      changes: [
        {
          build,
          text: "If a bunker has an open path to the player cell, Clankers now follow that path instead of stopping to bite a nearby wall.",
        },
        {
          build,
          text: "Players need to fully enclose the player cell before starting the next raid if they want the walls to take the hit first.",
        },
        {
          build,
          text: "Failed raid messages now tip players that Clankers follow open bunker cells and that the player cell should be enclosed.",
        },
      ],
    },
    {
      version: "0.1.132",
      date: "2026-06-22",
      title: "Dirt break polish",
      intro: "Dirt blocks now crack and burst with more weight.",
      changes: [
        {
          build,
          text: "Dirt cracks now branch wider on every hit instead of using the old sparse marks.",
        },
        {
          build,
          text: "The final dirt hit throws chunky debris, slower dust, and a stronger thump so the break feels heavier.",
        },
        {
          build,
          text: "Focused smoke coverage now checks crack growth and the final dirt particle burst.",
        },
      ],
    },
    {
      version: "0.1.131",
      date: "2026-06-22",
      title: "Base part visuals",
      intro: "Bunker parts now look like their real building roles.",
      changes: [
        {
          build,
          text: "Floors draw as bottom plates, walls draw as center panels, and doors sit on the left or right edge of the claimed room.",
        },
        {
          build,
          text: "Floor Spikes now rise out of a bottom plate as several large upward spikes.",
        },
        {
          build,
          text: "Roofs draw as triangular caps with rafter beams, and Basic Turrets use a small mounted barrel instead of a generic block.",
        },
      ],
    },
    {
      version: "0.1.130",
      date: "2026-06-22",
      title: "Raid XP pickups",
      intro: "Raid XP now comes from walking over the dropped pickups.",
      changes: [
        {
          build,
          text: "Dead Clankers drop defense XP pickups that the miner must physically walk over before the XP can be claimed.",
        },
        {
          build,
          text: "The first survived raid now drops enough defense XP to reach Level 2 after every pickup is collected.",
        },
        {
          build,
          text: "If a Clanker reaches the player cell, it self-destructs, kills the miner, ends the raid, and clears every XP pickup before collection.",
        },
      ],
    },
    {
      version: "0.1.129",
      date: "2026-06-21",
      title: "Clanker raid damage",
      intro: "Bunker raids now end when every Clanker is dead.",
      changes: [
        {
          build,
          text: "Clankers now spend battery on their route, bite reachable base parts or the core, and stop as soon as they die.",
        },
        {
          build,
          text: "Clankers that fail to reach the player cell self-destruct in the mine view, and dead Clankers leave defense XP pickups.",
        },
        {
          build,
          text: "The bunker raid button now collects the dropped raid XP instead of waiting on the old fixed timer.",
        },
      ],
    },
    {
      version: "0.1.128",
      date: "2026-06-21",
      title: "Lantern zoom overview fix",
      intro: "Zoomed-out mine views stay readable instead of going darker.",
      changes: [
        {
          build,
          text: "The mine no longer draws edge falloff while zoom-out is still available.",
        },
        {
          build,
          text: "A short dark falloff appears only at the lantern's zoom-out cap, when the camera reaches the edge of unlocked visibility.",
        },
        {
          build,
          text: "The lantern light radius, zoom caps, mine replay rules, and sim versions are unchanged.",
        },
      ],
    },
    {
      version: "0.1.127",
      date: "2026-06-21",
      title: "Bunker builder controls",
      intro: "Base building is compact and walkable.",
      changes: [
        {
          build,
          text: "The bunker builder now docks low on phone screens so the claimed base stays visible while editing.",
        },
        {
          build,
          text: "Place, Remove, and Move live in a labeled mode group, separate from the base-part inventory buttons.",
        },
        {
          build,
          text: "Remove mode now owns placed-part taps, returns undamaged parts to inventory, and the builder includes walk buttons for moving while it stays open.",
        },
      ],
    },
    {
      version: "0.1.126",
      date: "2026-06-21",
      title: "Scrap selection cleanup",
      intro: "Scrap mode no longer leaves bunker selection squares behind.",
      changes: [
        {
          build,
          text: "Opening Scrap now closes bunker claim and builder overlays so their grid cannot stay stuck over the mine.",
        },
        {
          build,
          text: "Bunker claim previews are hidden while Scrap mode is active, keeping support removal focused on supports only.",
        },
        {
          build,
          text: "Phone smoke coverage now opens bunker claim first, scraps supports, and proves the red selection pixels clear.",
        },
      ],
    },
    {
      version: "0.1.125",
      date: "2026-06-21",
      title: "Terminal replay movement fix",
      intro: "Saved fall replays no longer block swipe movement.",
      changes: [
        {
          build,
          text: "Saved trips that replay into a fatal fall now settle at Base 0 without leaving a collapsed result active.",
        },
        {
          build,
          text: "Swipe movement stays enabled after dismissing the release list, even for installed saves that just consumed an old terminal replay.",
        },
        {
          build,
          text: "Store coverage now proves the replayed save can move immediately after loading.",
        },
      ],
    },
    {
      version: "0.1.124",
      date: "2026-06-21",
      title: "Mine terminal state fix",
      intro: "Mine death and bunker UI now settle cleanly after reloads.",
      changes: [
        {
          build,
          text: "Saved trips that replay into a fatal fall now restore the death result once, mark it consumed, and stop replaying the same fall forever.",
        },
        {
          build,
          text: "Bunker builder UI now starts closed, closes on surface or death, and never leaves the claim grid over fatal fall playback.",
        },
        {
          build,
          text: "Jump only appears when the sim says a jump is available, and diagnostics now log terminal replay and bunker-overlay input blockers.",
        },
      ],
    },
    {
      version: "0.1.123",
      date: "2026-06-20",
      title: "Save touch diagnostics",
      intro: "Bunker saves no longer block movement drags at the surface.",
      changes: [
        {
          build,
          text: "Surface saves with an existing bunker now keep movement drags enabled unless the underground builder is actually active.",
        },
        {
          build,
          text: "A new mine diagnostics route logs bounded touch-layer state when movement should be available but the touch surface is missing or covered.",
        },
        {
          build,
          text: "Phone smoke coverage now recreates a surface bunker save and proves touch drags still move the miner.",
        },
      ],
    },
    {
      version: "0.1.122",
      date: "2026-06-20",
      title: "Touch drag layer",
      intro: "Movement drags now sit above the mine canvas again.",
      changes: [
        {
          build,
          text: "The movement touch surface now has an explicit stack position above the 3D canvas.",
        },
        {
          build,
          text: "HUD buttons keep their higher stack position, so Jump and consumable controls remain tappable.",
        },
        {
          build,
          text: "Smoke coverage now checks that open mine space targets movement while HUD buttons stay on top.",
        },
      ],
    },
    {
      version: "0.1.121",
      date: "2026-06-20",
      title: "Touch zoom lock",
      intro:
        "Touch input is locked back to mine controls instead of page zoom.",
      changes: [
        {
          build,
          text: "The app viewport now blocks browser page pinch zoom so the HUD cannot inflate over the mine.",
        },
        {
          build,
          text: "The mine shell catches document pinch gestures while preserving the bounded in-mine camera zoom.",
        },
        {
          build,
          text: "Smoke coverage now dispatches real touch events to prove touch drag movement still works on phone viewports.",
        },
      ],
    },
    {
      version: "0.1.120",
      date: "2026-06-20",
      title: "Underground bunker claims",
      intro: "Clear rooms can become bunkers before surfacing.",
      changes: [
        {
          build,
          text: "The bunker builder now checks the live underground cells, so a clear room can be claimed without first cashing out.",
        },
        {
          build,
          text: "The builder now uses compact Place, Remove, and Move modes, with canvas cell targeting and restored drag movement across the claimed space.",
        },
        {
          build,
          text: "Cash-out replays the mine at the claimed move, saves the bunker and cleared cells together, and unlocks raids after the claim is banked.",
        },
      ],
    },
    {
      version: "0.1.119",
      date: "2026-06-20",
      title: "Jump button placement",
      intro: "Jump now sits on the middle right and leaves movement clear.",
      changes: [
        {
          build,
          text: "The Jump button moved to the middle-right edge of the mine instead of the bottom controls.",
        },
        {
          build,
          text: "The bottom dig-control strip no longer catches pointer input in empty space, so drag movement stays clear.",
        },
        {
          build,
          text: "Smoke coverage now checks the larger Jump button placement, bottom-control non-overlap, and bottom-center hit target.",
        },
      ],
    },
    {
      version: "0.1.118",
      date: "2026-06-20",
      title: "Visual viewport refresh",
      intro:
        "Installed Android refreshes now anchor to the visible mine screen.",
      changes: [
        {
          build,
          text: "The mine shell now uses the visual viewport when available, so standalone Android refreshes do not anchor controls to a stale layout viewport.",
        },
        {
          build,
          text: "The Refresh button records the target version and reruns viewport alignment on refresh, focus, resume, and visual viewport changes.",
        },
        {
          build,
          text: "Smoke coverage now mocks an installed app visual viewport and checks Settings, zoom, and dig controls after refresh and resume.",
        },
      ],
    },
    {
      version: "0.1.117",
      date: "2026-06-20",
      title: "Jump Jets",
      intro: "A free hop now clears one-cell ledges without spending ladders.",
      changes: [
        {
          build,
          text: "Jump Jets lift the miner up one empty cell as a logged battery action without placing a ladder.",
        },
        {
          build,
          text: "The new Jump button is larger than the support and consumable controls, sits in the bottom traversal cluster, and shares the Space shortcut.",
        },
        {
          build,
          text: "Ladders still build reusable shafts, while Jump Jets only hold the miner until the next action.",
        },
      ],
    },
    {
      version: "0.1.116",
      date: "2026-06-20",
      title: "Shop release copy",
      intro: "Release notes now match the clean shop layout.",
      changes: [
        {
          build,
          text: "The latest shop note now describes the simpler rows without repeating the rejected framing.",
        },
        {
          build,
          text: "The 0.1.114 archive is kept as shop button feedback and points to the 0.1.115 cleanup.",
        },
        {
          build,
          text: "Release tests and smoke coverage now check the cleaner wording.",
        },
      ],
    },
    {
      version: "0.1.115",
      date: "2026-06-20",
      title: "Clean shop layout",
      intro: "Mine shops are easier to scan.",
      changes: [
        {
          build,
          text: "Supply Depot and Upgrades rows now use simple descriptions.",
        },
        {
          build,
          text: "Rows keep clear buy buttons without extra labels or projected-balance text.",
        },
        {
          build,
          text: "Upgrade purchases still keep the hold-to-buy confirmation and feedback.",
        },
      ],
    },
    {
      version: "0.1.114",
      date: "2026-06-20",
      title: "Shop button feedback",
      intro: "Shop purchases gained stronger button feedback.",
      changes: [
        {
          build,
          text: "Supply Depot and Upgrades briefly added row-planning details that were removed in 0.1.115.",
        },
        {
          build,
          text: "Upgrades added a hold-to-buy confirmation before buying.",
        },
        {
          build,
          text: "Shop buttons add stronger visual feedback plus supported mobile vibration for press, success, and deny moments.",
        },
      ],
    },
    {
      version: "0.1.113",
      date: "2026-06-20",
      title: "Scrap panel text bounds",
      intro: "Scrap mode text now stays inside the phone panel.",
      changes: [
        {
          build,
          text: "The Scrap mode header now wraps long status chips instead of letting them spill outside the panel.",
        },
        {
          build,
          text: "The selected scrap value stays readable on narrow phone screens.",
        },
        {
          build,
          text: "Focused smoke coverage now checks the panel and its children stay inside horizontal bounds.",
        },
      ],
    },
    {
      version: "0.1.112",
      date: "2026-06-20",
      title: "Scrap language",
      intro: "Placed support removal now uses scrap wording.",
      changes: [
        {
          build,
          text: "The placed-support removal button is now Scrap placed supports.",
        },
        {
          build,
          text: "The selection panel is now Scrap mode, with Scrap as the confirm action.",
        },
        {
          build,
          text: "Scrapping feedback now says Scrapped supports and keeps the same carried scrap value rules.",
        },
      ],
    },
    {
      version: "0.1.111",
      date: "2026-06-20",
      title: "Hardware Store copy",
      intro: "The Hardware Store sheet now stays focused on items.",
      changes: [
        {
          build,
          text: "The extra Hardware Store intro and footer helper paragraphs were removed.",
        },
        {
          build,
          text: "Buy buttons remain the source for prices, level locks, and stock limits.",
        },
        {
          build,
          text: "Item rows still describe each base part without repeating shop-wide rules.",
        },
      ],
    },
    {
      version: "0.1.110",
      date: "2026-06-20",
      title: "Mine death report",
      intro:
        "Crush reports now stay on the impact scene and use the right cause.",
      changes: [
        {
          build,
          text: "Falling-rock death reports now keep the underground impact cells visible through the report instead of flashing back to an empty reset frame.",
        },
        {
          build,
          text: "Near-miss copy now says where the rock fell instead of saying the robot battery died.",
        },
        {
          build,
          text: "Focused smoke coverage checks the report frame for populated cells, camera depth, and cause-specific copy.",
        },
      ],
    },
    {
      version: "0.1.109",
      date: "2026-06-20",
      title: "Mine refresh viewport lock",
      intro: "Refresh now keeps the whole mine page pinned in place.",
      changes: [
        {
          build,
          text: "The mine now locks the document and body scroll while mounted, so mobile refresh restoration cannot push HUD controls down.",
        },
        {
          build,
          text: "The new-version Refresh button resets scroll and replaces the current page with a cache-busted mine URL.",
        },
        {
          build,
          text: "Smoke coverage now checks the document lock plus Settings, zoom, and dig controls after the refresh path loads.",
        },
      ],
    },
    {
      version: "0.1.108",
      date: "2026-06-20",
      title: "Mine warning visuals",
      intro: "Low battery and ladder risk now stand out more clearly.",
      changes: [
        {
          build,
          text: "Low battery now adds a pulsing red edge warning around the mine screen.",
        },
        {
          build,
          text: "The battery chip throbs red and labels the charge as low when the climb home is risky.",
        },
        {
          build,
          text: "The ladder chip now pulses and shows how many ladders are needed when the current stock is short for the depth.",
        },
      ],
    },
    {
      version: "0.1.107",
      date: "2026-06-20",
      title: "Sheet drag dismiss",
      intro: "Bottom shop sheets now dismiss from a pull anywhere inside.",
      changes: [
        {
          build,
          text: "Dragging down from anywhere inside a stall sheet now moves the panel, not just the top handle.",
        },
        {
          build,
          text: "Releasing past the dismiss distance closes the Hardware Store, Supply Depot, Upgrades, Elevator, or Warp Pad sheet.",
        },
        {
          build,
          text: "Ordinary taps on shop buttons still work, and editable beacon names do not start a drag.",
        },
      ],
    },
    {
      version: "0.1.106",
      date: "2026-06-20",
      title: "Mine refresh layout",
      intro: "Refreshing into a new build keeps the mine screen locked.",
      changes: [
        {
          build,
          text: "The mine screen now uses a fixed app shell so browser scroll restoration cannot shift the canvas after Refresh.",
        },
        {
          build,
          text: "The shell turns scroll restoration off while the mine is mounted, keeping the HUD and bottom controls inside the visible viewport.",
        },
        {
          build,
          text: "Focused smoke clicks the new-version Refresh button and checks the loaded mine stays aligned to the viewport.",
        },
      ],
    },
    {
      version: "0.1.105",
      date: "2026-06-20",
      title: "Battle camera",
      intro: "Battle mode now keeps both bots in the shot.",
      changes: [
        {
          build,
          text: "The arena camera now follows the live midpoint between the bots instead of staying fixed.",
        },
        {
          build,
          text: "The camera backs up as bots spread apart, then eases closer as they clash.",
        },
        {
          build,
          text: "Smoke coverage now checks that both bots stay framed while the match moves.",
        },
      ],
    },
    {
      version: "0.1.104",
      date: "2026-06-20",
      title: "Mine input cadence",
      intro: "Holding movement now keeps pace with rapid taps.",
      changes: [
        {
          build,
          text: "Keyboard and thumbstick movement now share one cadence, so holding a direction is no slower than repeated taps or swipes.",
        },
        {
          build,
          text: "Rapid tap-release bursts wait for the same next legal action time as held input, closing the swipe-spam shortcut.",
        },
        {
          build,
          text: "The miner glide now fills more of each legal action interval, making movement look smoother without changing replay, save, or sim versions.",
        },
      ],
    },
    {
      version: "0.1.103",
      date: "2026-06-20",
      title: "Mine load fallback",
      intro: "Bad network loads now show the mine is trying to recover.",
      changes: [
        {
          build,
          text: "The mine now shows an animated cart-and-drill loader while world data or the canvas bundle is still loading.",
        },
        {
          build,
          text: "If the network drops before the world loads, a transparent message explains that the save was not changed.",
        },
        {
          build,
          text: "The retry button reloads the mine scene, and mine movement stays paused until the world is ready.",
        },
      ],
    },
    {
      version: "0.1.102",
      date: "2026-06-20",
      title: "Falling rock chains",
      intro: "Stacked falling rocks now drop as one column.",
      changes: [
        {
          build,
          text: "Mining the support under a vertical rock or boulder stack now starts the countdown on the whole chain.",
        },
        {
          build,
          text: "When the countdown ends, every warned block falls together instead of waiting for one rock per delay cycle.",
        },
        {
          build,
          text: "The mine gameplay version moved to 47 so cash-out replay rejects older chain-settling rules.",
        },
      ],
    },
    {
      version: "0.1.101",
      date: "2026-06-20",
      title: "Depot copy cleanup",
      intro: "The Supply Depot sheet is simpler and drops trip wording.",
      changes: [
        {
          build,
          text: "The Supply Depot subtitle now says it carries supplies for digging deeper.",
        },
        {
          build,
          text: "The extra footer under the consumable list was removed, leaving only the buy quantity and item rows.",
        },
        {
          build,
          text: "The ladder and plank surface tip now says to stock up before heading deeper, without talking about trips.",
        },
      ],
    },
    {
      version: "0.1.100",
      date: "2026-06-20",
      title: "Surface shop prompts",
      intro: "Shop open prompts now sit higher above the mine controls.",
      changes: [
        {
          build,
          text: "Standing at a surface shop now shows its Tap to open button higher on phone screens.",
        },
        {
          build,
          text: "The raised prompt slot applies to Hardware Store, Supply Depot, Upgrades, portal, and destination surface prompts.",
        },
        {
          build,
          text: "Focused smoke checks Hardware Store and Supply Depot prompt clearance on a narrow phone viewport.",
        },
      ],
    },
    {
      version: "0.1.99",
      date: "2026-06-20",
      title: "Meaningful mine zoom",
      intro: "Mine zoom now moves far enough to read against cell size.",
      changes: [
        {
          build,
          text: "Zoom inputs now move twice as far across HUD buttons, wheel, pinch, and gamepad controls.",
        },
        {
          build,
          text: "Lantern zoom caps now reach 1.32, 1.64, and 1.96 so each upgrade reveals several more cells.",
        },
        {
          build,
          text: "Lamp coverage still reaches the camera footprint at each cap while the two-cell dark falloff border stays in place.",
        },
      ],
    },
    {
      version: "0.1.98",
      date: "2026-06-20",
      title: "Mine text and status layout",
      intro:
        "Mine copy is clearer, and status messages stay clear of zoom controls.",
      changes: [
        {
          build,
          text: "Surface tips and upgrade blurbs now use shorter rule-focused text for Recall Rope range, Warpcoil range, and Lantern zoom.",
        },
        {
          build,
          text: "Auto-sell results now replace the surface tip while visible and wrap in the same status chip style.",
        },
        {
          build,
          text: "Status chips now reserve room for the Settings button and zoom controls on narrow screens.",
        },
      ],
    },
    {
      version: "0.1.97",
      date: "2026-06-20",
      title: "Credits",
      intro: "The mine pause menu now includes a special thanks.",
      changes: [
        {
          build,
          text: "Settings now has a Credits option that opens a pause window.",
        },
        {
          build,
          text: "The Credits window thanks Mason and MJ Lutcavich for testing, feedback, and great ideas.",
        },
        {
          build,
          text: "The window pauses mine movement and closes from outside taps, Escape, gamepad back, or its close buttons.",
        },
      ],
    },
    {
      version: "0.1.96",
      date: "2026-06-20",
      title: "Menu outside taps",
      intro: "Open mine menus now close from a simple outside tap.",
      changes: [
        {
          build,
          text: "Settings, Base return, stall sheets, Dynamite tiers, and Recovery actions now close when you tap or click outside them.",
        },
        {
          build,
          text: "The outside tap is swallowed after closing the menu, so it does not also move, dig, or press an underlying control.",
        },
        {
          build,
          text: "Bunker builder and modal dialogs keep their existing backdrop dismissal, while scrap mode still uses canvas taps to select placed supports.",
        },
      ],
    },
    {
      version: "0.1.95",
      date: "2026-06-20",
      title: "Death cam surface jump fix",
      intro:
        "Falling-rock deaths now stay underground until the death animation finishes.",
      changes: [
        {
          build,
          text: "The mine renderer now installs death playback from the mine store action before the next frame can follow the reset surface miner.",
        },
        {
          build,
          text: "Falling-rock crushes keep both the camera and miner on the underground impact cell from the first active death frame.",
        },
        {
          build,
          text: "Mine rules, recovery, and replay behavior are unchanged.",
        },
      ],
    },
    {
      version: "0.1.94",
      date: "2026-06-20",
      title: "Cargo hold rebalance",
      intro: "The starting mine bag now has four slots, with 50 as endgame.",
      changes: [
        {
          build,
          text: "Level 1 Cargo Hold now starts at four typed stack slots instead of eight, so early trips hit the bank-or-push decision sooner.",
        },
        {
          build,
          text: "Cargo upgrades now grow through 6, 8, 11, 15, 20, 27, 35, 43, and 50 stack slots, with 50 as the endgame cap.",
        },
        {
          build,
          text: "Cargo upgrade prices now start at 80 vibes and scale into six-figure deep-depth buys behind row and player-level gates.",
        },
      ],
    },
    {
      version: "0.1.93",
      date: "2026-06-20",
      title: "Pickaxe battery tuning",
      intro: "Stronger tools and richer ore now draw more battery.",
      changes: [
        {
          build,
          text: "Every Pickaxe level above 1 now adds a noticeable battery cost to each mining swing.",
        },
        {
          build,
          text: "Richer ores add their own battery strain, so ruby, diamond, and core-tier veins make Battery Cell upgrades matter sooner.",
        },
        {
          build,
          text: "The mine gameplay version moved to 45, and deep ore runs now push players toward Battery Cell upgrades too.",
        },
      ],
    },
    {
      version: "0.1.92",
      date: "2026-06-20",
      title: "Recall rope range",
      intro: "Recall ropes now scale with a permanent depth upgrade.",
      changes: [
        {
          build,
          text: "Base recall ropes can only pull from the shallow mine, starting at row 12.",
        },
        {
          build,
          text: "The new Recall Rope upgrade at the Upgrades stall raises the usable row limit through 30, 75, 180, 420, and 1000.",
        },
        {
          build,
          text: "The recovery menu disables Recall past your current range, and server replay verifies the same gear level before banking.",
        },
      ],
    },
    {
      version: "0.1.91",
      date: "2026-06-20",
      title: "Zoom placement fix",
      intro: "Mine zoom controls now sit under Settings.",
      changes: [
        {
          build,
          text: "Zoom in and zoom out now sit directly under the cog icon instead of floating over the mine view.",
        },
        {
          build,
          text: "The Settings panel opens below the zoom dock, so the controls do not cover each other.",
        },
        {
          build,
          text: "Smoke coverage checks the dock against visible status chips, the Settings button, and the open Settings panel on desktop and narrow viewports.",
        },
      ],
    },
    {
      version: "0.1.90",
      date: "2026-06-20",
      title: "Save slot start safety",
      intro: "Empty slots now have an explicit Start path.",
      changes: [
        {
          build,
          text: "Production logs and a read-only database check found two active saved players, confirmed the long-term save still exists, and showed fresh default rows from Load game attempts.",
        },
        {
          build,
          text: "Existing saves still use Load, while empty slots now show Start and the server refuses to create an empty slot unless the client explicitly asks to start one.",
        },
        {
          build,
          text: "Save-slot requests now emit safe structured logs with hashed player identifiers, requested slot, accepted status, creation status, referrer host, and fetch-site context.",
        },
      ],
    },
    {
      version: "0.1.89",
      date: "2026-06-20",
      title: "Bunker part drag",
      intro: "Base parts can now be selected and dragged into place.",
      changes: [
        {
          build,
          text: "Double-click or double-tap a placed bunker part to select it in the mine view.",
        },
        {
          build,
          text: "Press and drag the selected part to another claimed bunker cell without spending or refunding inventory.",
        },
        {
          build,
          text: "Click or tap elsewhere to clear the selection before choosing another part.",
        },
      ],
    },
    {
      version: "0.1.88",
      date: "2026-06-20",
      title: "Death cam flash fix",
      intro: "Death animations now keep the mine filled from the first frame.",
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
      intro: "The mine HUD now has direct zoom controls.",
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
      intro: "Death animations now stay inside the real mine view.",
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
      intro: "Ladders now use the same scrap flow as other supports.",
      changes: [
        {
          build,
          text: "The dedicated ladder removal button is gone from the mine HUD.",
        },
        {
          build,
          text: "Use Scrap placed supports to select planted ladders, then confirm Scrap to remove them.",
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
          text: "Manual drops merge with existing floor piles, and walk-over collection takes older floor ore before reclaiming chunks you just dropped.",
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
          text: "Scrap mode can now scrap placed beacons for carried vibe value, removing them from the warp list.",
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
          text: "Scrap mode no longer opens a support list. Tap visible ladder or plank cells to mark them, then confirm Scrap.",
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
          text: "Scrap mode lets you select visible placed ladders and planks, then scrap them with replay-safe accounting.",
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
