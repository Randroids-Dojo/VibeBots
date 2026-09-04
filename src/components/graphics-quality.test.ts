import { describe, expect, it } from "vitest";
import {
  detectGraphicsQualityTier,
  detectSoftwareRenderer,
  graphicsFeaturesFor,
  isSoftwareRendererName,
  parseGraphicsQualitySetting,
  resetSoftwareRendererProbe,
  resolveGraphicsQualityTier,
} from "./graphics-quality";

describe("graphics quality tiers", () => {
  it("parses stored settings defensively", () => {
    expect(parseGraphicsQualitySetting(null)).toBe("auto");
    expect(parseGraphicsQualitySetting("garbage")).toBe("auto");
    expect(parseGraphicsQualitySetting("low")).toBe("low");
    expect(parseGraphicsQualitySetting("high")).toBe("high");
    expect(parseGraphicsQualitySetting("auto")).toBe("auto");
  });

  it("detects phones (coarse pointers) as the low tier", () => {
    expect(detectGraphicsQualityTier(true)).toBe("low");
    expect(detectGraphicsQualityTier(false)).toBe("high");
  });

  it("resolves auto by device and pins explicit settings", () => {
    expect(resolveGraphicsQualityTier("auto", true)).toBe("low");
    expect(resolveGraphicsQualityTier("auto", false)).toBe("high");
    expect(resolveGraphicsQualityTier("high", true)).toBe("high");
    expect(resolveGraphicsQualityTier("low", false)).toBe("low");
  });

  it("keeps the low tier stall-free", () => {
    const low = graphicsFeaturesFor("low");
    expect(low.shadows).toBe(false);
    // No runtime IBL on the WebGL2 phone path until the baked
    // environment lands (G2); runtime PMREM stalls that backend.
    expect(low.environmentIntensity).toBe(0);
    const high = graphicsFeaturesFor("high");
    expect(high.shadows).toBe(true);
    expect(high.environmentIntensity).toBeGreaterThan(0);
    expect(high.sunShadowMapSize).toBeGreaterThan(low.sunShadowMapSize);
    // The low tier caps device-pixel ratio below the high tier so the
    // WebGL2 phone path shades fewer pixels per frame (F-074/F-075).
    expect(low.maxDpr).toBeLessThan(high.maxDpr);
    expect(low.maxDpr).toBeGreaterThanOrEqual(1);
    // The accent-light pool overruns the low tier's frame budget
    // (real-phone telemetry: 25.0ms p95 with the pool's lights vs
    // 20.0ms without), so the pool is a non-low feature (F-077).
    expect(low.accentLights).toBe(false);
    expect(high.accentLights).toBe(true);
  });
});

describe("software renderers (red-main #360)", () => {
  it("names the software rasterizers and nothing else", () => {
    expect(isSoftwareRendererName("Google SwiftShader")).toBe(true);
    expect(
      isSoftwareRendererName(
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))",
      ),
    ).toBe(true);
    expect(isSoftwareRendererName("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(
      true,
    );
    expect(isSoftwareRendererName("Mesa OffScreen")).toBe(true);
    expect(isSoftwareRendererName("ANGLE (Apple, Apple M2, OpenGL 4.1)")).toBe(
      false,
    );
    expect(isSoftwareRendererName("Mali-G78")).toBe(false);
    expect(isSoftwareRendererName(null)).toBe(false);
  });

  it("drops auto to the low tier on a software renderer and leaves a pinned tier alone", () => {
    expect(resolveGraphicsQualityTier("auto", false, true)).toBe("low");
    expect(resolveGraphicsQualityTier("auto", false, false)).toBe("high");
    expect(resolveGraphicsQualityTier("high", false, true)).toBe("high");
    expect(resolveGraphicsQualityTier("low", false, false)).toBe("low");
  });

  it("probes once and never raises the tier when the probe fails", () => {
    resetSoftwareRendererProbe();
    const originalWindow = globalThis.window;
    (globalThis as { window?: unknown }).window = {};
    try {
      let calls = 0;
      const probe = () => {
        calls += 1;
        return "Google SwiftShader";
      };
      expect(detectSoftwareRenderer(probe)).toBe(true);
      expect(detectSoftwareRenderer(probe)).toBe(true);
      expect(calls).toBe(1);
      resetSoftwareRendererProbe();
      expect(
        detectSoftwareRenderer(() => {
          throw new Error("no canvas");
        }),
      ).toBe(false);
    } finally {
      resetSoftwareRendererProbe();
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
  });
});
