import { describe, expect, it } from "vitest";
import {
  type BotDesign,
  botDesignSchema,
  isPitchPreset,
  PITCH_PRESETS,
  TEST_BOT_DESIGN,
  validateDesign,
} from "./design";
import { computeLayout, connectionRotation, YAW_QUATS } from "./layout";
import { resolveMatch } from "./resolve";

/** The starter build with its nose spike tilted. */
function tilted(pitch: number): BotDesign {
  return {
    ...TEST_BOT_DESIGN,
    connections: TEST_BOT_DESIGN.connections.map((conn) =>
      conn.childIid === "spike" ? { ...conn, pitch: pitch as 15 } : conn,
    ),
  };
}

describe("weapon mount angles (F-247, second lever)", () => {
  it("accepts the presets on a weapon's rigid mount and nothing else", () => {
    for (const pitch of PITCH_PRESETS) {
      expect(isPitchPreset(pitch)).toBe(true);
      expect(validateDesign(tilted(pitch)).ok).toBe(true);
    }
    expect(isPitchPreset(10)).toBe(false);
    expect(botDesignSchema.safeParse(tilted(10)).success).toBe(false);
    // A wheel on its axle cannot tilt.
    const wheel: BotDesign = {
      ...TEST_BOT_DESIGN,
      connections: TEST_BOT_DESIGN.connections.map((conn) =>
        conn.childIid === "wheel-l" ? { ...conn, pitch: 15 } : conn,
      ),
    };
    const result = validateDesign(wheel);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain(
        "only a weapon on a rigid mount",
      );
    }
  });

  it("turns the nose up for a positive pitch and leaves a flat mount exactly as it was", () => {
    const flat = computeLayout(TEST_BOT_DESIGN).get("spike");
    const zero = computeLayout(tilted(0)).get("spike");
    const up = computeLayout(tilted(15)).get("spike");
    const down = computeLayout(tilted(-30)).get("spike");
    expect(flat).toBeDefined();
    expect(zero).toEqual(flat);
    expect(up?.position.y ?? 0).toBeGreaterThan(flat?.position.y ?? 0);
    expect(down?.position.y ?? 0).toBeLessThan(flat?.position.y ?? 0);
    expect(connectionRotation({ orientation: 90 })).toEqual(YAW_QUATS[90]);
  });

  it("changes the world a design builds, so it is a real lever and a real sim-version reason", async () => {
    const flat = await resolveMatch([TEST_BOT_DESIGN, TEST_BOT_DESIGN]);
    const same = await resolveMatch([TEST_BOT_DESIGN, tilted(0)]);
    expect(same.hash).toBe(flat.hash);
    const up = await resolveMatch([TEST_BOT_DESIGN, tilted(15)]);
    expect(up.hash).not.toBe(flat.hash);
  }, 60_000);
});
