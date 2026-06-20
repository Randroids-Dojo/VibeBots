import { describe, expect, it } from "vitest";
import { getAppRelease } from "./app-release";

describe("app release notes", () => {
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
