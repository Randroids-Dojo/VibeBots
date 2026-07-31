import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HUD_ICON_NAMES } from "./mine-hud-icons";

const SOURCE = readFileSync(
  join(import.meta.dirname, "mine-hud-icons.tsx"),
  "utf8",
);

/** The path table, so assertions read the real data, not the whole file. */
const PATHS = SOURCE.slice(
  SOURCE.indexOf("const ICON_PATHS"),
  SOURCE.indexOf("export function HudIcon"),
);

describe("mine HUD icons", () => {
  it("ships an icon for every name it advertises", () => {
    expect(HUD_ICON_NAMES.length).toBeGreaterThan(0);
    for (const name of HUD_ICON_NAMES) {
      // Keys with a hyphen are quoted in the source.
      expect(PATHS, `${name} should have path data`).toMatch(
        new RegExp(`"?${name}"?:\\s*\n?\\s*"M`),
      );
    }
  });

  it("names no colour, so every icon tints with its control", () => {
    // The whole point of the set: state colour comes from `currentColor`
    // on the wrapper. A literal here would pin one icon to one state.
    expect(PATHS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(PATHS).not.toMatch(/rgba?\(/);
    expect(PATHS).not.toMatch(/\bfill=|\bstroke=/);
  });

  it("gives the settings gear and the tools slot different glyphs", () => {
    // Regression: both shipped as the same gear emoji, so the hotbar's
    // tools slot and the settings button were indistinguishable.
    const settings = PATHS.slice(PATHS.indexOf("settings:"));
    const tools = PATHS.slice(
      PATHS.indexOf("tools:"),
      PATHS.indexOf("beacon:"),
    );
    expect(settings).not.toBe(tools);
  });
});
