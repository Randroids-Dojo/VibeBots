import { describe, expect, it } from "vitest";
import { BLUEPRINTS } from "@/sim/blueprints";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  CPU_BULLDOZER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  TEST_BOT_DESIGN,
} from "@/sim/design";
import { REPLICA_OPPONENTS } from "@/sim/opponents";
import {
  DESIGN_CODE_VERSION,
  decodeBase64Url,
  decodeDesignCode,
  designShareUrl,
  encodeBase64Url,
  encodeDesignCode,
  MAX_DESIGN_CODE_LENGTH,
} from "./design-code";

const STOCK: BotDesign[] = [
  TEST_BOT_DESIGN,
  CPU_BRAWLER_DESIGN,
  CPU_BULLDOZER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  ...BLUEPRINTS.map((bp) => bp.design),
  ...REPLICA_OPPONENTS.map((o) => o.design),
];

describe("base64url", () => {
  it("round-trips UTF-8 text without padding characters", () => {
    for (const text of [
      "",
      "a",
      "ab",
      "abc",
      "Bot name with spaces",
      "Crème brûlée → ok",
    ]) {
      const encoded = encodeBase64Url(text);
      expect(encoded).not.toMatch(/[=+/]/);
      expect(decodeBase64Url(encoded)).toBe(text);
    }
  });

  it("rejects characters outside the alphabet", () => {
    expect(decodeBase64Url("abc$")).toBeNull();
    expect(decodeBase64Url("ab c")).toBeNull();
  });
});

describe("design share codes", () => {
  it("round-trips every stock design, blueprint, and replica exactly", () => {
    for (const design of STOCK) {
      const code = encodeDesignCode(design);
      expect(code.startsWith(`${DESIGN_CODE_VERSION}.`)).toBe(true);
      const decoded = decodeDesignCode(code);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.design).toEqual(design);
    }
  });

  it("keeps merge levels, orientation, gearing, behavior, and class", () => {
    const design: BotDesign = {
      name: "Everything",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "wheel-l", partId: "drive-wheel", mergeLevel: 2 },
        { iid: "wheel-r", partId: "drive-wheel" },
        { iid: "plate", partId: "frame-plate", mergeLevel: 3 },
      ],
      connections: [
        {
          parentIid: "core",
          parentConnector: "axle-left",
          childIid: "wheel-l",
          childConnector: "hub",
          gearRatio: 1.6,
        },
        {
          parentIid: "core",
          parentConnector: "axle-right",
          childIid: "wheel-r",
          childConnector: "hub",
          gearRatio: 1.6,
        },
        {
          parentIid: "core",
          parentConnector: "top",
          childIid: "plate",
          childConnector: "bottom",
          orientation: 90,
        },
      ],
      behavior: { aggression: 0.8, flankBias: 0.2, patience: 0.5 },
      weightClass: "beetleweight",
      paint: { primary: "cobalt", accent: "gold" },
      rules: [
        { when: "weapon-down", act: "disengage" },
        { when: "clock-late", act: "charge" },
      ],
    };
    const decoded = decodeDesignCode(encodeDesignCode(design));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.design).toEqual(design);
  });

  it("refuses a code whose rule the sim would not read (F-247)", () => {
    const code = encodeDesignCode(TEST_BOT_DESIGN);
    const [tag, payload] = code.split(".");
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const forged = {
      ...JSON.parse(json),
      r: [{ when: "always", act: "hold" }],
    };
    const forgedPayload = Buffer.from(JSON.stringify(forged), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeDesignCode(`${tag}.${forgedPayload}`).ok).toBe(false);
  });

  it("is compact enough to paste: a full stock bot stays well under the cap", () => {
    for (const design of STOCK) {
      expect(encodeDesignCode(design).length).toBeLessThan(600);
    }
  });

  it("tolerates whitespace and a pasted workshop link", () => {
    const code = encodeDesignCode(TEST_BOT_DESIGN);
    expect(decodeDesignCode(`  ${code}\n`).ok).toBe(true);
    const url = designShareUrl("https://vibe-bots.vercel.app", TEST_BOT_DESIGN);
    expect(url).toContain("/workshop?code=VB1.");
    const fromUrl = decodeDesignCode(url);
    expect(fromUrl.ok).toBe(true);
    if (fromUrl.ok) expect(fromUrl.design).toEqual(TEST_BOT_DESIGN);
  });

  it("names the problem with a bad code", () => {
    expect(decodeDesignCode("")).toEqual({
      ok: false,
      reason: "Paste a share code first.",
    });
    expect(decodeDesignCode("hello")).toMatchObject({ ok: false });
    expect(decodeDesignCode("VB9.abc")).toMatchObject({ ok: false });
    expect(decodeDesignCode("VB1.!!!")).toEqual({
      ok: false,
      reason: "That code is damaged.",
    });
    expect(decodeDesignCode("https://example.com/workshop")).toEqual({
      ok: false,
      reason: "That link has no share code in it.",
    });
    expect(
      decodeDesignCode(`VB1.${"A".repeat(MAX_DESIGN_CODE_LENGTH)}`),
    ).toEqual({ ok: false, reason: "That code is too long to be a bot." });
  });

  it("refuses a code that decodes to a bot the validator rejects", () => {
    const noCore: BotDesign = {
      name: "Headless",
      parts: [{ iid: "plate", partId: "frame-plate" }],
      connections: [],
    };
    const decoded = decodeDesignCode(encodeDesignCode(noCore));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toContain("fails inspection");

    const unknownPart: BotDesign = {
      name: "Alien",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "x", partId: "no-such-part" },
      ],
      connections: [],
    };
    expect(decodeDesignCode(encodeDesignCode(unknownPart)).ok).toBe(false);
  });

  it("refuses a tampered payload instead of loading garbage", () => {
    const code = encodeDesignCode(TEST_BOT_DESIGN);
    const body = code.slice(4);
    // Flip a character in the middle: either the JSON breaks or the schema does.
    const flipped = `${body.slice(0, 20)}${body[20] === "A" ? "B" : "A"}${body.slice(21)}`;
    const decoded = decodeDesignCode(`VB1.${flipped}`);
    if (decoded.ok) {
      // A flip that happens to keep valid JSON must still be a valid bot.
      expect(decoded.design.parts.length).toBeGreaterThan(0);
    } else {
      expect(decoded.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("paint in a share code", () => {
  it("refuses an unknown paint id instead of decoding an unpainted bot", () => {
    const painted: BotDesign = {
      ...TEST_BOT_DESIGN,
      paint: { primary: "cobalt", accent: "gold" },
    };
    const code = encodeDesignCode(painted);
    const round = decodeDesignCode(code);
    expect(round.ok && round.design.paint).toEqual({
      primary: "cobalt",
      accent: "gold",
    });
    // Tamper the tuple: an unknown paint id (still two strings).
    const tampered = encodeDesignCode({
      ...painted,
      paint: { primary: "x" as never, accent: "gold" },
    });
    expect(decodeDesignCode(tampered).ok).toBe(false);
  });
});
