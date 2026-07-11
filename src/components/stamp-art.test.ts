import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_DEFINITIONS } from "@/lib/achievements";
import { hasStampArt, StampArt } from "./stamp-art";

function artMarkup(achievementId: string): string {
  return renderToStaticMarkup(
    createElement(StampArt, { achievementId, size: 64 }),
  );
}

/** Strips render-generated ids so only the drawn shapes are compared. */
function normalizedArt(achievementId: string): string {
  return artMarkup(achievementId)
    .replaceAll(/id="[^"]*"/g, "")
    .replaceAll(/url\(#[^)]*\)/g, "")
    .replaceAll(/<title>[^<]*<\/title>/g, "");
}

describe("stamp art catalog", () => {
  it("gives every achievement bespoke art", () => {
    for (const definition of ACHIEVEMENT_DEFINITIONS) {
      expect(hasStampArt(definition.id), `missing art: ${definition.id}`).toBe(
        true,
      );
    }
  });

  it("draws a unique pictogram for every stamp", () => {
    const drawings = ACHIEVEMENT_DEFINITIONS.map((definition) => ({
      id: definition.id,
      art: normalizedArt(definition.id),
    }));
    const seen = new Map<string, string>();
    for (const { id, art } of drawings) {
      const twin = seen.get(art);
      expect(twin, `${id} shares its art with ${twin}`).toBeUndefined();
      seen.set(art, id);
    }
  });

  it("renders a fallback stamp for unknown ids instead of throwing", () => {
    const markup = artMarkup("not-a-real-achievement");
    expect(markup).toContain("<svg");
    expect(markup).toContain("<circle");
  });

  it("respects the size prop while keeping one drawing grid", () => {
    const markup = renderToStaticMarkup(
      createElement(StampArt, { achievementId: "depth-first-chip", size: 56 }),
    );
    expect(markup).toContain('width="56"');
    expect(markup).toContain('height="56"');
    expect(markup).toContain('viewBox="0 0 64 64"');
  });
});
