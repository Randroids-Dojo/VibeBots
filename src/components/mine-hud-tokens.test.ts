import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as tokens from "./mine-hud-tokens";

const MINE_CSS = readFileSync(join(process.cwd(), "src/app/mine.css"), "utf8");

const VAR_REFERENCE = /^var\((--[a-z0-9-]+)\)$/;

/** Tokens whose value is a colour, shadow, or other palette reference. */
const paletteTokens = Object.entries(tokens).filter(
  ([, value]) => typeof value === "string" && value.startsWith("var("),
);

describe("mine HUD tokens", () => {
  it("exposes every token as a non-empty value", () => {
    const entries = Object.entries(tokens);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, value] of entries) {
      expect(value, `${name} should be set`).toBeTruthy();
    }
  });

  it("carries no raw colour literal, only palette references", () => {
    // A literal here would fork the palette away from mine.css again,
    // which is the duplication this module exists to remove.
    for (const [name, value] of Object.entries(tokens)) {
      if (typeof value !== "string") continue;
      expect(value, `${name} should not name a colour`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b/,
      );
      expect(value, `${name} should not name a colour`).not.toMatch(/rgba?\(/);
    }
  });

  it("names a custom property that mine.css actually declares", () => {
    // The failure this catches is a silent one: an undeclared var() falls
    // back to nothing, so the control renders transparent rather than
    // throwing.
    expect(paletteTokens.length).toBeGreaterThan(0);
    for (const [name, value] of paletteTokens) {
      const match = VAR_REFERENCE.exec(value as string);
      expect(match, `${name} should be a plain var() reference`).not.toBeNull();
      const property = match?.[1] ?? "";
      expect(
        MINE_CSS,
        `${property} (${name}) should be declared in mine.css`,
      ).toContain(`${property}:`);
    }
  });

  it("declares every palette property it references from another", () => {
    // The tint properties reference the base triplets; a renamed base
    // would leave those dangling the same silent way.
    const referenced = MINE_CSS.match(/var\((--hud-[a-z0-9-]+)\)/g) ?? [];
    for (const raw of referenced) {
      const property = raw.slice(4, -1);
      expect(MINE_CSS, `${property} should be declared`).toContain(
        `${property}:`,
      );
    }
  });
});
