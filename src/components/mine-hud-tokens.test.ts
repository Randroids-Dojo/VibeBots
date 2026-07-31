import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as tokens from "./mine-hud-tokens";

const ROOT = join(import.meta.dirname, "..");
const PALETTE = readFileSync(join(ROOT, "app/globals.css"), "utf8");

/**
 * Every place a custom property can be referenced: the stylesheets and the
 * mine components that write them into inline styles. Scoping the scan to
 * the token module (as an earlier version did) missed exactly the
 * hand-written references the components carry.
 */
function sourcesThatReferenceProperties(): { file: string; text: string }[] {
  const files: { file: string; text: string }[] = [];
  for (const name of readdirSync(join(ROOT, "app"))) {
    if (name.endsWith(".css")) {
      files.push({
        file: `app/${name}`,
        text: readFileSync(join(ROOT, "app", name), "utf8"),
      });
    }
  }
  for (const name of readdirSync(join(ROOT, "components"))) {
    if (!name.startsWith("mine-")) continue;
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    files.push({
      file: `components/${name}`,
      text: readFileSync(join(ROOT, "components", name), "utf8"),
    });
  }
  return files;
}

/**
 * Only the two namespaces the palette owns. Per-element properties such as
 * `--angle` are declared inline on the element that animates, so they are
 * correctly absent from the palette.
 */
const REFERENCE = /var\((--(?:hud|mine)-[a-z0-9-]+)\)/g;

describe("mine HUD palette", () => {
  it("resolves every custom property it references, everywhere", () => {
    // An undeclared property is silent: it resolves to nothing and the
    // control paints transparent rather than throwing. That is the whole
    // reason this is worth a test.
    const missing: string[] = [];
    for (const { file, text } of sourcesThatReferenceProperties()) {
      for (const name of new Set(
        [...text.matchAll(REFERENCE)].map((match) => match[1]),
      )) {
        if (!PALETTE.includes(`${name}:`)) missing.push(`${file} -> ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps shared colours in the palette, not in the token module", () => {
    // Tokens name the shared palette; a literal here would fork it again.
    // Colours with a single consumer and no stylesheet reader legitimately
    // stay next to that consumer, which is why this covers only the tokens.
    for (const [name, value] of Object.entries(tokens)) {
      if (typeof value !== "string") continue;
      expect(value, `${name} should reference the palette`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b/,
      );
      expect(value, `${name} should reference the palette`).not.toMatch(
        /rgba\(/,
      );
    }
  });
});
