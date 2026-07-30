import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as tokens from "./mine-hud-tokens";

const PANEL_SOURCE = readFileSync(
  join(import.meta.dirname, "mine-panel.tsx"),
  "utf8",
);

/**
 * The six shared HUD style constants. These are the objects every chip,
 * icon button, and CTA in the mine spreads, so a literal that creeps
 * back into one of them silently forks the palette again.
 */
const SHARED_STYLE_CONSTANTS = [
  "chipStyle",
  "statusChipStyle",
  "compactChipStyle",
  "iconButtonStyle",
  "jumpButtonStyle",
  "zoomButtonStyle",
];

function styleConstantBody(name: string): string {
  const start = PANEL_SOURCE.indexOf(`const ${name}: React.CSSProperties = {`);
  expect(start, `${name} should exist in mine-panel.tsx`).toBeGreaterThan(-1);
  const end = PANEL_SOURCE.indexOf("\n};", start);
  expect(end, `${name} should be a closed object literal`).toBeGreaterThan(
    start,
  );
  return PANEL_SOURCE.slice(start, end);
}

describe("mine HUD tokens", () => {
  it("exposes every token as a non-empty value", () => {
    const entries = Object.entries(tokens);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, value] of entries) {
      expect(value, `${name} should be set`).toBeTruthy();
    }
  });

  it("has no duplicate colour values under two names", () => {
    const colours = Object.entries(tokens).filter(
      ([, value]) =>
        typeof value === "string" &&
        (value.startsWith("#") || value.startsWith("rgba(")),
    );
    const seen = new Map<string, string>();
    for (const [name, value] of colours) {
      const previous = seen.get(value as string);
      expect(
        previous,
        `${name} repeats the value already exported as ${previous}`,
      ).toBeUndefined();
      seen.set(value as string, name);
    }
  });

  it.each(
    SHARED_STYLE_CONSTANTS,
  )("%s carries no raw colour literal", (name) => {
    const body = styleConstantBody(name);
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/rgba?\(/);
  });

  it.each(SHARED_STYLE_CONSTANTS)("%s carries no raw font size", (name) => {
    const body = styleConstantBody(name);
    expect(body).not.toMatch(/fontSize:\s*"/);
  });
});
