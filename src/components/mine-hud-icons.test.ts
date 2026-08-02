import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "./mine-hud-icons";

describe("mine HUD icons", () => {
  it("gives every icon its own glyph", () => {
    // This is the real regression guard: the settings button and the
    // hotbar tools slot once shipped as the SAME gear, so any two icons
    // sharing path data is the failure worth catching. Asserting on the
    // values catches it; the previous version compared two slices of the
    // source file, which could never be equal whatever the glyphs were.
    const paths = Object.values(ICON_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("draws each icon as path data and nothing else", () => {
    for (const [name, path] of Object.entries(ICON_PATHS)) {
      expect(path, `${name} should be SVG path data`).toMatch(/^M[\d\s.]/);
      // Colour belongs to the wrapper's currentColor, never to an icon.
      expect(path, `${name} should not name a colour`).not.toMatch(/#|rgba?\(/);
    }
  });
});
