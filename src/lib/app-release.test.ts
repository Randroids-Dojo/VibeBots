import { describe, expect, it } from "vitest";
import { getAppRelease } from "./app-release";

describe("app release notes", () => {
  it("keeps the latest pickaxe swing cost note scoped to battery tuning", () => {
    const release = getAppRelease();
    const latestNote = release.notes[0];

    expect(release.noticeId).toBe("2026-06-20-0.1.93-pickaxe-swing-cost");
    expect(latestNote).toMatchObject({
      version: "0.1.93",
      title: "Pickaxe battery tuning",
      intro: "Stronger tools and richer ore now draw more battery.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Every Pickaxe level above 1 now adds a noticeable battery cost to each mining swing.",
      "Richer ores add their own battery strain, so ruby, diamond, and core-tier veins make Battery Cell upgrades matter sooner.",
      "The mine gameplay version moved to 45, and deep ore runs now push players toward Battery Cell upgrades too.",
    ]);
  });

  it("keeps the archived recall rope note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes.find((note) => note.version === "0.1.92");

    expect(latestNote).toMatchObject({
      version: "0.1.92",
      title: "Recall rope range",
      intro: "Recall ropes now scale with a permanent depth upgrade.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Base recall ropes can only pull from the shallow mine, starting at row 12.",
      "The new Recall Rope upgrade at the Upgrades stall raises the usable row limit through 30, 75, 180, 420, and 1000.",
      "The recovery menu disables Recall past your current range, and server replay verifies the same gear level before banking.",
    ]);
  });

  it("keeps the archived zoom placement note scoped to zoom placement", () => {
    const release = getAppRelease();
    const zoomPlacementNote = release.notes.find(
      (note) => note.version === "0.1.91",
    );

    expect(zoomPlacementNote).toMatchObject({
      version: "0.1.91",
      title: "Zoom placement fix",
      intro: "Mine zoom controls now sit under Settings.",
    });
    expect(zoomPlacementNote?.intro).not.toContain(
      "Mason, load your first save now.",
    );
    expect(zoomPlacementNote?.changes.map((change) => change.text)).toEqual([
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
