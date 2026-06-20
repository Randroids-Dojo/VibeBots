import { describe, expect, it } from "vitest";
import { getAppRelease } from "./app-release";

describe("app release notes", () => {
  it("keeps the latest death cam note complete with the save reminder", () => {
    const release = getAppRelease();
    const latestNote = release.notes[0];

    expect(release.noticeId).toBe("2026-06-20-0.1.86-death-cam-save-reminder");
    expect(latestNote).toMatchObject({
      version: "0.1.86",
      title: "Death cam fix",
      intro:
        "Mason, load your first save now. Death animations now stay inside the real mine view.",
    });
    expect(latestNote?.changes.map((change) => change.text)).toEqual([
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
