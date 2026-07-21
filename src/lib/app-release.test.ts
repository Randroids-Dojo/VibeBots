import { afterEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";
import { getAppRelease } from "./app-release";

describe("app release build id", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the baked build number over git", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_BUILD", "271234");
    const release = getAppRelease();
    expect(release.build).toBe(271234);
    expect(release.version).toBe(`${packageJson.version}.271234`);
  });

  it("falls back to the git commit count when the baked value is invalid", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_BUILD", "not-a-number");
    const release = getAppRelease();
    // Tests run inside a git checkout, so the fallback counts commits.
    expect(release.build).not.toBeNull();
    expect(release.build).toBeGreaterThan(0);
  });
});

describe("app release notes", () => {
  it("keeps the latest fresh-claim-ore note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes[0];

    expect(release.noticeId).toBe("2026-07-20-0.1.281-fresh-claim-ore");
    expect(latestNote).toMatchObject({
      version: "0.1.281",
      title: "Fresh-claim bunker ore counts too",
      intro:
        "Ore you dig in a bunker you just claimed now banks with the rest of your haul, and your cash-out screen counts it instead of quietly showing none.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "A freshly claimed bunker used to settle its ore into a bag of its own at the surface. Now it fills the same cargo bag as everything else you dig, so a claim-and-dig trip carries and banks as one haul, just like digging a bunker you already own.",
      "That also fixes a bunker-only cash-out that could read 'Sold no resources' while still adding vibes for that ore: the screen now names what you actually banked.",
    ]);
  });

  it("keeps the archived walkable-decks note complete", () => {
    const release = getAppRelease();
    const decksNote = release.notes.find((note) => note.version === "0.1.278");

    expect(decksNote).toMatchObject({
      version: "0.1.278",
      title: "Walk onto the floors you place",
      intro:
        "Placed floors are now thin decks you actually walk on, so stepping off a stair top onto your new floor works instead of hitting an invisible wall.",
    });
  });

  it("keeps the archived thin-walls note complete", () => {
    const release = getAppRelease();
    const wallsNote = release.notes.find((note) => note.version === "0.1.274");

    expect(wallsNote).toMatchObject({
      version: "0.1.274",
      title: "Build thin walls on the face you aim at",
      intro:
        "Inside a bunker in first person, aiming a wall, floor, or roof at a surface now builds a thin panel on that exact face instead of filling the whole cell.",
    });
  });

  it("keeps the archived fp-spawn note complete", () => {
    const release = getAppRelease();
    const spawnNote = release.notes.find((note) => note.version === "0.1.273");

    expect(spawnNote).toMatchObject({
      version: "0.1.273",
      title: "Spawn in the room, not inside the wall",
      intro:
        "Entering a bunker in first person now always drops you standing in the open starter room instead of stuck inside solid rock.",
    });
  });

  it("keeps the archived bunker-ore-backfill note complete", () => {
    const release = getAppRelease();
    const oreNote = release.notes.find((note) => note.version === "0.1.272");

    expect(oreNote).toMatchObject({
      version: "0.1.272",
      title: "Old bunkers show their ore again",
      intro:
        "A bunker claimed before the ore update was generating plain dirt with no ore. Opening it now fills in the mine's real dirt, rock, and ore.",
    });
    expect(oreNote?.changes.map((change) => change.text)).toEqual([
      "If you claimed a bunker before its walls started generating ore, it was stuck as solid dirt that paid nothing when you dug it, and even a reset did not fix it. Opening the bunker now fills in the ore it should have had, so its walls show the mine's dirt, rock, and ore for that depth and digging pays again.",
      "This only fills in ore that was missing. It never regrows ore you already mined, and it leaves any bunker that already had ore unchanged. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-layout-reset note complete", () => {
    const release = getAppRelease();
    const resetNote = release.notes.find((note) => note.version === "0.1.271");

    expect(resetNote).toMatchObject({
      version: "0.1.271",
      title: "Old bunkers need a fresh start",
      intro:
        "Bunkers built before the new build system now ask you to start fresh before you can build in them again.",
    });
    expect(resetNote?.changes.map((change) => change.text)).toEqual([
      "If your bunker was built under the old whole-block layout, it can no longer be edited as it is. Open the bunker sheet and it now shows a Start fresh button instead of the Enter button. Start fresh clears the old build and lets you build again under the new system, and it keeps every room you dug out, so you never lose your digging.",
      "Start fresh does not refund the parts from the old layout, since that layout is retired. Any bunker you claim from now on is already up to date, so this only affects bunkers from before the change. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-core-removed note complete", () => {
    const release = getAppRelease();
    const coreNote = release.notes.find((note) => note.version === "0.1.270");

    expect(coreNote).toMatchObject({
      version: "0.1.270",
      title: "The bunker core is gone",
      intro:
        "The pink diamond in the middle of your bunker is retired, freeing that cell to build in.",
    });
    expect(coreNote?.changes.map((change) => change.text)).toEqual([
      "The spinning core that sat in the center of every bunker is removed. It never did anything you could use, and it took up a buildable cell, so it is gone. The cell it stood in is now ordinary open space you can walk through, build on, or dig behind.",
      "Repairs now cover only your placed parts, since there is no core left to patch. Your saved bunkers are untouched: MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived first-person-raids-only note complete", () => {
    const release = getAppRelease();
    const raidsOnlyNote = release.notes.find(
      (note) => note.version === "0.1.269",
    );

    expect(raidsOnlyNote).toMatchObject({
      version: "0.1.269",
      title: "Raids are first-person only now",
      intro:
        "The flat Start-raid button is gone; you defend your bunker from inside.",
    });
    expect(raidsOnlyNote?.changes.map((change) => change.text)).toEqual([
      "The old flat raid, started from the bunker sheet and watched as a top-down replay, is retired. To raid now, stand in your claim, enter your bunker in first person, and start a live raid from inside, where the Clankers hunt you through your dug halls in real time.",
      "The bunker sheet keeps claiming, repairs, skins, and reset; only the raid moved inside. Your saved bunkers are untouched: MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived touch-raid-abandon note complete", () => {
    const release = getAppRelease();
    const abandonNote = release.notes.find(
      (note) => note.version === "0.1.268",
    );

    expect(abandonNote).toMatchObject({
      version: "0.1.268",
      title: "Abandon a live raid from your phone",
      intro:
        "The first-person raid HUD now has a way to leave a fight without a keyboard.",
    });
    expect(abandonNote?.changes.map((change) => change.text)).toEqual([
      "On a phone there is no Escape key, so a live raid now carries a Leave raid button in its HUD. It asks you to confirm before it drops you out, so a stray tap while you are fighting cannot cost you the raid.",
      "Confirming leaves and forfeits the raid, exactly like stepping out on desktop: no rewards, and it is gone when you come back. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived raid-forfeit-on-exit note complete", () => {
    const release = getAppRelease();
    const forfeitNote = release.notes.find(
      (note) => note.version === "0.1.267",
    );

    expect(forfeitNote).toMatchObject({
      version: "0.1.267",
      title: "Leaving a live raid now forfeits it",
      intro:
        "Walk out of a first-person raid mid-fight and it counts as a loss.",
    });
    expect(forfeitNote?.changes.map((change) => change.text)).toEqual([
      "Step out of the bunker while a live raid is still going and it now settles right away as a forfeit. The raid ends, you earn no rewards, and it is gone when you come back, instead of lingering until it timed out.",
      "That means you can no longer duck out of a raid that is going badly and re-enter to fight it again from the start. The choice to leave is final. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived fp-specialist-tints note complete", () => {
    const release = getAppRelease();
    const tintsNote = release.notes.find((note) => note.version === "0.1.266");

    expect(tintsNote).toMatchObject({
      version: "0.1.266",
      title: "Spot breachers and tanks in first person",
      intro:
        "Specialist Clankers now wear their colors inside a first-person raid.",
    });
    expect(tintsNote?.changes.map((change) => change.text)).toEqual([
      "Breachers and tanks now show their rust and armor shells when you fight a raid in first person, just like the flat view, so you can read a specialist coming down the hall and prioritize it instead of meeting every Clanker as an unknown.",
      "This is a visual change only; the raid plays out exactly as before. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived fp-live-raid note complete", () => {
    const release = getAppRelease();
    const raidNote = release.notes.find((note) => note.version === "0.1.265");

    expect(raidNote).toMatchObject({
      version: "0.1.265",
      title: "Fight a bunker raid from inside",
      intro:
        "Start a live raid in the first-person bunker and hold the Clankers off yourself.",
    });
    expect(raidNote?.changes.map((change) => change.text)).toEqual([
      "Standing inside your bunker in first person, a Start raid control now waits with a tier stepper. Begin the raid and the Clankers hunt you through your dug halls in real time while you stay in to defend, instead of watching a flat replay from the sheet.",
      "A banner tracks how many Clankers are left and your remaining time. Every Clanker that falls drops XP where it dies for you to collect by walking over it, and the raid ends the moment a Clanker reaches your cell or the whole wave is spent. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived fp-bunker-bag note complete", () => {
    const release = getAppRelease();
    const bagNote = release.notes.find((note) => note.version === "0.1.264");

    expect(bagNote).toMatchObject({
      version: "0.1.264",
      title: "Check your bag from inside the bunker",
      intro: "The first-person bunker HUD now shows and opens your cargo bag.",
    });
    expect(bagNote?.changes.map((change) => change.text)).toEqual([
      "A bag chip now rides in the top corner of the first-person bunker view, showing your carried ore and stack slots at a glance. Tap it to open the full bag, drop cargo, and read your haul without leaving the bunker.",
      "Opening the bag pauses your walking and digging behind it, and Escape closes the bag and drops you straight back into the view. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-block-art note complete", () => {
    const release = getAppRelease();
    const blockArtNote = release.notes.find(
      (note) => note.version === "0.1.263",
    );

    expect(blockArtNote).toMatchObject({
      version: "0.1.263",
      title: "Bunker walls show real dirt, rock, and ore",
      intro:
        "Your bunker interior now renders the mine's blocks instead of one flat gray.",
    });
    expect(blockArtNote?.changes.map((change) => change.text)).toEqual([
      "Undug bunker cells now render as the dirt, rock, and ore you would find in the mine at that exact depth, instead of a single flat gray. You can read the room at a glance and watch the stone turn richer the deeper you dig.",
      "Ore crystals now actually show in the walls at the mine's ore distribution for that depth, so you can spot a cell worth breaking before you swing. This is a visual change only; MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived groundbreaker-real-dig note complete", () => {
    const release = getAppRelease();
    const groundbreakerNote = release.notes.find(
      (note) => note.version === "0.1.262",
    );

    expect(groundbreakerNote).toMatchObject({
      version: "0.1.262",
      title: "Groundbreaker waits for a real dig",
      intro: "The first-dig bunker stamp no longer pops before you dig.",
    });
    expect(groundbreakerNote?.changes.map((change) => change.text)).toEqual([
      "Groundbreaker, the stamp for digging your first cell of bunker claim rock, no longer unlocks the moment you claim a bunker. It now counts only cells you actually dig out, not the pre-mined starter room, so it pops on your real first dig.",
      "Anyone who already earned it keeps it. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-ore note complete", () => {
    const release = getAppRelease();
    const oreNote = release.notes.find((note) => note.version === "0.1.261");

    expect(oreNote).toMatchObject({
      version: "0.1.261",
      title: "Dig your bunker for ore, not just space",
      intro: "Every block you dig out of your bunker now pays ore.",
    });
    expect(oreNote?.changes.map((change) => change.text)).toEqual([
      "Blocks you dig out of your bunker now drop the same ore their depth would pay on the surface, and deeper rooms carry richer ore. Ore veins glint in the walls so you can see what a cell is worth before you break it.",
      "Ore dug on a trip rides home in your bag and banks with your surface haul, capped to one bagful of bunker ore per cash-out. Whatever overflows stays as a glinting pile at the cell that you walk over in first person to collect.",
      "A banked bunker pays dug ore straight to your vibes with no bag cap. The pre-mined starter room never pays. MINE_VERSION advances to 56; SIM_VERSION stays at 5.",
    ]);
  });

  it("keeps the archived roomier-bunker-spawn note complete", () => {
    const release = getAppRelease();
    const spawnNote = release.notes.find((note) => note.version === "0.1.260");

    expect(spawnNote).toMatchObject({
      version: "0.1.260",
      title: "Stand up in a roomier bunker spawn",
      intro: "A fresh claim now opens into a room you can stand up in.",
    });
    expect(spawnNote?.changes.map((change) => change.text)).toEqual([
      "A fresh bunker claim now carves a taller, deeper starter room (three cells wide, tall, and deep) so you spawn standing with headroom overhead and space before the working face, instead of pressed inside a cramped pocket.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-claim-bank-fix note complete", () => {
    const release = getAppRelease();
    const bankFixNote = release.notes.find(
      (note) => note.version === "0.1.259",
    );

    expect(bankFixNote).toMatchObject({
      version: "0.1.259",
      title: "Save a bunker you just claimed",
      intro: "Cashing out now keeps a bunker you claimed on the same dive.",
    });
    expect(bankFixNote?.changes.map((change) => change.text)).toEqual([
      "Claiming a bunker and cashing out on the same trip now saves the claim instead of failing at the surface. The pre-mined starter room no longer trips the cash-out check.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived call-and-choose elevator note complete", () => {
    const release = getAppRelease();
    const elevatorCallNote = release.notes.find(
      (note) => note.version === "0.1.258",
    );

    expect(elevatorCallNote).toMatchObject({
      version: "0.1.258",
      title: "Call the elevator, then choose your destination",
      intro: "The car comes to your floor before you choose the top or bottom.",
    });
    expect(elevatorCallNote?.changes.map((change) => change.text)).toEqual([
      "Enter the shaft at any owned rail row to call the car. It travels visibly to your floor, then the miner boards instead of falling or snapping down the shaft.",
      "Once aboard, choose Up for the surface or Down for the rail bottom. The surface shows only Down, the bottom shows only Up, and rows between them show both arrows.",
      "The selected ride is free, logged, and continues automatically to its endpoint. Surface arrival banks the carry, interrupted travel resumes in the selected direction, Ride the Rail recognizes a completed trip either way, MINE_VERSION advances to 55, and SIM_VERSION stays at 5.",
    ]);
  });

  it("keeps the archived dig-out-bunker note complete", () => {
    const release = getAppRelease();
    const digNote = release.notes.find((note) => note.version === "0.1.257");

    expect(digNote).toMatchObject({
      version: "0.1.257",
      title: "Dig your bunker out of solid rock",
      intro:
        "A fresh claim is a small room in the rock, and the floor digs too.",
    });
    expect(digNote?.changes.map((change) => change.text)).toEqual([
      "A fresh bunker claim now drops you into a small pre-mined room instead of a wide open plane. Everything around it, including the floor under your feet, is solid claim rock you dig out cell by cell to carve the shape you want.",
      "The floor plane is diggable now, so you can sink rooms below the entry as well as tunnel deeper into the rock.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived placeable-elevator note complete", () => {
    const release = getAppRelease();
    const elevatorNote = release.notes.find(
      (note) => note.version === "0.1.256",
    );

    expect(elevatorNote).toMatchObject({
      version: "0.1.256",
      title: "Put your elevator where you want it",
      intro: "Choose the shaft, then extend it one premium rail at a time.",
    });
    expect(elevatorNote?.changes.map((change) => change.text)).toEqual([
      "Buy the first 25-vibe rail at any surface column to anchor one persistent shaft. Each later purchase adds one row at a depth-scaled premium, keeping rail meaningfully more expensive than ladders.",
      "Press Down over the shaft at the surface or walk into its rail from either side underground. The car boards you safely before gravity runs and carries you automatically to the rail bottom.",
      "Existing elevator owners get one free shaft placement that preserves every rail they already bought. MINE_VERSION advances to 54; SIM_VERSION stays at 5.",
    ]);
  });

  it("keeps the archived hold-to-mine note complete", () => {
    const release = getAppRelease();
    const holdNote = release.notes.find((note) => note.version === "0.1.255");

    expect(holdNote).toMatchObject({
      version: "0.1.255",
      title: "Swing the pickaxe and hold to dig",
      intro: "The pick swings at the block, and holding the dig keeps mining.",
    });
    expect(holdNote?.changes.map((change) => change.text)).toEqual([
      "Digging in the bunker now swings a pickaxe at the block you are aiming at. Hold the dig and it keeps swinging, so you can drag your aim across the claim rock and mine cell after cell without tapping each one. Reach stays about three blocks ahead.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived pick-first note complete", () => {
    const release = getAppRelease();
    const pickNote = release.notes.find((note) => note.version === "0.1.254");

    expect(pickNote).toMatchObject({
      version: "0.1.254",
      title: "Step inside with the pick already out",
      intro: "Entering the bunker arms the pick so you can dig right away.",
    });
    expect(pickNote?.changes.map((change) => change.text)).toEqual([
      "Walking into the bunker now hands you the pick instead of a wall, because digging out the deep claim rock is the first thing to do in a fresh claim. Tap a part slot whenever you are ready to build.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived pry-refund note complete", () => {
    const release = getAppRelease();
    const pryNote = release.notes.find((note) => note.version === "0.1.253");

    expect(pryNote).toMatchObject({
      version: "0.1.253",
      title: "Pry straight back to your pack",
      intro: "One press pries a part loose and returns it, ready for the next.",
    });
    expect(pryNote?.changes.map((change) => change.text)).toEqual([
      "Prying a part now drops it straight back into your pack instead of carrying it on the crosshair. Pry one part after another with no stow step in between, then place from stock whenever you want it somewhere new.",
      "A damaged part will not pry until you repair it from the Bunker sheet, so its wear can never be laundered away.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-tutorial note complete", () => {
    const release = getAppRelease();
    const tutorialNote = release.notes.find(
      (note) => note.version === "0.1.252",
    );

    expect(tutorialNote).toMatchObject({
      version: "0.1.252",
      title: "The bunker teaches itself",
      intro: "A step-by-step walkthrough the first time you go inside.",
    });
    expect(tutorialNote?.changes.map((change) => change.text)).toEqual([
      "Your first time inside the bunker now walks you through everything one card at a time: look, walk, dig, place, and pry, each advancing a moment after you actually do it. Skip a step or the whole thing any time.",
      "Want it again later? Replay bunker tutorial lives in the settings gear, and the cards return the next time you enter.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived hammer-retirement note complete", () => {
    const release = getAppRelease();
    const retireNote = release.notes.find((note) => note.version === "0.1.251");

    expect(retireNote).toMatchObject({
      version: "0.1.251",
      title: "One way to build: walk inside",
      intro: "The flat-view build cursor retires; first person is the builder.",
    });
    expect(retireNote?.changes.map((change) => change.text)).toEqual([
      "Building now happens inside the bunker only. The flat view keeps claiming, raids, repairs, skins, and a single Enter bunker button; the old part-cursor controls and scaffold walk are gone, so the arrow keys always just move the miner.",
      "First person no longer shows the mine's flat-view controls on top of the scene, and if your base has you boxed in, a hint now says exactly how to pry free or reset.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived fp-polish note complete", () => {
    const release = getAppRelease();
    const polishNote = release.notes.find((note) => note.version === "0.1.250");

    expect(polishNote).toMatchObject({
      version: "0.1.250",
      title: "Pry with a long press, land with a view",
      intro: "Touch polish for building inside the bunker.",
    });
    expect(polishNote?.changes.map((change) => change.text)).toEqual([
      "Hold a touch on any placed part to pry it loose, whatever tool you have out. A quick tap still acts with the current tool.",
      "Entering the bunker now greets you with the floor and a warm work light instead of a face full of rock, and the whole first-person loop measured allocation-clean so phones stay smooth.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived reset-autojump note complete", () => {
    const release = getAppRelease();
    const resetNote = release.notes.find((note) => note.version === "0.1.249");

    expect(resetNote).toMatchObject({
      version: "0.1.249",
      title: "Reset your bunker, hop like you expect",
      intro: "Two fixes straight from a phone playtest.",
    });
    expect(resetNote?.changes.map((change) => change.text)).toEqual([
      "Boxed in by a base built the old flat way? Reset bunker in the bunker sheet returns every undamaged part to your inventory, clears the layout and dug rock, and restores the core so you can rebuild room-style from inside. Two taps to confirm, never during a raid.",
      "First-person walking now hops one-block steps automatically on touch, and the mystery arrow button is gone. Space still jumps on desktop. The bunker sheet's bottom rows also no longer hide under the toolbelt.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived fp-building note complete", () => {
    const release = getAppRelease();
    const buildNote = release.notes.find((note) => note.version === "0.1.248");

    expect(buildNote).toMatchObject({
      version: "0.1.248",
      title: "Dig and build inside your bunker",
      intro: "First person gets hands: pick, parts, and prying.",
    });
    expect(buildNote?.changes.map((change) => change.text)).toEqual([
      "The first-person hotbar now carries your pick and parts: dig the deep claim rock cell by cell at the crosshair, place parts into open cells with a ghost preview, and pry placed parts to carry them somewhere better. Tap to act on touch, click on desktop.",
      "Your first dig earns the new Groundbreaker stamp. Dug before this landed? The Stamp Book already counts it.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived first-person note complete", () => {
    const release = getAppRelease();
    const fpNote = release.notes.find((note) => note.version === "0.1.247");

    expect(fpNote).toMatchObject({
      version: "0.1.247",
      title: "Step inside your bunker",
      intro: "Your claim opens in first person: walk it from the inside.",
    });
    expect(fpNote?.changes.map((change) => change.text)).toEqual([
      "Standing inside your claim, tap Enter bunker on the builder toolbelt or the bunker sheet (or press F) to switch into a first-person view of the interior. Walk with the stick or WASD, look by dragging or with the mouse, hop with the jump button or Space, and exit any time.",
      "The four deeper layers show as solid claim rock for now. Digging them out and building by hand in first person arrive in the next releases.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived excavation note complete", () => {
    const release = getAppRelease();
    const digNote = release.notes.find((note) => note.version === "0.1.246");

    expect(digNote).toMatchObject({
      version: "0.1.246",
      title: "The bunker's deep rock learns to be dug",
      intro: "Third groundwork slice: excavation exists, server-verified.",
    });
    expect(digNote?.changes.map((change) => change.text)).toEqual([
      "The four deep layers of every bunker claim now exist as solid rock, excavated cell by cell through a new server action. Every dig must chain from an already-open face, and the server replays your dig order to prove it.",
      "Parts can no longer be placed inside undug rock. Nothing visible changes yet: the first-person mode that uses all of this is next.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived depth-apis note complete", () => {
    const release = getAppRelease();
    const apisNote = release.notes.find((note) => note.version === "0.1.245");

    expect(apisNote).toMatchObject({
      version: "0.1.245",
      title: "Bunker building wires up the depth layers",
      intro: "Second groundwork slice: the pipes now carry depth.",
    });
    expect(apisNote?.changes.map((change) => change.text)).toEqual([
      "Placing, removing, and moving bunker parts now carries a depth layer end to end, from the client through the server. Nothing visible uses it yet: the first-person building mode arrives in upcoming releases.",
      "A pending bunker claim can bank up to 174 placed parts, one for every buildable cell of the coming 7x5x5 volume.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-depth note complete", () => {
    const release = getAppRelease();
    const depthNote = release.notes.find((note) => note.version === "0.1.244");

    expect(depthNote).toMatchObject({
      version: "0.1.244",
      title: "The bunker learns a third dimension",
      intro: "Groundwork for building deeper. Nothing visible changes yet.",
    });
    expect(depthNote?.changes.map((change) => change.text)).toEqual([
      "Bunker parts and the core now carry a depth coordinate under the hood, preparing the claim to grow from a flat 7x5 wall into a 7x5x5 room you will walk inside and build out first-person.",
      "Existing bunkers, saves, and raids are untouched: everything you placed sits on the tunnel plane and raids resolve exactly as before.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived stride-glide note complete", () => {
    const release = getAppRelease();
    const strideNote = release.notes.find((note) => note.version === "0.1.243");

    expect(strideNote).toMatchObject({
      version: "0.1.243",
      title: "Walking flows instead of stuttering",
      intro: "Held moves glide through cells; the camera keeps up exactly.",
    });
    expect(strideNote?.changes.map((change) => change.text)).toEqual([
      "Holding a direction now strides through cell boundaries on one continuous glide instead of stopping at every cell. Single taps keep their soft settle, and speed is unchanged.",
      "The camera moves on the miner's own step timing, so it no longer runs ahead and waits at every cell.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived tap-buffer note complete", () => {
    const release = getAppRelease();
    const bufferNote = release.notes.find((note) => note.version === "0.1.242");

    expect(bufferNote).toMatchObject({
      version: "0.1.242",
      title: "Taps land instead of vanishing",
      intro: "Movement keeps its pace but stops eating your inputs.",
    });
    expect(bufferNote?.changes.map((change) => change.text)).toEqual([
      "A tap that lands while the previous move is still finishing is now remembered and fires the instant it legally can, instead of doing nothing. Only the newest tap is kept, and tapping fast is still exactly the same speed as holding.",
      "Changed your mind? Tapping the opposite direction cancels a remembered move before it happens.",
      "Holding Up now keeps mining a ceiling without re-pressing for every swing. Planting a ladder still always takes a deliberate fresh press, so a held key can never spend ladders or carry you upward on its own.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived Fire TV physical-controls note complete", () => {
    const release = getAppRelease();
    const tvNote = release.notes.find((note) => note.version === "0.1.241");

    expect(tvNote).toMatchObject({
      version: "0.1.241",
      title: "Use the remote buttons to move in the mine",
      intro: "Fire TV players can try physical movement before the TV deck.",
    });
    expect(tvNote?.changes.map((change) => change.text)).toEqual([
      "On Fire TV, Channel Up and Channel Down move vertically while Rewind and Fast Forward move left and right. Play/Pause still fires the jump jets.",
      "Select keeps clicking the item under Silk's cursor, and Back keeps its browser-history role so open menus can intercept it safely. Neither button is repurposed for movement.",
      "The large TV control deck remains available as a fallback when a Silk version or television withholds a channel key. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived directional bunker-building note complete", () => {
    const release = getAppRelease();
    const bunkerNote = release.notes.find((note) => note.version === "0.1.240");

    expect(bunkerNote).toMatchObject({
      version: "0.1.240",
      title: "Point where the bunker part should go",
      intro:
        "Building now uses the mine controls instead of a second swing button.",
    });
    expect(bunkerNote?.changes.map((change) => change.text)).toEqual([
      "Select a bunker part, then point or swipe in any of eight directions. The miner walks across the temporary scaffold, gets into range, and hammers the chosen cell automatically.",
      "Each part grows into place across four visible hammer strikes, like mining in reverse. Pry uses the same directional flow to lift and relocate an existing part.",
      "There is no Equip or Swing button. Deselect the part and every direction immediately returns to ordinary mine movement. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived stamp-shortcut note complete", () => {
    const release = getAppRelease();
    const stampNote = release.notes.find((note) => note.version === "0.1.239");

    expect(stampNote).toMatchObject({
      version: "0.1.239",
      title: "Stamp alerts lead straight to the Stamp Book",
      intro: "Tap a fresh stamp to see it in its place in the collection.",
    });
  });

  it("keeps the archived camera-space-sky note complete", () => {
    const release = getAppRelease();
    const skyNote = release.notes.find((note) => note.version === "0.1.238");

    expect(skyNote).toMatchObject({
      version: "0.1.238",
      title: "The planet stays put",
      intro: "The sky no longer slides after each surface step.",
    });
    expect(skyNote?.changes.map((change) => change.text)).toEqual([
      "The ringed planet, sky, and stars now render in camera space with zero translational parallax. They use the camera's final transform for the current frame, so camera smoothing cannot make them chase the miner.",
      "Only earthbound scenery moves: far excavation, machinery, and the near berm use simple linear depth rates with no extra easing, lag, or position-dependent curve.",
      "An exact Pixel test walks from Base +16 to +17 and proves the visible planet pixels keep the same count and centroid. Draw calls, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived fire-tv-controls note complete", () => {
    const release = getAppRelease();
    const tvNote = release.notes.find((note) => note.version === "0.1.237");

    expect(tvNote).toMatchObject({
      version: "0.1.237",
      title: "Play the whole mine from a TV remote",
      intro: "Fire TV sessions get remote-native controls.",
    });
    expect(tvNote?.changes.map((change) => change.text)).toEqual([
      "Opening the game in the Fire TV Silk browser now shows a TV control deck: big direction buttons where one click is one move, and holding Select keeps digging. No more dragging the thumbstick with the cursor.",
      "The deck's center button walks you into the Workshop or Battles when you stand on their door, and fires the jump jets everywhere else.",
      "The remote's Back button now closes open menus, sheets, and the bag instead of leaving the game. Play/Pause jumps, and Rewind and Fast Forward zoom the camera.",
      "A paired game controller can play the mine too: the D-pad walks and digs, and A enters buildings or jumps. Add ?tv=1 to the address on any other TV browser to force the deck on.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived parallax-depth note complete", () => {
    const release = getAppRelease();
    const parallaxNote = release.notes.find(
      (note) => note.version === "0.1.236",
    );

    expect(parallaxNote).toMatchObject({
      version: "0.1.236",
      title: "The horizon has real depth",
      intro: "The landscape now separates into calm, believable distances.",
    });
    expect(parallaxNote?.changes.map((change) => change.text)).toEqual([
      "The planet now barely drifts while the excavation, mining machinery, and service berm move at progressively stronger depth rates. The scenery no longer feels attached to the miner.",
      "Each layer eases into a bounded travel range, keeping the ringed planet and industrial skyline composed while walking to distant biomes. Reduced motion still locks the vista to the viewport.",
      "The correction adds no geometry, draw calls, materials, or frame allocations. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived load-animation note complete", () => {
    const release = getAppRelease();
    const loadNote = release.notes.find((note) => note.version === "0.1.235");

    expect(loadNote).toMatchObject({
      version: "0.1.235",
      title: "The mine loads behind the cart, not a black screen",
      intro: "The loading animation now stays up until the first real frame.",
    });
  });

  it("keeps the archived surface-basin note complete", () => {
    const release = getAppRelease();
    const basinNote = release.notes.find((note) => note.version === "0.1.234");

    expect(basinNote).toMatchObject({
      version: "0.1.234",
      title: "A world beyond the village",
      intro: "A ringed planet now hangs over a working strip-mine basin.",
    });
    expect(basinNote?.changes.map((change) => change.text)).toEqual([
      "The flat surface horizon is replaced by a ringed planet, terraced excavation cuts, conveyors, bucket-wheel machinery, distant gantries, and a service berm behind the village.",
      "Five cached low-poly layers follow the existing day and night cycle and move at restrained depth-based parallax rates while you walk. Reduced motion keeps the full composition still.",
      "The low tier uses 568 backdrop triangles and the high tier 1,080. The scene adds four net draw calls, no textures, no lights, and no frame allocations. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived connector-removal note complete", () => {
    const release = getAppRelease();
    const connectorNote = release.notes.find(
      (note) => note.version === "0.1.233",
    );

    expect(connectorNote).toMatchObject({
      version: "0.1.233",
      title: "The bars are gone",
      intro: "Rocks and blocks stand on their own again.",
    });
    expect(connectorNote?.changes.map((change) => change.text)).toEqual([
      "Every soil-colored bridge and corner patch between occupied mine cells has been removed. Boulders, rocks, dirt, metal, caches, and ore now show only their own authored geometry.",
      "The cave backing now owns the negative space between shapes at every zoom. An exact Pixel test checks adjacent boulders, dirt, and rock, and fails if connector geometry returns.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-balance note complete", () => {
    const release = getAppRelease();
    const balanceNote = release.notes.find(
      (note) => note.version === "0.1.232",
    );

    expect(balanceNote).toMatchObject({
      version: "0.1.232",
      title: "The bunker sheet shows what you can spend",
      intro: "Your vibes balance sits next to every priced button.",
    });
    expect(balanceNote?.changes.map((change) => change.text)).toEqual([
      "The bunker sheet now shows your spendable vibes right above the repair and skin buttons, and the total updates the moment a purchase lands.",
      "Repairs and skins you cannot afford are greyed out and say how many more vibes they need, instead of failing after the tap.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-skins note complete", () => {
    const release = getAppRelease();
    const skinsNote = release.notes.find((note) => note.version === "0.1.231");

    expect(skinsNote).toMatchObject({
      version: "0.1.231",
      title: "Dress your bunker in new colors",
      intro: "Cosmetic skins repaint every placed part, paid in vibes.",
    });
    expect(skinsNote?.changes.map((change) => change.text)).toEqual([
      "The bunker sheet gains a skin picker: Steelworks stays the free riveted gunmetal, Gilded (120 vibes) brings brass plate and warm lamplight, and Verdant (80 vibes) goes patinated copper and moss glass. A bought skin is yours forever and reselects free.",
      "Skins are pure paint. Durability, raids, and rewards play out exactly the same in every finish.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bunker-repairs note complete", () => {
    const release = getAppRelease();
    const repairsNote = release.notes.find(
      (note) => note.version === "0.1.230",
    );

    expect(repairsNote).toMatchObject({
      version: "0.1.230",
      title: "Patch the bunker up between raids",
      intro: "One button repairs every chewed wall, and stacked rooms hold.",
    });
    expect(repairsNote?.changes.map((change) => change.text)).toEqual([
      "The bunker sheet gains a Repair button whenever something is damaged: it restores every part and the core in one tap, priced by the damage (a full restore costs about half the part's shop price) and paid in vibes. Repairs wait until the raid is over.",
      "Two-story bunkers are official: an interior floor row splits the claim into stacked rooms, and a sealed two-room layout holds a raid exactly like a single room.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived specialist-clankers note complete", () => {
    const release = getAppRelease();
    const specialistNote = release.notes.find(
      (note) => note.version === "0.1.229",
    );

    expect(specialistNote).toMatchObject({
      version: "0.1.229",
      title: "The raids send specialists",
      intro: "Higher tiers now field breachers and tanks with their own looks.",
    });
    expect(specialistNote?.changes.map((change) => change.text)).toEqual([
      "From tier 2, every third Clanker is a rust-shelled breacher that bites your walls twice as hard. From tier 3, every fourth is an armored tank that shrugs off one turret shot and falls to the second. Both drop extra defense XP when you stop them.",
      "Specialist slots are deterministic per wave, so the same raid always replays the same, and older raid records read back unchanged.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived raid-tiers note complete", () => {
    const release = getAppRelease();
    const tiersNote = release.notes.find((note) => note.version === "0.1.228");

    expect(tiersNote).toMatchObject({
      version: "0.1.228",
      title: "Pick your raid, pick your fight",
      intro: "Higher bunker raid tiers unlock as your player level grows.",
    });
    expect(tiersNote?.changes.map((change) => change.text)).toEqual([
      "The raid button now carries a tier stepper once your level unlocks tier 2. Each tier adds two more Clankers and gives every one of them a longer battery and a harder bite, and a bigger wave means more defense XP on the ground when you hold them off.",
      "One tier unlocks per player level, up to tier 5. The server enforces the gate, and raids replay deterministically at every tier.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived mine-load-gate note complete", () => {
    const release = getAppRelease();
    const loadGateNote = release.notes.find(
      (note) => note.version === "0.1.227",
    );

    expect(loadGateNote).toMatchObject({
      version: "0.1.227",
      title: "The mine loads without locking your phone",
      intro: "The session-start freeze becomes a brief backdrop beat.",
    });
    expect(loadGateNote?.changes.map((change) => change.text)).toEqual([
      "Opening the mine used to freeze the page while every material compiled on the first frame, up to twelve seconds cache-cold on phones. The mine now holds its first frame until that compile finishes in the background, with a four second safety valve, the same cure the Holodeck entry got.",
      "The change is render-timing only: saves, moves, and world rules are untouched.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived accent-tier-gate note complete", () => {
    const release = getAppRelease();
    const accentGateNote = release.notes.find(
      (note) => note.version === "0.1.226",
    );

    expect(accentGateNote).toMatchObject({
      version: "0.1.226",
      title: "Smoother frames on phones, glow where it fits",
      intro:
        "The emitter glow now steps aside on devices that cannot afford it.",
    });
    expect(accentGateNote?.changes.map((change) => change.text)).toEqual([
      "Real-device telemetry showed the new accent lights costing about five milliseconds per frame on low-tier phones, so the glow pool now runs only on the higher graphics tiers. Phones keep their full frame budget; the light count still never changes mid-session on any device.",
      "The same telemetry confirmed the first-descent fix: phone sessions on that build show the smoothest profile recorded, with no descent freezes.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived mastery-stamps note complete", () => {
    const release = getAppRelease();
    const masteryNote = release.notes.find(
      (note) => note.version === "0.1.225",
    );

    expect(masteryNote).toMatchObject({
      version: "0.1.225",
      title: "Stamps for chassis mastery and maxed parts",
      intro: "The Stamp Book now honors builders and chassis explorers.",
    });
    expect(masteryNote?.changes.map((change) => change.text)).toEqual([
      "Chassis Tour: fight an official match with every core chassis (Cube, Wedge, and Tower). Your past matches already count: every verified fight recorded which core you fielded, so this one backfills.",
      "Mastercrafted: save a design fielding a part merged to Lv 3. Existing saved designs count, so master builders unlock it on their next visit.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived ore-band-floor note complete", () => {
    const release = getAppRelease();
    const oreNote = release.notes.find((note) => note.version === "0.1.224");

    expect(oreNote).toMatchObject({
      version: "0.1.224",
      title: "Ore bands fade out instead of cutting out",
      intro: "The bottom edge of every ore band is no longer a dead row.",
    });
    expect(oreNote?.changes.map((change) => change.text)).toEqual([
      "Each ore's spawn chance used to taper all the way to zero exactly at its band's last row, then jump back up to the deep trace chance one row later. The fade now settles onto the trace floor smoothly, so the boundary row carries ore again and the hand-off into trace territory has no seam.",
      "This changes world generation, so MINE_VERSION advances to 53: fresh trips see the new bands; saved worlds keep the cells you already dug.",
      "SIM_VERSION is unchanged.",
    ]);
  });

  it("keeps the archived workshop-feel note complete", () => {
    const release = getAppRelease();
    const workshopNote = release.notes.find(
      (note) => note.version === "0.1.223",
    );

    expect(workshopNote).toMatchObject({
      version: "0.1.223",
      title: "The workshop clicks, chimes, and tidies up",
      intro: "Building your bot now sounds and reads like one bench.",
    });
    expect(workshopNote?.changes.map((change) => change.text)).toEqual([
      "Placing a part lands with a short mechanical snap and merging two parts rings a brighter two-note chime, matching the visual snap and merge bump the bench already had. The sounds are synthesized on device, so nothing new downloads.",
      "On phones, the part name and browse arrows now lift clear of the part-details card when it opens, so the controls and the card never sit on top of each other.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived hammer-builder note complete", () => {
    const release = getAppRelease();
    const hammerNote = release.notes.find((note) => note.version === "0.1.222");

    expect(hammerNote).toMatchObject({
      version: "0.1.222",
      title: "Build bunkers with your own two hands",
      intro:
        "A hammer, a part belt, and a temporary gantry replace the old builder menus.",
    });
    expect(hammerNote?.changes.map((change) => change.text)).toEqual([
      "Equip the bunker hammer inside your claim, choose a part, and swing toward an adjacent cell to build. Pry mode lifts an existing part into your hands so you can carry it to a new cell or put it back without losing durability.",
      "The hammer raises a temporary orange scaffold across the claim, so normal movement controls can carry you horizontally or vertically while you work. Stowing the hammer safely settles the miner before the scaffold disappears.",
      "The large movement pad and builder mode menus are gone. Bunker status, claim, raid, and progression information remain in a compact sheet. MINE_VERSION advances to 52; SIM_VERSION is unchanged.",
    ]);
  });

  it("keeps the archived survival-stamps note complete", () => {
    const release = getAppRelease();
    const survivalNote = release.notes.find(
      (note) => note.version === "0.1.221",
    );

    expect(survivalNote).toMatchObject({
      version: "0.1.221",
      title: "Two stamps for surviving the deep",
      intro: "The Stamp Book now honors roof rescues and close escapes.",
    });
    expect(survivalNote?.changes.map((change) => change.text)).toEqual([
      "Hold the Ceiling: re-prop a condemned roof with a plank before it falls. Walked Away: be within two columns of a roof collapse when it crashes down and live to tell it. Both count from real replayed trips, so only runs cashed out from this release onward can prove them.",
      "Trips now report roof rescues and collapses survived alongside the other cash-out records; the counters are observational and change no mining rules.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived holodeck-smooth-entry note complete", () => {
    const release = getAppRelease();
    const holodeckNote = release.notes.find(
      (note) => note.version === "0.1.220",
    );

    expect(holodeckNote).toMatchObject({
      version: "0.1.220",
      title: "The Holodeck opens without a freeze",
      intro: "Entering the Holodeck no longer locks the page while it builds.",
    });
    expect(holodeckNote?.changes.map((change) => change.text)).toEqual([
      "Walking into the Holodeck from the mine used to freeze everything for the moment the whole stage compiled its draw programs at once: the longest first-view hang of any screen in our telemetry. The stage now builds its programs in the background and starts animating the instant they are ready, so the page stays responsive on the way in.",
      "The full Holodeck browser suite (motion, pause and resume, showcase clips, camera, village bench, shift cycle, Warp ring) passes against the gated start.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived adjacency seam note complete", () => {
    const release = getAppRelease();
    const seamNote = release.notes.find((note) => note.version === "0.1.219");

    expect(seamNote).toMatchObject({
      version: "0.1.219",
      title: "Open shapes, solid seams",
      intro: "Boulders and mined openings are irregular again.",
    });
    expect(seamNote?.changes.map((change) => change.text)).toEqual([
      "The dirt square behind every occupied cell was not an acceptable fix. Full-cell plates are gone. Narrow soil bridges now appear only along an edge shared by two solid cells, and a tiny corner patch appears only inside a completely occupied 2x2 junction.",
      "Isolated boulders, rocks, caches, and blocks now keep open cave darkness around their real silhouette. Dense walls still close the Pixel-density cracks between genuinely adjacent cells, including at maximum zoom.",
      "The two small seam batches use background compilation instead of blocking startup warm-up. Pixel tests mutation-check both failures. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived accent-glow note complete", () => {
    const release = getAppRelease();
    const accentNote = release.notes.find((note) => note.version === "0.1.218");

    expect(accentNote).toMatchObject({
      version: "0.1.218",
      title: "The glow comes back to the dark",
      intro: "Beacons, bags, dynamite, and portals cast real light again.",
    });
    expect(accentNote?.changes.map((change) => change.text)).toEqual([
      "The local glow those emitters cast on nearby blocks was removed while fixing the recompile freezes, because lights entering and leaving the view forced the whole scene to rebuild its draw programs. A fixed pool of three always-present lights now follows the nearest emitters instead, so the warmth returns without ever changing the light count.",
      "A new browser test proves a planted warp beacon claims a pool light as you approach and releases it as you leave, with the pool itself never mounting or unmounting.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived Pixel visibility note complete", () => {
    const release = getAppRelease();
    const pixelNote = release.notes.find((note) => note.version === "0.1.217");

    expect(pixelNote).toMatchObject({
      version: "0.1.217",
      title: "Clear ground at every zoom",
      intro: "Pixel-density cracks are filled, and zooming out stays useful.",
    });
    expect(pixelNote?.changes.map((change) => change.text)).toEqual([
      "The Pixel rendering path exposed real black channels and corner wedges between rounded cells, especially at maximum zoom. Occupied cells now receive a shared soil-colored joint behind their authored body, and the artificial black bevel multiplier is gone, so the mine keeps natural depth without exposing the cave backing.",
      "Zooming out no longer turns daylight atmosphere into a cyan screen wash or shrinks the useful Lantern area. Atmosphere distance and the Lantern projection now scale with each camera step, while surface daylight and underground visibility keep their separate rules.",
      "The regression now runs at the measured Pixel profile: 448x923, DPR 2.25, touch, low-tier WebGL2, and all three zoom levels. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived smooth-first-descent note complete", () => {
    const release = getAppRelease();
    const descentNote = release.notes.find(
      (note) => note.version === "0.1.216",
    );

    expect(descentNote).toMatchObject({
      version: "0.1.216",
      title: "New ground loads without a hitch",
      intro: "Reaching fresh depths no longer freezes the frame.",
    });
    expect(descentNote?.changes.map((change) => change.text)).toEqual([
      "The first time a new kind of block scrolled into view, the game paused to build its draw program on the spot: the last one-time hitch left on a first descent. New block batches now compile in the background and appear a moment later instead of stalling the picture.",
      "The shader-churn regression test tightened its first-crossing budget from 30 background compiles to 3, and re-crossing a stratum still compiles nothing.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived opaque-cell-seams note complete", () => {
    const release = getAppRelease();
    const seamsNote = release.notes.find((note) => note.version === "0.1.215");

    expect(seamsNote).toMatchObject({
      version: "0.1.215",
      title: "The cracks finally stay dark",
      intro: "Daylight no longer colors the spaces between mine blocks.",
    });
    expect(seamsNote?.changes.map((change) => change.text)).toEqual([
      "The previous correction stopped the headlamp from lighting the cave backing, but daylight fog still recolored that black plane cyan through real geometry gaps. The backing is now explicitly fog-free, opaque, and physically constrained below the surface instead of relying on shader transparency, so the authored sky stays visible while every underground gap stays black on the phone WebGL2 path.",
      "A new 390x760 daylight pixel regression samples the true center-right cell gap. It fails against the faulty render at RGB 130 and passes below RGB 16 with the fix, while the existing day/night, depth, visibility, and draw-budget contracts remain unchanged.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived buttoned-up-stamp note complete", () => {
    const release = getAppRelease();
    const buttonedUpNote = release.notes.find(
      (note) => note.version === "0.1.214",
    );

    expect(buttonedUpNote).toMatchObject({
      version: "0.1.214",
      title: "A stamp for a bunker that holds",
      intro: "Seal the player cell, survive the raid, earn Buttoned Up.",
    });
    expect(buttonedUpNote?.changes.map((change) => change.text)).toEqual([
      "New Stamp Book entry: Buttoned Up. Survive a Clanker raid with the player cell fully sealed (no open route for anything to even target it) and the stamp pops with its own sealed-room art. Only raids fought from this release can prove a seal, so it starts fresh for everyone.",
      "The raid report now calls out when the seal held, and the stamp alert takes it from there.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived dark-cell-seams note complete", () => {
    const release = getAppRelease();
    const darkSeamsNote = release.notes.find(
      (note) => note.version === "0.1.213",
    );

    expect(darkSeamsNote).toMatchObject({
      version: "0.1.213",
      title: "Darkness stays in the cracks",
      intro: "The lantern no longer shines through the mine grid.",
    });
    expect(darkSeamsNote?.changes.map((change) => change.text)).toEqual([
      "The warm lines between blocks were not intentional. Cell gaps exposed a standard-lit cave backing, so the headlamp illuminated the background through every crack. The underground backing is now unlit and near-black while remaining transparent above the ground line, preserving the surface sky.",
      "Rounded dirt and metal sidewalls now absorb grazing light instead of reflecting it into continuous grid lines. Front faces keep their authored Lantern response, the seamless radial veil is unchanged, and the correction adds no lights or draw calls.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived surface shift-cycle note complete", () => {
    const release = getAppRelease();
    const shiftCycleNote = release.notes.find(
      (note) => note.version === "0.1.209",
    );

    expect(shiftCycleNote).toMatchObject({
      version: "0.1.209",
      title: "The surface keeps time",
      intro: "Dawn breaks over the village, and the night shift still glows.",
    });
    expect(shiftCycleNote?.changes.map((change) => change.text)).toEqual([
      "The surface now runs a full eight-minute shift cycle through cold starlight, copper dawn, a clear workday, and a long safety-orange dusk. The sky, horizon fog, sun and moon direction, shadows, metal reflections, ground bounce, and batched star field all move through one coordinated grade while the village's cyan power and warm work lights take over after dark.",
      "The cycle reuses the existing light rig, adds no lights or production draw calls, and updates its palette only four times per second. Reduced-motion settings freeze the accelerated cycle to local time, and underground lighting stays on the miner's lamp as before.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived stratum-freeze note complete", () => {
    const release = getAppRelease();
    const stratumFreezeNote = release.notes.find(
      (note) => note.version === "0.1.208",
    );

    expect(stratumFreezeNote).toMatchObject({
      version: "0.1.208",
      title: "The stratum hiccup, caught red-handed",
      intro: "Crossing a depth band no longer freezes the frame.",
    });
    expect(stratumFreezeNote?.changes.map((change) => change.text)).toEqual([
      "Real-phone telemetry showed a 2-3 second freeze every time the miner crossed a stratum boundary (rows 12, 24, 36) or came back to the surface, on every single crossing. The cause: the scene rebuilt its fog and background color objects at each boundary, which silently threw away and recompiled every visible shader program. The fog and background now update in place, and a new automated test counts real shader compiles across crossings to keep it that way: re-crossing a boundary now compiles exactly zero.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived village-clearance note complete", () => {
    const release = getAppRelease();
    const villageClearanceNote = release.notes.find(
      (note) => note.version === "0.1.207",
    );

    expect(villageClearanceNote).toMatchObject({
      version: "0.1.207",
      title: "The village keeps its hands off the miner",
      intro: "No more walking through the new buildings.",
    });
    expect(villageClearanceNote?.changes.map((change) => change.text)).toEqual([
      "The rebuilt settlement had pieces crossing the miner's walking line: the headframe's splayed derrick legs, the lit doormats at every entrance, the warp pad's raised rim, the service deck's glow strips, and the shaft lamp posts all sliced through the robot. Every solid now stays behind the walk line, the warp pad sits flush with the deck, and a geometry test keeps anything from reaching into the miner's space again, standing or jumping.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived stamp-alerts note complete", () => {
    const release = getAppRelease();
    const stampAlertsNote = release.notes.find(
      (note) => note.version === "0.1.206",
    );

    expect(stampAlertsNote).toMatchObject({
      version: "0.1.206",
      title: "Every stamp gets its moment",
      intro: "Collecting a stamp now pops a little celebration.",
    });
    expect(stampAlertsNote?.changes.map((change) => change.text)).toEqual([
      "All 38 stamps in the Stamp Book now carry their own hand-drawn postage-stamp art instead of a lettered code, with a color per category and a unique picture per stamp.",
      "The moment you earn a stamp, an alert slams onto the screen with the stamp's art and name, holds for a beat, and clears itself. Earn several at once and they take turns.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived surface-village note complete", () => {
    const release = getAppRelease();
    const surfaceVillageNote = release.notes.find(
      (note) => note.version === "0.1.205",
    );

    expect(surfaceVillageNote).toMatchObject({
      version: "0.1.205",
      title: "Night shift, rebuilt",
      intro: "The surface village is now one industrial future settlement.",
    });
    expect(surfaceVillageNote?.changes.map((change) => change.text)).toEqual([
      "Workshop, Elevator, Hardware Store, the mine headframe, Supply Depot, Upgrades, Warp Pad, and Battles now use one professional hard-surface language: graphite armor, titanium frames, safety-orange machinery, cyan power, warm entrances, and distinct functional silhouettes.",
      "A segmented service deck and visible power conduit connect the row. Readable mesh emblems replace blank sign panels, while the existing names, prompts, routes, and building columns stay exactly where players know them.",
      "The Warp Pad ring turns and pulses slowly as the village's only ambient motion. Reduced-motion settings stop it completely, and settlement-wide material batching cuts the full review scene to 10 draw calls or fewer.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived mine-animation note complete", () => {
    const release = getAppRelease();
    const mineAnimationNote = release.notes.find(
      (note) => note.version === "0.1.204",
    );

    expect(mineAnimationNote).toMatchObject({
      version: "0.1.204",
      title: "Falls, boosters, and a brighter dig",
      intro: "The miner moves like it means it, and the dark reads right.",
    });
    expect(mineAnimationNote?.changes.map((change) => change.text)).toEqual([
      "Jumps fire visible rocket boosters, an ordinary fall now reads as a fall with a landing bounce, and running out of battery plays a power-down before the trip report. The lantern glow is a proper circle again, clearer underground and calmer on desktop. Keyboard players get Shift+Up to jump, Shift+Down to drop through a plank, and Enter and Escape to walk into and out of buildings. The first rows of a dig carry more ore, and bot fights happen in a tighter walled ring that bounces the brawlers back in.",
      "MINE_VERSION and SIM_VERSION advanced, so a run started on the old rules cannot cash out on the new ones.",
    ]);
  });

  it("keeps the archived gc-hitches note complete", () => {
    const release = getAppRelease();
    const gcNote = release.notes.find((note) => note.version === "0.1.200");

    expect(gcNote).toMatchObject({
      version: "0.1.200",
      title: "Fewer freezes while digging",
      intro: "A memory-churn fix for multi-second hitches.",
    });
    expect(gcNote?.changes.map((change) => change.text)).toEqual([
      "Telemetry from a real phone showed the mine freezing for one to six seconds when the browser paused to collect garbage. The mine's frame loop no longer creates throwaway memory every frame (miner pose, glide sampling, particle bookkeeping, diagnostics), so those freezes hit far less often, especially on phones and on low battery.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived save-sync note complete", () => {
    const release = getAppRelease();
    const saveSyncNote = release.notes.find(
      (note) => note.version === "0.1.199",
    );

    expect(saveSyncNote).toMatchObject({
      version: "0.1.199",
      title: "Two devices, one save",
      intro: "The game now warns when your cloud save moves ahead.",
    });
    expect(saveSyncNote?.changes.map((change) => change.text)).toEqual([
      "Playing the same Google-linked save on two devices no longer ends in a surprise error. When another device banks a run first, this device now notices as soon as you return to it or start digging, and asks whether to sync to the newer save (dropping the doomed run early) or keep playing. Runs still cannot be merged, so syncing sooner loses less.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived perf-root-cause note complete", () => {
    const release = getAppRelease();
    const rootCauseNote = release.notes.find(
      (note) => note.version === "0.1.198",
    );

    expect(rootCauseNote).toMatchObject({
      version: "0.1.198",
      title: "Sharper slowdown reports",
      intro: "Performance telemetry can now explain stalls.",
    });
    expect(rootCauseNote?.changes.map((change) => change.text)).toEqual([
      "When the optional Performance telemetry toggle is on, reports now also include network request timing (page addresses only, never full links), memory swings, and time the game spent in the background, so one-off freezes can be traced to their real cause. The toggle stays off by default.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived performance-telemetry note complete", () => {
    const release = getAppRelease();
    const telemetryNote = release.notes.find(
      (note) => note.version === "0.1.197",
    );

    expect(telemetryNote).toMatchObject({
      version: "0.1.197",
      title: "Help us fix slowdowns",
      intro: "An optional performance telemetry toggle.",
    });
    expect(telemetryNote?.changes.map((change) => change.text)).toEqual([
      "The settings menu has a new optional Performance telemetry toggle. It is off by default. When you turn it on, the game records frame timings, scene statistics, and device info while you play and sends them back so slowdowns on your exact device can be found and fixed. Turn it off any time from the same menu.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bot-lifts-for-menus note complete", () => {
    const release = getAppRelease();
    const liftNote = release.notes.find((note) => note.version === "0.1.196");

    expect(liftNote).toMatchObject({
      version: "0.1.196",
      title: "Your bot rises for menus",
      intro: "See the bot while a menu is open.",
    });
    expect(liftNote?.changes.map((change) => change.text)).toEqual([
      "When you open a taller menu (Tune, Garage, or Shop), your bot now lifts up into the space above the sheet instead of hiding behind it, so you can see the whole bot while you work. Build is unchanged: the bot and the part in hand stay exactly where they were.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived bot-first workshop note complete", () => {
    const release = getAppRelease();
    const sheetNote = release.notes.find((note) => note.version === "0.1.195");

    expect(sheetNote).toMatchObject({
      version: "0.1.195",
      title: "The workshop is bot-first",
      intro: "See your whole bot, not a stack of menus.",
    });
    expect(sheetNote?.changes.map((change) => change.text)).toEqual([
      "The Build, Tune, Garage, and Shop controls now live in a bottom sheet you can slide down (or tap the handle) to reveal your whole bot. Build lands with the sheet tucked away so the bot, the part carousel, and the drag-to-build band are always clear.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived armor-and-bar note complete", () => {
    const release = getAppRelease();
    const barNote = release.notes.find((note) => note.version === "0.1.194");

    expect(barNote).toMatchObject({
      version: "0.1.194",
      title: "Armor and a bar spinner",
      intro: "Two new parts in the shop.",
    });
    expect(barNote?.changes.map((change) => change.text)).toEqual([
      "The shop now stocks a Hardened Plate, a tough heavy armor deck that soaks hits before they reach the core, and a Spinner Bar, a dense steel bar that mounts on a Spin Mount and hits harder than the saw disc at the cost of more power to spin.",
      "MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived fight records note complete", () => {
    const release = getAppRelease();
    const recordsNote = release.notes.find(
      (note) => note.version === "0.1.164",
    );

    expect(recordsNote).toMatchObject({
      version: "0.1.164",
      title: "Fight records",
      intro: "Verified wins go on the books.",
    });
    expect(recordsNote?.changes.map((change) => change.text)).toEqual([
      "Every server-verified workshop fight is recorded, and your win-loss record shows up right after verification.",
      "Three battle stamps join the Stamp Book: First Blood, Pit Veteran, and Buzzkill for winning with a saw blade mounted.",
      "Records only count verified fights; exhibitions stay casual. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived temperament note complete", () => {
    const release = getAppRelease();
    const temperNote = release.notes.find((note) => note.version === "0.1.163");

    expect(temperNote).toMatchObject({
      version: "0.1.163",
      title: "Bot temperament",
      intro: "Your bot fights its own way now.",
    });
    expect(temperNote?.changes.map((change) => change.text)).toEqual([
      "Three temperament sliders in the workshop shape how your bot fights on its own: aggression, flanking, and patience.",
      "The stock fighters got personalities to match their builds: the Bulldozer shoves relentlessly while the Whirligig darts wide to bring its saw in.",
      "Neutral sliders reproduce the classic fighting style exactly, so existing bots behave the same until you tune them. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived saw blades note complete", () => {
    const release = getAppRelease();
    const sawNote = release.notes.find((note) => note.version === "0.1.162");

    expect(sawNote).toMatchObject({
      version: "0.1.162",
      title: "Saw blades",
      intro: "The first powered weapon spins into the arena.",
    });
    expect(sawNote?.changes.map((change) => change.text)).toEqual([
      "The Spin Mount and Saw Blade arrive in the shop: bolt the mount to your bot's nose and its blade spins up on its own motor, shredding whatever it touches.",
      "A new stock fighter, the Whirligig, brings the saw to exhibition matches, which now rotate through four matchups.",
      "Powered axles are a new simulation capability, so SIM_VERSION steps to 4; older replays re-simulate under their original version. MINE_VERSION is unchanged.",
    ]);
  });

  it("keeps the archived parts shipment note complete", () => {
    const release = getAppRelease();
    const partsNote = release.notes.find((note) => note.version === "0.1.161");

    expect(partsNote).toMatchObject({
      version: "0.1.161",
      title: "New parts shipment",
      intro: "Five new robot parts hit the workshop shop.",
    });
    expect(partsNote?.changes.map((change) => change.text)).toEqual([
      "Plow Blade, Hammer Head, Armor Wedge, Roller Drum, and Mast Pole: wide pushers, top-heavy strikers, sacrificial armor, low tracked drums, and tall character masts.",
      "A new stock heavy, the Bulldozer, joins the arena, and exhibition matches now rotate through different matchups.",
      "Every new part fights under the same deterministic match rules. MINE_VERSION and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived arena fight night note complete", () => {
    const release = getAppRelease();
    const fightNote = release.notes.find((note) => note.version === "0.1.160");

    expect(fightNote).toMatchObject({
      version: "0.1.160",
      title: "Arena fight night",
      intro: "Battles became a show worth watching.",
    });
    expect(fightNote?.changes.map((change) => change.text)).toEqual([
      "Matches open with a countdown, the camera rides the action close, and every hit throws sparks, with big bursts when a part is destroyed.",
      "The arena became a lit stage: a concrete pit with barrier walls, a center ring, corner glow in each fighter's color, and real material surfaces on every part that scar as they take damage.",
      "Match rules and outcomes are unchanged, and so are MINE_VERSION and SIM_VERSION.",
    ]);
  });

  it("keeps the archived playtest polish note complete", () => {
    const release = getAppRelease();
    const polishNote = release.notes.find((note) => note.version === "0.1.159");

    expect(polishNote).toMatchObject({
      version: "0.1.159",
      title: "Playtest polish",
      intro: "Three fixes straight from playtesting.",
    });
    expect(polishNote?.changes.map((change) => change.text)).toEqual([
      "Getting crushed no longer squashes the miner into a pancake: the bot crumples with buckled knees and a dropped pick.",
      "The miner's feet now stand on the surface grass instead of sinking shin-deep into the first row of dirt.",
      "The Holodeck camera is yours on mobile: pinch to zoom, swipe to pan, double-tap to recenter. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived juicier breaks note complete", () => {
    const release = getAppRelease();
    const juiceNote = release.notes.find((note) => note.version === "0.1.158");

    expect(juiceNote).toMatchObject({
      version: "0.1.158",
      title: "Juicier breaks",
      intro: "Digging feedback got richer and faster.",
    });
    expect(juiceNote?.changes.map((change) => change.text)).toEqual([
      "Breaking an ore now showers sparkles in its color, with the rare glowing tiers lingering longest, and venting a gas pocket sends up a rising hiss of fumes.",
      "The particle engine was rebuilt to draw every burst in three batches instead of hundreds of separate pieces, so heavy digging stays smooth.",
      "Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived village note complete", () => {
    const release = getAppRelease();
    const villageNote = release.notes.find(
      (note) => note.version === "0.1.157",
    );

    expect(villageNote).toMatchObject({
      version: "0.1.157",
      title: "The village dressed up",
      intro: "Surface shops got real materials and lived-in clutter.",
    });
    expect(villageNote?.changes.map((change) => change.text)).toEqual([
      "Shop walls now read as quarried stone, sawn timber shows its wood grain, and metal trim catches the light.",
      "Crates, barrels, and grain sacks settle between the stalls, each cluster a little different.",
      "Same fast path on phones. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived gem-grade ores note complete", () => {
    const release = getAppRelease();
    const oresNote = release.notes.find((note) => note.version === "0.1.156");

    expect(oresNote).toMatchObject({
      version: "0.1.156",
      title: "Gem-grade ores",
      intro: "Ore crystals now look worth digging for.",
    });
    expect(oresNote?.changes.map((change) => change.text)).toEqual([
      "Every ore's crystals became glassy faceted clusters with lit edges: coal reads as dark chunks, copper as warm nuggets, and the rare glowing tiers now breathe with light.",
      "Richer clusters per block, still unique per cell, and phones keep their fast path.",
      "Mine rules, ore values, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived living blocks note complete", () => {
    const release = getAppRelease();
    const blocksNote = release.notes.find((note) => note.version === "0.1.155");

    expect(blocksNote).toMatchObject({
      version: "0.1.155",
      title: "Living blocks",
      intro: "The mine's blocks got real surfaces.",
    });
    expect(blocksNote?.changes.map((change) => change.text)).toEqual([
      "Dirt now shows soil grain and grit, rock carries crag striations with a cool sheen, bedrock metal is brushed steel, and gas pockets churn, all rendered per block with no two alike.",
      "The detail runs in the shader on capable devices and steps back to the classic flat look on phones, so nothing gets slower.",
      "A Holodeck Block Gallery lines up every block kind for a close look. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived lighting foundation note complete", () => {
    const release = getAppRelease();
    const lightingNote = release.notes.find(
      (note) => note.version === "0.1.154",
    );

    expect(lightingNote).toMatchObject({
      version: "0.1.154",
      title: "Real light in the mine",
      intro: "Shadows and studio lighting land on the surface.",
    });
    expect(lightingNote?.changes.map((change) => change.text)).toEqual([
      "The sun now casts soft real-time shadows across the surface village, and a studio environment gives every surface, metal, and crystal true ambient light and reflections.",
      "The lighting fades as you descend, so the deep mine keeps its lamp-lit darkness.",
      "A graphics quality tier keeps phones fast: the low tier skips the heavy passes automatically. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived miner model note complete", () => {
    const release = getAppRelease();
    const modelNote = release.notes.find((note) => note.version === "0.1.153");

    expect(modelNote).toMatchObject({
      version: "0.1.153",
      title: "Miner glow-up",
      intro: "The mining robot got a full visual overhaul.",
    });
    expect(modelNote?.changes.map((change) => change.text)).toEqual([
      "The miner was rebuilt: armored hull with rim lighting, an animated chest screen and breathing visor, a bright headlamp lens, a backpack battery with glowing charge bars, a blinking beacon, toe caps, and a second arm bracing the walk.",
      "The pick gained a twin-blade steel head, and every surface uses new materials that read in the dark on both the WebGPU and WebGL paths.",
      "The Holodeck Miner Showcase camera now dollies in close for inspection, and stratum banners always finish their fade on slow devices. Mine rules, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived miner showcase note complete", () => {
    const release = getAppRelease();
    const showcaseNote = release.notes.find(
      (note) => note.version === "0.1.152",
    );

    expect(showcaseNote).toMatchObject({
      version: "0.1.152",
      title: "Miner Showcase",
      intro: "A Holodeck stage shows off the miner's moves.",
    });
    expect(showcaseNote?.changes.map((change) => change.text)).toEqual([
      "The Holodeck gained a Miner Showcase scenario: the robot on an empty stage with an animation selector (idle, walk, dig, rebuff, crush) and a turntable to inspect it from every angle.",
      "The miner's animation now runs through one shared rig everywhere, so the Holodeck plays the exact moves you see in the mine.",
      "Mine rules, world generation, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived crash report timing note complete", () => {
    const release = getAppRelease();
    const crashNote = release.notes.find((note) => note.version === "0.1.151");

    expect(crashNote).toMatchObject({
      version: "0.1.151",
      title: "Crash reports wait for the crash",
      intro: "Fatal falls and crushes finish on screen before the report.",
    });
    expect(crashNote?.changes.map((change) => change.text)).toEqual([
      "The trip report after a fatal fall or falling-rock crush now waits for the visible impact instead of racing it on a timer, so slow devices no longer see the report before the crash lands.",
      "If the scene cannot render the impact at all, the report still arrives after a short safety delay.",
      "Mine rules, world generation, MINE_VERSION, and SIM_VERSION are unchanged.",
    ]);
  });

  it("keeps the archived holodeck note complete", () => {
    const release = getAppRelease();
    const holodeckNote = release.notes.find(
      (note) => note.version === "0.1.150",
    );

    expect(holodeckNote).toMatchObject({
      version: "0.1.150",
      title: "Holodeck test scenes",
      intro: "A new Holodeck mode loads focused, looping mine test scenes.",
    });
    expect(holodeckNote?.changes.map((change) => change.text)).toEqual([
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
