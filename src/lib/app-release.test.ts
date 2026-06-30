import { describe, expect, it } from "vitest";
import { getAppRelease } from "./app-release";

describe("app release notes", () => {
  it("keeps the latest holodeck note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes[0];

    expect(release.noticeId).toBe("2026-06-29-0.1.150-holodeck");
    expect(latestNote).toMatchObject({
      version: "0.1.150",
      title: "Holodeck test scenes",
      intro: "A new Holodeck mode loads focused, looping mine test scenes.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "A new Holodeck entry in the mine options menu loads small, controlled test scenes through a scenario selector.",
      "The first scenario auto-mines a single block on a deterministic loop, with live controls for pickaxe level and block type that reconfigure the scene without a reload.",
      "Holodeck runs in its own isolated session, so it never touches your live mine trip. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived route-aware ladders note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.149");

    expect(latestNote).toMatchObject({
      version: "0.1.149",
      title: "Route-aware ladders",
      intro: "The ladder warning now respects clear paths home.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "The ladder chip now checks known clear routes to the surface, so it stops warning when a nearby ladder shaft already gets you home.",
      "If there is no known clear route home, the ladder chip says route blocked instead of showing a fake needed count.",
      "The route estimate is sparse and capped for mobile performance. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived visible raid XP pickups note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.148");

    expect(latestNote).toMatchObject({
      version: "0.1.148",
      title: "Visible raid XP pickups",
      intro: "Stale raid XP now has a bright pickup object.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Survived-raid XP pickups now render as larger bright objects with a cyan halo, gold rays, and a stronger green core.",
      "The stale-pickup smoke test now samples the mine canvas while collection is pending, so the XP here state must also have visible world pixels.",
      "The mine tip now says the XP arrow leads to the bright pickup. Mine rules, raid rewards, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived stratum banner fade note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.147");

    expect(latestNote).toMatchObject({
      version: "0.1.147",
      title: "Stratum banner fade",
      intro: "Mine stratum banners now fade away cleanly.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Entering Clay Beds and later stratum banners now fade out and clear themselves after they appear.",
      "Continuing to descend through the same stratum no longer cancels the banner timeout and leaves stale text on screen.",
      "Mine tips were reviewed and remain current. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived raid XP here marker note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.146");

    expect(latestNote).toMatchObject({
      version: "0.1.146",
      title: "Raid XP here marker",
      intro: "Stale raid XP now stays marked at the pickup.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "When the miner reaches an old survived-raid XP drop, the HUD now switches from the direction arrow to an XP here marker instead of disappearing.",
      "The marker stays visible while pickup collection is still pending, so stale XP is not invisible at the destination.",
      "The mine tip now mentions the XP here state. Mine rules, raid rewards, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived raid XP recovery note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.145");

    expect(latestNote).toMatchObject({
      version: "0.1.145",
      title: "Raid XP recovery",
      intro: "Old raid XP drops now point the way back.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Survived bunker raids with uncollected XP now show a HUD locator pointing back to the nearest pickup, even after later mine deaths.",
      "The bunker builder stays usable after the raid combat is resolved, so you can adjust parts while the XP reward is still waiting.",
      "Finish raid still waits for the XP pickups. Live raids and failed raids still keep bunker editing locked.",
    ]);
  });

  it("keeps the archived raid XP pickup visibility note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.144");

    expect(latestNote).toMatchObject({
      version: "0.1.144",
      title: "Raid XP pickup visibility",
      intro: "Raid XP pickups now match the visible overlap area.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Raid XP collection now accepts the visible overlap area around the pickup, so standing beside a marker that covers the miner still collects it.",
      "All explosion visuals now dissipate. Clanker self-destruct bursts fade out instead of permanently covering collectible XP markers.",
      "XP markers draw above raid effects while collectible, and regression coverage now keeps burst and explosion animations finite.",
    ]);
  });

  it("keeps the archived raid XP pickup retry note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.143");

    expect(latestNote).toMatchObject({
      version: "0.1.143",
      title: "Raid XP pickup retry",
      intro: "Raid XP pickups now retry while the miner stands on them.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Standing on a survived raid XP drop now retries collection if the first server response still leaves the pickup on the ground.",
      "The retry stays tied to the same pickup and miner cell, so moving away does not keep collecting old drops.",
      "This changes pickup reliability only. Mine rules, raid rewards, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived crash recovery logging note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.142");

    expect(latestNote).toMatchObject({
      version: "0.1.142",
      title: "Crash recovery logging",
      intro:
        "App crashes now show a recovery screen and log bounded telemetry.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Crashes now show a VibeBots recovery screen with Try again, Reload, and Mine buttons instead of leaving iOS on a broken page.",
      "Client errors, global browser errors, and unhandled promise rejections now post bounded telemetry with hashed player identifiers.",
      "Legacy bunker raid rows now normalize missing fields on load, and release notes stay above the mine loader so the first-run dialog remains tappable.",
    ]);
  });

  it("keeps the archived release metadata cleanup note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.141");

    expect(latestNote).toMatchObject({
      version: "0.1.141",
      title: "Release metadata cleanup",
      intro: "Release notes now live in a clearer owned module.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Release-note archive data now lives in its own typed module instead of sharing a file with release-version logic.",
      "getAppRelease remains the public release API for version routes, release popups, and Web Push summaries.",
      "This cleanup does not change player behavior, mine rules, save data, MINE_VERSION, or SIM_VERSION.",
    ]);
  });

  it("keeps the archived fall death camera note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.140");

    expect(latestNote).toMatchObject({
      version: "0.1.140",
      title: "Fall death camera",
      intro: "Fatal falls now stay visible until the landing impact.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Long fatal falls now keep the camera and miner moving all the way to the landing cell before the trip report appears.",
      "The death animation now waits for the full fall distance instead of clearing from a fixed short timeout.",
      "Held keyboard and touch movement now cancel on death, so respawning at the surface starts from a clean control state.",
    ]);
  });

  it("keeps the archived mine renderer cleanup note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.139");

    expect(latestNote).toMatchObject({
      version: "0.1.139",
      title: "Mine renderer cleanup",
      intro: "The mine renderer is split into clearer owned modules.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Mine render palettes, terrain colors, hash helpers, block meshes, particle spawning, support selection, bunker overlays, miner rig pieces, and surface buildings now live in focused component modules.",
      "The main mine canvas still owns the scene state machine, frame sampling, camera motion, miner motion, lighting, diagnostics, and event-to-effect bridge.",
      "This is a render-only ownership cleanup. Mine rules, replay behavior, save data, gameplay versions, and renderer dependencies are unchanged.",
    ]);
  });

  it("keeps the archived death playback cleanup note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.138");

    expect(latestNote).toMatchObject({
      version: "0.1.138",
      title: "Death playback cleanup",
      intro: "Mine death playback now has a clearer render bridge.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Fatal-fall and falling-rock-crush playback now live in a focused mine death playback helper instead of the main canvas scene.",
      "The helper owns terminal result mapping, the synchronous store subscription, the fallback clear timer, and the short fall window used for camera framing.",
      "The mine canvas stays focused on frame sampling, camera and miner transforms, particles, impact sounds, and diagnostics.",
    ]);
  });

  it("keeps the archived mine panel cleanup note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.137");

    expect(latestNote).toMatchObject({
      version: "0.1.137",
      title: "Mine panel cleanup",
      intro: "The mine UI is split into clearer owned modules.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Release notes, bag, save slots, stamp book, feedback, settings prompts, stalls, and bunker controls now live in their own component files.",
      "MinePanel now stays focused on mine state, viewport, HUD, and action routing instead of owning every dialog and sheet.",
      "Smoke coverage now checks the moved release notes, settings, feedback, bag, save slot, bunker, and stall surfaces.",
    ]);
  });

  it("keeps the archived Clanker chew and XP pickup note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.136");

    expect(latestNote).toMatchObject({
      version: "0.1.136",
      title: "Clanker chew and XP pickups",
      intro: "Clankers now chew blockers and drop readable XP.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Clankers that reach blocking base parts now spend their remaining battery chewing for repeated damage instead of exploding on contact.",
      "Raid XP now drops on a reachable approach cell unless the blocker is destroyed, so walking over the pickup collects it normally.",
      "XP pickups are now smaller green and gold markers with a blue ring so they read as XP instead of a large loose gem.",
    ]);
  });

  it("keeps the archived roof cell polish note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.135");

    expect(latestNote).toMatchObject({
      version: "0.1.135",
      title: "Roof cell polish",
      intro: "Bunker roof cells now sit cleanly together.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Roof base parts now render as bounded gabled cells instead of loose triangular caps.",
      "Adjacent roof cells share a consistent eave, ridge, and shingle silhouette that lines up above walls and floors.",
      "Production-mode visual verification now checks a three-roof starter-base layout.",
    ]);
  });

  it("keeps the archived Clanker visuals note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.134");

    expect(latestNote).toMatchObject({
      version: "0.1.134",
      title: "Clanker visuals",
      intro: "Clankers now look like polished robotic creatures.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Raid attackers now render as low armored spider-bots with eight articulated legs, plated bodies, glowing sensors, and front cutters.",
      "The crawl animation now bobs the chassis, cycles each leg, sweeps the sensor head, and works along the existing raid path timing.",
      "Self-destructs now flash with a larger burst ring and metal fragments instead of a plain orange sphere.",
    ]);
  });

  it("keeps the archived Clanker open paths note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.133");

    expect(latestNote).toMatchObject({
      version: "0.1.133",
      title: "Clanker open paths",
      intro: "Clankers now prefer open bunker routes to the player cell.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "If a bunker has an open path to the player cell, Clankers now follow that path instead of stopping to bite a nearby wall.",
      "Players need to fully enclose the player cell before starting the next raid if they want the walls to take the hit first.",
      "Failed raid messages now tip players that Clankers follow open bunker cells and that the player cell should be enclosed.",
    ]);
  });

  it("keeps the archived dirt break polish note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.132");

    expect(latestNote).toMatchObject({
      version: "0.1.132",
      title: "Dirt break polish",
      intro: "Dirt blocks now crack and burst with more weight.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Dirt cracks now branch wider on every hit instead of using the old sparse marks.",
      "The final dirt hit throws chunky debris, slower dust, and a stronger thump so the break feels heavier.",
      "Focused smoke coverage now checks crack growth and the final dirt particle burst.",
    ]);
  });

  it("keeps the archived base part visuals note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.131");

    expect(latestNote).toMatchObject({
      version: "0.1.131",
      title: "Base part visuals",
      intro: "Bunker parts now look like their real building roles.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Floors draw as bottom plates, walls draw as center panels, and doors sit on the left or right edge of the claimed room.",
      "Floor Spikes now rise out of a bottom plate as several large upward spikes.",
      "Roofs draw as triangular caps with rafter beams, and Basic Turrets use a small mounted barrel instead of a generic block.",
    ]);
  });

  it("keeps the archived raid XP pickup note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.130");

    expect(latestNote).toMatchObject({
      version: "0.1.130",
      title: "Raid XP pickups",
      intro: "Raid XP now comes from walking over the dropped pickups.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Dead Clankers drop defense XP pickups that the miner must physically walk over before the XP can be claimed.",
      "The first survived raid now drops enough defense XP to reach Level 2 after every pickup is collected.",
      "If a Clanker reaches the player cell, it self-destructs, kills the miner, ends the raid, and clears every XP pickup before collection.",
    ]);
  });

  it("keeps the archived Clanker raid damage note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.129");

    expect(latestNote).toMatchObject({
      version: "0.1.129",
      title: "Clanker raid damage",
      intro: "Bunker raids now end when every Clanker is dead.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Clankers now spend battery on their route, bite reachable base parts or the core, and stop as soon as they die.",
      "Clankers that fail to reach the player cell self-destruct in the mine view, and dead Clankers leave defense XP pickups.",
      "The bunker raid button now collects the dropped raid XP instead of waiting on the old fixed timer.",
    ]);
  });

  it("keeps the archived lantern zoom overview note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.128");

    expect(latestNote).toMatchObject({
      version: "0.1.128",
      title: "Lantern zoom overview fix",
      intro: "Zoomed-out mine views stay readable instead of going darker.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "The mine no longer draws edge falloff while zoom-out is still available.",
      "A short dark falloff appears only at the lantern's zoom-out cap, when the camera reaches the edge of unlocked visibility.",
      "The lantern light radius, zoom caps, mine replay rules, and sim versions are unchanged.",
    ]);
  });

  it("keeps the archived bunker builder controls note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.127");

    expect(latestNote).toMatchObject({
      version: "0.1.127",
      title: "Bunker builder controls",
      intro: "Base building is compact and walkable.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "The bunker builder now docks low on phone screens so the claimed base stays visible while editing.",
      "Place, Remove, and Move live in a labeled mode group, separate from the base-part inventory buttons.",
      "Remove mode now owns placed-part taps, returns undamaged parts to inventory, and the builder includes walk buttons for moving while it stays open.",
    ]);
  });

  it("keeps the archived scrap selection cleanup note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.126");

    expect(latestNote).toMatchObject({
      version: "0.1.126",
      title: "Scrap selection cleanup",
      intro: "Scrap mode no longer leaves bunker selection squares behind.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Opening Scrap now closes bunker claim and builder overlays so their grid cannot stay stuck over the mine.",
      "Bunker claim previews are hidden while Scrap mode is active, keeping support removal focused on supports only.",
      "Phone smoke coverage now opens bunker claim first, scraps supports, and proves the red selection pixels clear.",
    ]);
  });

  it("keeps the archived terminal replay movement note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.125");

    expect(latestNote).toMatchObject({
      version: "0.1.125",
      title: "Terminal replay movement fix",
      intro: "Saved fall replays no longer block swipe movement.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Saved trips that replay into a fatal fall now settle at Base 0 without leaving a collapsed result active.",
      "Swipe movement stays enabled after dismissing the release list, even for installed saves that just consumed an old terminal replay.",
      "Store coverage now proves the replayed save can move immediately after loading.",
    ]);
  });

  it("keeps the archived mine terminal state note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.124");

    expect(latestNote).toMatchObject({
      version: "0.1.124",
      title: "Mine terminal state fix",
      intro: "Mine death and bunker UI now settle cleanly after reloads.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Saved trips that replay into a fatal fall now restore the death result once, mark it consumed, and stop replaying the same fall forever.",
      "Bunker builder UI now starts closed, closes on surface or death, and never leaves the claim grid over fatal fall playback.",
      "Jump only appears when the sim says a jump is available, and diagnostics now log terminal replay and bunker-overlay input blockers.",
    ]);
  });

  it("keeps the archived save touch diagnostics note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.123");

    expect(latestNote).toMatchObject({
      version: "0.1.123",
      title: "Save touch diagnostics",
      intro: "Bunker saves no longer block movement drags at the surface.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Surface saves with an existing bunker now keep movement drags enabled unless the underground builder is actually active.",
      "A new mine diagnostics route logs bounded touch-layer state when movement should be available but the touch surface is missing or covered.",
      "Phone smoke coverage now recreates a surface bunker save and proves touch drags still move the miner.",
    ]);
  });

  it("keeps the archived touch drag layer note complete", () => {
    const release = getAppRelease();
    const touchDragNote = release.notes.find(
      (note) => note.version === "0.1.122",
    );

    expect(touchDragNote).toMatchObject({
      version: "0.1.122",
      title: "Touch drag layer",
      intro: "Movement drags now sit above the mine canvas again.",
    });
    expect(touchDragNote?.changes.map((change) => change.text)).toEqual([
      "The movement touch surface now has an explicit stack position above the 3D canvas.",
      "HUD buttons keep their higher stack position, so Jump and consumable controls remain tappable.",
      "Smoke coverage now checks that open mine space targets movement while HUD buttons stay on top.",
    ]);
  });

  it("keeps the archived touch zoom lock note complete", () => {
    const release = getAppRelease();
    const touchZoomNote = release.notes.find(
      (note) => note.version === "0.1.121",
    );

    expect(touchZoomNote).toMatchObject({
      version: "0.1.121",
      title: "Touch zoom lock",
      intro:
        "Touch input is locked back to mine controls instead of page zoom.",
    });
    expect(touchZoomNote?.changes.map((change) => change.text)).toEqual([
      "The app viewport now blocks browser page pinch zoom so the HUD cannot inflate over the mine.",
      "The mine shell catches document pinch gestures while preserving the bounded in-mine camera zoom.",
      "Smoke coverage now dispatches real touch events to prove touch drag movement still works on phone viewports.",
    ]);
  });

  it("keeps the archived underground bunker claims note complete", () => {
    const release = getAppRelease();
    const bunkerNote = release.notes.find((note) => note.version === "0.1.120");

    expect(bunkerNote).toMatchObject({
      version: "0.1.120",
      title: "Underground bunker claims",
      intro: "Clear rooms can become bunkers before surfacing.",
    });
    expect(bunkerNote?.changes.map((change) => change.text)).toEqual([
      "The bunker builder now checks the live underground cells, so a clear room can be claimed without first cashing out.",
      "The builder now uses compact Place, Remove, and Move modes, with canvas cell targeting and restored drag movement across the claimed space.",
      "Cash-out replays the mine at the claimed move, saves the bunker and cleared cells together, and unlocks raids after the claim is banked.",
    ]);
  });

  it("keeps the archived jump button placement note complete", () => {
    const release = getAppRelease();
    const jumpButtonNote = release.notes.find(
      (note) => note.version === "0.1.119",
    );

    expect(jumpButtonNote).toMatchObject({
      version: "0.1.119",
      title: "Jump button placement",
      intro: "Jump now sits on the middle right and leaves movement clear.",
    });
    expect(jumpButtonNote?.changes.map((change) => change.text)).toEqual([
      "The Jump button moved to the middle-right edge of the mine instead of the bottom controls.",
      "The bottom dig-control strip no longer catches pointer input in empty space, so drag movement stays clear.",
      "Smoke coverage now checks the larger Jump button placement, bottom-control non-overlap, and bottom-center hit target.",
    ]);
  });

  it("keeps the archived visual viewport refresh note complete", () => {
    const release = getAppRelease();
    const viewportNote = release.notes.find(
      (note) => note.version === "0.1.118",
    );

    expect(viewportNote).toMatchObject({
      version: "0.1.118",
      title: "Visual viewport refresh",
      intro:
        "Installed Android refreshes now anchor to the visible mine screen.",
    });
    expect(viewportNote?.changes.map((change) => change.text)).toEqual([
      "The mine shell now uses the visual viewport when available, so standalone Android refreshes do not anchor controls to a stale layout viewport.",
      "The Refresh button records the target version and reruns viewport alignment on refresh, focus, resume, and visual viewport changes.",
      "Smoke coverage now mocks an installed app visual viewport and checks Settings, zoom, and dig controls after refresh and resume.",
    ]);
  });

  it("keeps the archived jump jets note complete", () => {
    const release = getAppRelease();
    const jumpNote = release.notes.find((note) => note.version === "0.1.117");

    expect(jumpNote).toMatchObject({
      version: "0.1.117",
      title: "Jump Jets",
      intro: "A free hop now clears one-cell ledges without spending ladders.",
    });
    expect(jumpNote?.changes.map((change) => change.text)).toEqual([
      "Jump Jets lift the miner up one empty cell as a logged battery action without placing a ladder.",
      "The new Jump button is larger than the support and consumable controls, sits in the bottom traversal cluster, and shares the Space shortcut.",
      "Ladders still build reusable shafts, while Jump Jets only hold the miner until the next action.",
    ]);
  });

  it("keeps the archived shop release copy note complete", () => {
    const release = getAppRelease();
    const releaseCopyNote = release.notes.find(
      (note) => note.version === "0.1.116",
    );

    expect(releaseCopyNote).toMatchObject({
      version: "0.1.116",
      title: "Shop release copy",
      intro: "Release notes now match the clean shop layout.",
    });
    expect(releaseCopyNote?.changes.map((change) => change.text)).toEqual([
      "The latest shop note now describes the simpler rows without repeating the rejected framing.",
      "The 0.1.114 archive is kept as shop button feedback and points to the 0.1.115 cleanup.",
      "Release tests and smoke coverage now check the cleaner wording.",
    ]);
  });

  it("keeps the archived clean shop layout note complete", () => {
    const release = getAppRelease();
    const cleanNote = release.notes.find((note) => note.version === "0.1.115");

    expect(cleanNote).toMatchObject({
      version: "0.1.115",
      title: "Clean shop layout",
      intro: "Mine shops are easier to scan.",
    });
    expect(cleanNote?.changes.map((change) => change.text)).toEqual([
      "Supply Depot and Upgrades rows now use simple descriptions.",
      "Rows keep clear buy buttons without extra labels or projected-balance text.",
      "Upgrade purchases still keep the hold-to-buy confirmation and feedback.",
    ]);
  });

  it("keeps the archived shop button feedback note complete", () => {
    const release = getAppRelease();
    const buttonNote = release.notes.find((note) => note.version === "0.1.114");

    expect(buttonNote).toMatchObject({
      version: "0.1.114",
      title: "Shop button feedback",
      intro: "Shop purchases gained stronger button feedback.",
    });
    expect(buttonNote?.changes.map((change) => change.text)).toEqual([
      "Supply Depot and Upgrades briefly added row-planning details that were removed in 0.1.115.",
      "Upgrades added a hold-to-buy confirmation before buying.",
      "Shop buttons add stronger visual feedback plus supported mobile vibration for press, success, and deny moments.",
    ]);
  });

  it("keeps the archived scrap panel text bounds note complete", () => {
    const release = getAppRelease();
    const panelNote = release.notes.find((note) => note.version === "0.1.113");

    expect(panelNote).toMatchObject({
      version: "0.1.113",
      title: "Scrap panel text bounds",
      intro: "Scrap mode text now stays inside the phone panel.",
    });
    expect(panelNote?.changes.map((change) => change.text)).toEqual([
      "The Scrap mode header now wraps long status chips instead of letting them spill outside the panel.",
      "The selected scrap value stays readable on narrow phone screens.",
      "Focused smoke coverage now checks the panel and its children stay inside horizontal bounds.",
    ]);
  });

  it("keeps the archived scrap language note complete", () => {
    const release = getAppRelease();
    const scrapNote = release.notes.find((note) => note.version === "0.1.112");

    expect(scrapNote).toMatchObject({
      version: "0.1.112",
      title: "Scrap language",
      intro: "Placed support removal now uses scrap wording.",
    });
    expect(scrapNote?.changes.map((change) => change.text)).toEqual([
      "The placed-support removal button is now Scrap placed supports.",
      "The selection panel is now Scrap mode, with Scrap as the confirm action.",
      "Scrapping feedback now says Scrapped supports and keeps the same carried scrap value rules.",
    ]);
  });

  it("keeps the archived Hardware Store copy note complete", () => {
    const release = getAppRelease();
    const storeNote = release.notes.find((note) => note.version === "0.1.111");

    expect(storeNote).toMatchObject({
      version: "0.1.111",
      title: "Hardware Store copy",
      intro: "The Hardware Store sheet now stays focused on items.",
    });
    expect(storeNote?.changes.map((change) => change.text)).toEqual([
      "The extra Hardware Store intro and footer helper paragraphs were removed.",
      "Buy buttons remain the source for prices, level locks, and stock limits.",
      "Item rows still describe each base part without repeating shop-wide rules.",
    ]);
  });

  it("keeps the archived mine death report note complete", () => {
    const release = getAppRelease();
    const deathNote = release.notes.find((note) => note.version === "0.1.110");

    expect(deathNote).toMatchObject({
      version: "0.1.110",
      title: "Mine death report",
      intro:
        "Crush reports now stay on the impact scene and use the right cause.",
    });
    expect(deathNote?.changes.map((change) => change.text)).toEqual([
      "Falling-rock death reports now keep the underground impact cells visible through the report instead of flashing back to an empty reset frame.",
      "Near-miss copy now says where the rock fell instead of saying the robot battery died.",
      "Focused smoke coverage checks the report frame for populated cells, camera depth, and cause-specific copy.",
    ]);
  });

  it("keeps the archived mine refresh viewport lock note complete", () => {
    const release = getAppRelease();
    const viewportNote = release.notes.find(
      (note) => note.version === "0.1.109",
    );

    expect(viewportNote).toMatchObject({
      version: "0.1.109",
      title: "Mine refresh viewport lock",
      intro: "Refresh now keeps the whole mine page pinned in place.",
    });
    expect(viewportNote?.changes.map((change) => change.text)).toEqual([
      "The mine now locks the document and body scroll while mounted, so mobile refresh restoration cannot push HUD controls down.",
      "The new-version Refresh button resets scroll and replaces the current page with a cache-busted mine URL.",
      "Smoke coverage now checks the document lock plus Settings, zoom, and dig controls after the refresh path loads.",
    ]);
  });

  it("keeps the archived mine warning visuals note complete", () => {
    const release = getAppRelease();
    const warningNote = release.notes.find(
      (note) => note.version === "0.1.108",
    );

    expect(warningNote).toMatchObject({
      version: "0.1.108",
      title: "Mine warning visuals",
      intro: "Low battery and ladder risk now stand out more clearly.",
    });
    expect(warningNote?.changes.map((change) => change.text)).toEqual([
      "Low battery now adds a pulsing red edge warning around the mine screen.",
      "The battery chip throbs red and labels the charge as low when the climb home is risky.",
      "The ladder chip now pulses and shows how many ladders are needed when the current stock is short for the depth.",
    ]);
  });

  it("keeps the archived sheet drag dismiss note complete", () => {
    const release = getAppRelease();
    const sheetNote = release.notes.find((note) => note.version === "0.1.107");

    expect(sheetNote).toMatchObject({
      version: "0.1.107",
      title: "Sheet drag dismiss",
      intro: "Bottom shop sheets now dismiss from a pull anywhere inside.",
    });
    expect(sheetNote?.changes.map((change) => change.text)).toEqual([
      "Dragging down from anywhere inside a stall sheet now moves the panel, not just the top handle.",
      "Releasing past the dismiss distance closes the Hardware Store, Supply Depot, Upgrades, Elevator, or Warp Pad sheet.",
      "Ordinary taps on shop buttons still work, and editable beacon names do not start a drag.",
    ]);
  });

  it("keeps the archived mine refresh layout note complete", () => {
    const release = getAppRelease();
    const refreshNote = release.notes.find(
      (note) => note.version === "0.1.106",
    );

    expect(refreshNote).toMatchObject({
      version: "0.1.106",
      title: "Mine refresh layout",
      intro: "Refreshing into a new build keeps the mine screen locked.",
    });
    expect(refreshNote?.changes.map((change) => change.text)).toEqual([
      "The mine screen now uses a fixed app shell so browser scroll restoration cannot shift the canvas after Refresh.",
      "The shell turns scroll restoration off while the mine is mounted, keeping the HUD and bottom controls inside the visible viewport.",
      "Focused smoke clicks the new-version Refresh button and checks the loaded mine stays aligned to the viewport.",
    ]);
  });

  it("keeps the archived battle camera note complete", () => {
    const release = getAppRelease();
    const cameraNote = release.notes.find((note) => note.version === "0.1.105");

    expect(cameraNote).toMatchObject({
      version: "0.1.105",
      title: "Battle camera",
      intro: "Battle mode now keeps both bots in the shot.",
    });
    expect(cameraNote?.changes.map((change) => change.text)).toEqual([
      "The arena camera now follows the live midpoint between the bots instead of staying fixed.",
      "The camera backs up as bots spread apart, then eases closer as they clash.",
      "Smoke coverage now checks that both bots stay framed while the match moves.",
    ]);
  });

  it("keeps the archived mine input cadence note complete", () => {
    const release = getAppRelease();
    const cadenceNote = release.notes.find(
      (note) => note.version === "0.1.104",
    );

    expect(cadenceNote).toMatchObject({
      version: "0.1.104",
      title: "Mine input cadence",
      intro: "Holding movement now keeps pace with rapid taps.",
    });
    expect(cadenceNote?.changes.map((change) => change.text)).toEqual([
      "Keyboard and thumbstick movement now share one cadence, so holding a direction is no slower than repeated taps or swipes.",
      "Rapid tap-release bursts wait for the same next legal action time as held input, closing the swipe-spam shortcut.",
      "The miner glide now fills more of each legal action interval, making movement look smoother without changing replay, save, or sim versions.",
    ]);
  });

  it("keeps the archived mine load fallback note complete", () => {
    const release = getAppRelease();
    const loadNote = release.notes.find((note) => note.version === "0.1.103");

    expect(loadNote).toMatchObject({
      version: "0.1.103",
      title: "Mine load fallback",
      intro: "Bad network loads now show the mine is trying to recover.",
    });
    expect(loadNote?.changes.map((change) => change.text)).toEqual([
      "The mine now shows an animated cart-and-drill loader while world data or the canvas bundle is still loading.",
      "If the network drops before the world loads, a transparent message explains that the save was not changed.",
      "The retry button reloads the mine scene, and mine movement stays paused until the world is ready.",
    ]);
  });

  it("keeps the archived falling rock chains note complete", () => {
    const release = getAppRelease();
    const rockNote = release.notes.find((note) => note.version === "0.1.102");

    expect(rockNote).toMatchObject({
      version: "0.1.102",
      title: "Falling rock chains",
      intro: "Stacked falling rocks now drop as one column.",
    });
    expect(rockNote?.changes.map((change) => change.text)).toEqual([
      "Mining the support under a vertical rock or boulder stack now starts the countdown on the whole chain.",
      "When the countdown ends, every warned block falls together instead of waiting for one rock per delay cycle.",
      "The mine gameplay version moved to 47 so cash-out replay rejects older chain-settling rules.",
    ]);
  });

  it("keeps the archived depot copy cleanup note complete", () => {
    const release = getAppRelease();
    const depotNote = release.notes.find((note) => note.version === "0.1.101");

    expect(depotNote).toMatchObject({
      version: "0.1.101",
      title: "Depot copy cleanup",
      intro: "The Supply Depot sheet is simpler and drops trip wording.",
    });
    expect(depotNote?.changes.map((change) => change.text)).toEqual([
      "The Supply Depot subtitle now says it carries supplies for digging deeper.",
      "The extra footer under the consumable list was removed, leaving only the buy quantity and item rows.",
      "The ladder and plank surface tip now says to stock up before heading deeper, without talking about trips.",
    ]);
  });

  it("keeps the archived surface shop prompts note complete", () => {
    const release = getAppRelease();
    const promptNote = release.notes.find((note) => note.version === "0.1.100");

    expect(promptNote).toMatchObject({
      version: "0.1.100",
      title: "Surface shop prompts",
      intro: "Shop open prompts now sit higher above the mine controls.",
    });
    expect(promptNote?.changes.map((change) => change.text)).toEqual([
      "Standing at a surface shop now shows its Tap to open button higher on phone screens.",
      "The raised prompt slot applies to Hardware Store, Supply Depot, Upgrades, portal, and destination surface prompts.",
      "Focused smoke checks Hardware Store and Supply Depot prompt clearance on a narrow phone viewport.",
    ]);
  });

  it("keeps the archived meaningful zoom note complete", () => {
    const release = getAppRelease();
    const zoomNote = release.notes.find((note) => note.version === "0.1.99");

    expect(zoomNote).toMatchObject({
      version: "0.1.99",
      title: "Meaningful mine zoom",
      intro: "Mine zoom now moves far enough to read against cell size.",
    });
    expect(zoomNote?.changes.map((change) => change.text)).toEqual([
      "Zoom inputs now move twice as far across HUD buttons, wheel, pinch, and gamepad controls.",
      "Lantern zoom caps now reach 1.32, 1.64, and 1.96 so each upgrade reveals several more cells.",
      "Lamp coverage still reaches the camera footprint at each cap while the two-cell dark falloff border stays in place.",
    ]);
  });

  it("keeps the archived mine text and status layout note complete", () => {
    const release = getAppRelease();
    const textNote = release.notes.find((note) => note.version === "0.1.98");

    expect(textNote).toMatchObject({
      version: "0.1.98",
      title: "Mine text and status layout",
      intro:
        "Mine copy is clearer, and status messages stay clear of zoom controls.",
    });
    expect(textNote?.changes.map((change) => change.text)).toEqual([
      "Surface tips and upgrade blurbs now use shorter rule-focused text for Recall Rope range, Warpcoil range, and Lantern zoom.",
      "Auto-sell results now replace the surface tip while visible and wrap in the same status chip style.",
      "Status chips now reserve room for the Settings button and zoom controls on narrow screens.",
    ]);
  });

  it("keeps the archived credits note scoped to the pause menu", () => {
    const release = getAppRelease();
    const creditsNote = release.notes.find((note) => note.version === "0.1.97");

    expect(creditsNote).toMatchObject({
      version: "0.1.97",
      title: "Credits",
      intro: "The mine pause menu now includes a special thanks.",
    });
    expect(creditsNote?.changes.map((change) => change.text)).toEqual([
      "Settings now has a Credits option that opens a pause window.",
      "The Credits window thanks Mason and MJ Lutcavich for testing, feedback, and great ideas.",
      "The window pauses mine movement and closes from outside taps, Escape, gamepad back, or its close buttons.",
    ]);
  });

  it("keeps the archived menu outside taps note complete", () => {
    const release = getAppRelease();
    const menuNote = release.notes.find((note) => note.version === "0.1.96");

    expect(menuNote).toMatchObject({
      version: "0.1.96",
      title: "Menu outside taps",
      intro: "Open mine menus now close from a simple outside tap.",
    });
    expect(menuNote?.changes.map((change) => change.text)).toEqual([
      "Settings, Base return, stall sheets, Dynamite tiers, and Recovery actions now close when you tap or click outside them.",
      "The outside tap is swallowed after closing the menu, so it does not also move, dig, or press an underlying control.",
      "Bunker builder and modal dialogs keep their existing backdrop dismissal, while scrap mode still uses canvas taps to select placed supports.",
    ]);
  });

  it("keeps the archived death cam surface jump note complete", () => {
    const release = getAppRelease();
    const deathCamNote = release.notes.find(
      (note) => note.version === "0.1.95",
    );

    expect(deathCamNote).toMatchObject({
      version: "0.1.95",
      title: "Death cam surface jump fix",
      intro:
        "Falling-rock deaths now stay underground until the death animation finishes.",
    });
    expect(deathCamNote?.changes.map((change) => change.text)).toEqual([
      "The mine renderer now installs death playback from the mine store action before the next frame can follow the reset surface miner.",
      "Falling-rock crushes keep both the camera and miner on the underground impact cell from the first active death frame.",
      "Mine rules, recovery, and replay behavior are unchanged.",
    ]);
  });

  it("keeps the archived cargo hold rebalance note complete", () => {
    const release = getAppRelease();
    const cargoNote = release.notes.find((note) => note.version === "0.1.94");

    expect(cargoNote).toMatchObject({
      version: "0.1.94",
      title: "Cargo hold rebalance",
      intro: "The starting mine bag now has four slots, with 50 as endgame.",
    });
    expect(cargoNote?.changes.map((change) => change.text)).toEqual([
      "Level 1 Cargo Hold now starts at four typed stack slots instead of eight, so early trips hit the bank-or-push decision sooner.",
      "Cargo upgrades now grow through 6, 8, 11, 15, 20, 27, 35, 43, and 50 stack slots, with 50 as the endgame cap.",
      "Cargo upgrade prices now start at 80 vibes and scale into six-figure deep-depth buys behind row and player-level gates.",
    ]);
  });

  it("keeps the archived pickaxe swing cost note scoped to battery tuning", () => {
    const release = getAppRelease();
    const pickaxeNote = release.notes.find((note) => note.version === "0.1.93");

    expect(pickaxeNote).toMatchObject({
      version: "0.1.93",
      title: "Pickaxe battery tuning",
      intro: "Stronger tools and richer ore now draw more battery.",
    });
    expect(pickaxeNote?.changes.map((change) => change.text)).toEqual([
      "Every Pickaxe level above 1 now adds a noticeable battery cost to each mining swing.",
      "Richer ores add their own battery strain, so ruby, diamond, and core-tier veins make Battery Cell upgrades matter sooner.",
      "The mine gameplay version moved to 45, and deep ore runs now push players toward Battery Cell upgrades too.",
    ]);
  });

  it("keeps the archived recall rope note complete", () => {
    const release = getAppRelease();
    const recallNote = release.notes.find((note) => note.version === "0.1.92");

    expect(recallNote).toMatchObject({
      version: "0.1.92",
      title: "Recall rope range",
      intro: "Recall ropes now scale with a permanent depth upgrade.",
    });
    expect(recallNote?.changes.map((change) => change.text)).toEqual([
      "Base recall ropes can only pull from the shallow mine, starting at row 12.",
      "The new Recall Rope upgrade at the Upgrades stall raises the usable row limit through 30, 75, 180, 420, and 1000.",
      "The recovery menu disables Recall past your current range, and server replay verifies the same gear level before banking.",
    ]);
  });

  it("keeps the archived zoom placement note scoped to zoom placement", () => {
    const release = getAppRelease();
    const zoomNote = release.notes.find((note) => note.version === "0.1.91");

    expect(zoomNote).toMatchObject({
      version: "0.1.91",
      title: "Zoom placement fix",
      intro: "Mine zoom controls now sit under Settings.",
    });
    expect(zoomNote?.intro).not.toContain("Mason, load your first save now.");
    expect(zoomNote?.changes.map((change) => change.text)).toEqual([
      "Zoom in and zoom out now sit directly under the cog icon instead of floating over the mine view.",
      "The Settings panel opens below the zoom dock, so the controls do not cover each other.",
      "Smoke coverage checks the dock against visible status chips, the Settings button, and the open Settings panel on desktop and narrow viewports.",
    ]);
  });

  it("keeps the archived save slot safety note scoped to Start versus Load", () => {
    const release = getAppRelease();
    const saveSlotNote = release.notes.find(
      (note) => note.version === "0.1.90",
    );

    expect(saveSlotNote).toMatchObject({
      version: "0.1.90",
      title: "Save slot start safety",
      intro: "Empty slots now have an explicit Start path.",
    });
    expect(saveSlotNote?.intro).not.toContain(
      "Mason, load your first save now.",
    );
    expect(saveSlotNote?.changes.map((change) => change.text)).toEqual([
      "Production logs and a read-only database check found two active saved players, confirmed the long-term save still exists, and showed fresh default rows from Load game attempts.",
      "Existing saves still use Load, while empty slots now show Start and the server refuses to create an empty slot unless the client explicitly asks to start one.",
      "Save-slot requests now emit safe structured logs with hashed player identifiers, requested slot, accepted status, creation status, referrer host, and fetch-site context.",
    ]);
  });

  it("keeps the archived bunker part drag note complete", () => {
    const release = getAppRelease();
    const bunkerNote = release.notes.find((note) => note.version === "0.1.89");

    expect(bunkerNote).toMatchObject({
      version: "0.1.89",
      title: "Bunker part drag",
      intro: "Base parts can now be selected and dragged into place.",
    });
    expect(bunkerNote?.changes.map((change) => change.text)).toEqual([
      "Double-click or double-tap a placed bunker part to select it in the mine view.",
      "Press and drag the selected part to another claimed bunker cell without spending or refunding inventory.",
      "Click or tap elsewhere to clear the selection before choosing another part.",
    ]);
  });

  it("keeps the archived death cam flash note scoped to death playback", () => {
    const release = getAppRelease();
    const deathCamNote = release.notes.find(
      (note) => note.version === "0.1.88",
    );

    expect(deathCamNote).toMatchObject({
      version: "0.1.88",
      title: "Death cam flash fix",
      intro: "Death animations now keep the mine filled from the first frame.",
    });
    expect(deathCamNote?.intro).not.toContain(
      "Mason, load your first save now.",
    );
    expect(deathCamNote?.changes.map((change) => change.text)).toEqual([
      "Fatal falls and falling-rock crushes now prepare the death camera before the browser paints the next frame.",
      "The camera no longer gets one frame ahead of the populated underground cell window, removing the brief void flash.",
      "Mine rules, recovery, and replay behavior are unchanged.",
    ]);
  });

  it("keeps the archived zoom note scoped to camera controls", () => {
    const release = getAppRelease();
    const zoomNote = release.notes.find((note) => note.version === "0.1.87");

    expect(zoomNote).toMatchObject({
      version: "0.1.87",
      title: "Mine zoom buttons",
      intro: "The mine HUD now has direct zoom controls.",
    });
    expect(zoomNote?.intro).not.toContain("Mason, load your first save now.");
    expect(zoomNote?.changes.map((change) => change.text)).toEqual([
      "The HUD now has on-screen zoom in and zoom out buttons in a clear camera dock for mouse, touch, and gamepad players who want direct camera control.",
      "Zoom out still caps at the active Lantern range, and each Lantern upgrade opens a meaningfully wider camera limit.",
      "The miner headlamp now scales with Lantern range so lit cells stay readable while the outer two-cell border keeps its dark falloff.",
    ]);
  });

  it("keeps the archived death cam note scoped to death playback", () => {
    const release = getAppRelease();
    const deathCamNote = release.notes.find(
      (note) => note.version === "0.1.86",
    );

    expect(deathCamNote).toMatchObject({
      title: "Death cam fix",
      intro: "Death animations now stay inside the real mine view.",
    });
    expect(deathCamNote?.intro).not.toContain(
      "Mason, load your first save now.",
    );
    expect(deathCamNote?.changes.map((change) => change.text)).toEqual([
      "Fatal falls and falling-rock crushes keep rendering the populated underground cells around the death.",
      "The trip report still waits until the fall or crush impact finishes, but the camera no longer shows a sudden empty void.",
      "Mine rules, recovery, and replay behavior are unchanged.",
    ]);
  });

  it("keeps the archived save slot note complete with the save reminder", () => {
    const release = getAppRelease();
    const saveSlotNote = release.notes.find(
      (note) => note.version === "0.1.85",
    );

    expect(saveSlotNote).toMatchObject({
      title: "Save slot refresh",
      intro: "Mason, load your first save now.",
    });
    expect(saveSlotNote?.changes.map((change) => change.text)).toEqual([
      "After the server accepts a Load game slot switch, the client now reloads the mine world and gear for that slot before returning to the mine.",
      "This prevents a previously open save from staying visible after choosing another saved slot.",
    ]);
  });

  it("keeps the archived falling rock durability note complete", () => {
    const release = getAppRelease();
    const fallingRockNote = release.notes.find(
      (note) => note.version === "0.1.78",
    );

    expect(fallingRockNote).toMatchObject({
      title: "Falling rock durability",
      intro:
        "Falling rocks and boulders now take at least two hits to destroy.",
    });
    expect(fallingRockNote?.changes.map((change) => change.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Falling and fallen rocks or boulders"),
        expect.stringContaining("ordinary rock"),
        expect.stringContaining("two-hit minimum"),
      ]),
    );
  });
});
