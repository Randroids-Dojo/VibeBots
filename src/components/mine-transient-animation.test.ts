import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLANKER_BURST_VISIBLE_SECONDS,
  dissipatingOpacity,
  transientAnimationActive,
  transientAnimationProgress,
} from "./mine-transient-animation";

function readProjectFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function exportedFunctionBodies(source: string): Array<{
  name: string;
  body: string;
}> {
  const matches = Array.from(source.matchAll(/export function (\w+)/g));
  return matches.map((match, index) => {
    const next = matches[index + 1];
    return {
      name: match[1],
      body: source.slice(match.index, next?.index ?? source.length),
    };
  });
}

describe("mine transient animation lifetime contract", () => {
  it("keeps transient animation math bounded", () => {
    expect(CLANKER_BURST_VISIBLE_SECONDS).toBeGreaterThan(0);
    expect(transientAnimationActive(0, 1)).toBe(true);
    expect(transientAnimationActive(1, 1)).toBe(true);
    expect(transientAnimationActive(1.01, 1)).toBe(false);
    expect(transientAnimationProgress(-0.5, 1)).toBe(0);
    expect(transientAnimationProgress(0.5, 1)).toBe(0.5);
    expect(transientAnimationProgress(2, 1)).toBe(1);
    expect(dissipatingOpacity(0, 1)).toBe(1);
    expect(dissipatingOpacity(0.5, 1)).toBe(0.5);
    expect(dissipatingOpacity(2, 1)).toBe(0);
  });

  it("keeps Clanker self-destruct bursts finite and fading", () => {
    const overlay = readProjectFile("src/components/mine-bunker-overlay.tsx");

    expect(overlay).toContain("transientAnimationActive(");
    expect(overlay).toContain("transientAnimationProgress(");
    expect(overlay).toContain("dissipatingOpacity(");
    expect(overlay).toContain("setGroupMaterialOpacity(");
    expect(overlay).not.toMatch(
      /burstActive\s*=\s*dead\s*&&\s*clanker\.status\s*===\s*"self-destructed"\s*;/,
    );
  });

  it("keeps spawned mine particles on finite countdown life", () => {
    const particles = readProjectFile("src/components/mine-particles.ts");
    const canvas = readProjectFile("src/components/mine-canvas.tsx");
    const spawnBodies = exportedFunctionBodies(particles).filter(
      ({ body, name }) =>
        name.startsWith("spawn") && body.includes("pushParticle("),
    );

    expect(spawnBodies.map(({ name }) => name)).toEqual([
      "spawnBurst",
      "spawnDirtBreakBurst",
      "spawnSparks",
      "spawnClang",
      "spawnDust",
      "spawnFallWarning",
      "spawnLadderFall",
      "spawnOreGlitter",
      "spawnGasHiss",
    ]);
    for (const { name, body } of spawnBodies) {
      expect(body, `${name} must assign particle life`).toMatch(/\blife:\s*/);
      expect(body, `${name} must not create permanent particles`).not.toMatch(
        /\blife:\s*(?:Infinity|Number\.POSITIVE_INFINITY)/,
      );
    }
    expect(canvas).toContain("p.life -= delta");
    expect(canvas).toContain("p.life > 0");
  });

  it("keeps DOM burst and explosion effects finite and self clearing", () => {
    const css = readProjectFile("src/app/mine.css");
    const panel = readProjectFile("src/components/mine-panel.tsx");
    const animationBlocks = Array.from(
      css.matchAll(/([^{}]+)\{([^{}]+)\}/g),
    ).map((match) => ({
      selector: match[1],
      body: match[2],
    }));
    const permanentBurstBlocks = animationBlocks.filter(
      ({ selector, body }) => {
        return (
          /(?:burst|explosion)/i.test(selector) &&
          /(?:animation(?:-[\w-]+)?\s*:[^;]*infinite|animation-iteration-count\s*:\s*infinite)/i.test(
            body,
          )
        );
      },
    );

    expect(permanentBurstBlocks).toEqual([]);
    expect(css).toMatch(
      /\.mine-base-teleport-burst\s*\{[\s\S]*animation:\s*mine-base-teleport-burst\s+0\.7s\s+ease-out\s+forwards;/,
    );
    expect(css).toMatch(
      /\.mine-base-teleport-burst span\s*\{[\s\S]*animation:\s*mine-base-teleport-particle\s+0\.62s\s+ease-out\s+forwards;/,
    );
    expect(panel).toContain("onAnimationEnd={() => setTeleportBurstKey(0)}");
  });

  it("keeps stratum entry banners finite and fading", () => {
    const css = readProjectFile("src/app/mine.css");
    const panel = readProjectFile("src/components/mine-panel.tsx");

    expect(panel).toContain("const STRATUM_BANNER_MS = 2600;");
    expect(panel).toContain("bannerTimer.current = setTimeout(");
    expect(panel).toContain('className="mine-stratum-banner"');
    expect(panel).toContain("onAnimationEnd={() =>");
    expect(css).toMatch(
      /@keyframes mine-stratum-banner-fade\s*\{[\s\S]*0%\s*\{[\s\S]*opacity:\s*0;[\s\S]*12%\s*\{[\s\S]*opacity:\s*1;[\s\S]*55%\s*\{[\s\S]*opacity:\s*1;[\s\S]*100%\s*\{[\s\S]*opacity:\s*0;/,
    );
    expect(css).toMatch(
      /\.mine-stratum-banner\s*\{[\s\S]*animation:\s*mine-stratum-banner-fade\s+2600ms\s+ease-out\s+forwards;/,
    );
    expect(css).toMatch(
      /@keyframes mine-stratum-banner-fade\s*\{[\s\S]*0%\s*\{[\s\S]*transform:\s*translate\(-50%, -6px\) scale\(0\.98\);[\s\S]*100%\s*\{[\s\S]*transform:\s*translate\(-50%, -8px\) scale\(0\.98\);/,
    );
  });
});
