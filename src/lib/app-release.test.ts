import { describe, expect, it } from "vitest";
import { getAppRelease } from "./app-release";

describe("app release notes", () => {
  it("keeps the latest zoom note complete with the save reminder", () => {
    const release = getAppRelease();
    const latestNote = release.notes[0];

    expect(release.noticeId).toBe("2026-06-20-0.1.87-mine-zoom-buttons");
    expect(latestNote).toMatchObject({
      version: "0.1.87",
      title: "Mine zoom buttons",
      intro:
        "Mason, load your first save now. The mine HUD now has direct zoom controls.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
      "The HUD now has on-screen zoom in and zoom out buttons in a clear camera dock for mouse, touch, and gamepad players who want direct camera control.",
      "Zoom out still caps at the active Lantern range, and each Lantern upgrade opens a meaningfully wider camera limit.",
      "The miner headlamp now scales with Lantern range so lit cells stay readable while the outer two-cell border keeps its dark falloff.",
    ]);
  });

  it("keeps the archived death cam note complete with the save reminder", () => {
    const release = getAppRelease();
    const deathCamNote = release.notes.find(
      (note) => note.version === "0.1.86",
    );

    expect(deathCamNote).toMatchObject({
      title: "Death cam fix",
      intro:
        "Mason, load your first save now. Death animations now stay inside the real mine view.",
    });
    expect(deathCamNote?.changes.map((change) => change.text)).toEqual([
      "Fatal falls and falling-rock crushes keep rendering the populated underground cells around the death.",
      "The trip report still waits until the fall or crush impact finishes, but the camera no longer shows a sudden empty void.",
      "Mine rules, recovery, and replay behavior are unchanged.",
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
