import { describe, expect, it } from "vitest";
import { getAppRelease } from "./app-release";

describe("app release notes", () => {
  it("keeps the latest bunker part drag note complete", () => {
    const release = getAppRelease();
    const latestNote = release.notes[0];

    expect(release.noticeId).toBe("2026-06-20-0.1.89-bunker-part-drag");
    expect(latestNote).toMatchObject({
      version: "0.1.89",
      title: "Bunker part drag",
      intro: "Base parts can now be selected and dragged into place.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "Double-click or double-tap a placed bunker part to select it in the mine view.",
      "Press and drag the selected part to another claimed bunker cell without spending or refunding inventory.",
      "Click or tap elsewhere to clear the selection before choosing another part.",
    ]);
  });

  it("keeps the archived death cam flash note complete with the save reminder", () => {
    const release = getAppRelease();
    const deathCamFlashNote = release.notes.find(
      (note) => note.version === "0.1.88",
    );

    expect(deathCamFlashNote).toMatchObject({
      title: "Death cam flash fix",
      intro:
        "Mason, load your first save now. Death animations now keep the mine filled from the first frame.",
    });
    expect(deathCamFlashNote?.changes.map((change) => change.text)).toEqual([
      "Fatal falls and falling-rock crushes now prepare the death camera before the browser paints the next frame.",
      "The camera no longer gets one frame ahead of the populated underground cell window, removing the brief void flash.",
      "Mine rules, recovery, and replay behavior are unchanged.",
    ]);
  });

  it("keeps the archived zoom note complete with the save reminder", () => {
    const release = getAppRelease();
    const zoomNote = release.notes.find((note) => note.version === "0.1.87");

    expect(zoomNote).toMatchObject({
      version: "0.1.87",
      title: "Mine zoom buttons",
      intro:
        "Mason, load your first save now. The mine HUD now has direct zoom controls.",
    });
    expect(zoomNote?.changes.map((change) => change.text)).toEqual([
      "The HUD now has on-screen zoom in and zoom out buttons in a clear camera dock for mouse, touch, and gamepad players who want direct camera control.",
      "Zoom out still caps at the active Lantern range, and each Lantern upgrade opens a meaningfully wider camera limit.",
      "The miner headlamp now scales with Lantern range so lit cells stay readable while the outer two-cell border keeps its dark falloff.",
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
