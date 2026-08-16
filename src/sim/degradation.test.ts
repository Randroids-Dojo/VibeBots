import { describe, expect, it } from "vitest";
import { createArenaWorld } from "./arena";
import {
  combatStateString,
  createMatch,
  damagePart,
  freeMatch,
  MIN_PART_EFFECTIVENESS,
  partEffectiveness,
  stepMatch,
} from "./combat";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  TEST_BOT_DESIGN,
} from "./design";
import { matchResultHash } from "./resolve";

/**
 * Peak speed a bot reaches before the two ever touch.
 *
 * Measured pre-contact on purpose. Distance travelled inside a live fight
 * is not a drive measurement: once the bots collide, the number is
 * dominated by shoving, wall contact, and the controller steering, which
 * made the earlier version of this test non-monotonic under the rapier
 * 0.20 bump even though the behaviour it checks was intact. The bots spawn
 * six apart and close at a few metres per second, so this window is clean.
 */
async function peakSpeedBeforeContact(
  design: BotDesign,
  damage: Array<{ iid: string; amount: number }>,
): Promise<number> {
  const world = await createArenaWorld();
  const match = createMatch(world, [design, CPU_BRAWLER_DESIGN]);
  // Let the bots settle onto the floor before hurting anything.
  for (let i = 0; i < 20; i++) stepMatch(match);
  for (const entry of damage) {
    damagePart(match, 0, entry.iid, entry.amount);
  }
  const bot = match.bots[0];
  let peak = 0;
  for (let i = 0; i < 45; i++) {
    stepMatch(match);
    const velocity = bot.coreBody.linvel();
    peak = Math.max(peak, Math.sqrt(velocity.x ** 2 + velocity.z ** 2));
  }
  freeMatch(match);
  world.free();
  return peak;
}

describe("partEffectiveness", () => {
  it("is full at full health and floors above zero", () => {
    expect(partEffectiveness(1)).toBe(1);
    expect(partEffectiveness(0)).toBe(MIN_PART_EFFECTIVENESS);
    // A part on its last sliver still works, badly. A zero floor would make
    // the final hit points worthless.
    expect(MIN_PART_EFFECTIVENESS).toBeGreaterThan(0);
  });

  it("falls monotonically as health drops", () => {
    let previous = partEffectiveness(1);
    for (const ratio of [0.9, 0.7, 0.5, 0.3, 0.1, 0]) {
      const current = partEffectiveness(ratio);
      expect(current).toBeLessThan(previous);
      previous = current;
    }
  });

  it("clamps nonsense input instead of extrapolating", () => {
    expect(partEffectiveness(5)).toBe(1);
    expect(partEffectiveness(-3)).toBe(MIN_PART_EFFECTIVENESS);
  });
});

describe("worn parts work worse", () => {
  it("a battered wheel slows the bot down", async () => {
    // The failure mode the old model erased: still driving, but hurt.
    const healthy = await peakSpeedBeforeContact(TEST_BOT_DESIGN, []);
    const worn = await peakSpeedBeforeContact(TEST_BOT_DESIGN, [
      // Drive wheels have 80 durability; leave a sliver so the bot is
      // damaged rather than immobilized.
      { iid: "wheel-l", amount: 75 },
      { iid: "wheel-r", amount: 75 },
    ]);
    expect(healthy).toBeGreaterThan(0);
    expect(worn).toBeLessThan(healthy);
  }, 60000);

  it("a damaged spinner winds down instead of staying lethal", async () => {
    const world = await createArenaWorld();
    const match = createMatch(world, [
      CPU_WHIRLIGIG_DESIGN,
      CPU_BRAWLER_DESIGN,
    ]);
    for (let i = 0; i < 20; i++) stepMatch(match);

    const blade = match.bots[0].assembled.bodies.get("blade");
    if (!blade) throw new Error("saw bot lost its blade");
    const spinSpeed = () => Math.abs(blade.angvel().z);

    for (let i = 0; i < 90; i++) stepMatch(match);
    const healthy = spinSpeed();

    // Saw blade durability is 110; leave it barely alive.
    damagePart(match, 0, "blade", 105);
    for (let i = 0; i < 90; i++) stepMatch(match);
    const wounded = spinSpeed();

    expect(healthy).toBeGreaterThan(0);
    expect(wounded).toBeLessThan(healthy);

    freeMatch(match);
    world.free();
  }, 60000);
});

describe("destroyed spinners are released", () => {
  it("keeps stepping and frees cleanly after the blade is destroyed", async () => {
    // Regression: spin joints were only ever configured once at assembly,
    // so processDeaths cleaned axle joints and left spin joints dangling.
    // Driving spinners every tick turned that stale entry into a call on a
    // joint the world had already freed, which crashed the WASM side with
    // "attempted to take ownership of Rust value while it was borrowed"
    // when the world was released. Found by running the bench.
    const world = await createArenaWorld();
    const match = createMatch(world, [
      CPU_WHIRLIGIG_DESIGN,
      CPU_BRAWLER_DESIGN,
    ]);
    for (let i = 0; i < 20; i++) stepMatch(match);

    expect(match.bots[0].assembled.spinJoints).toHaveLength(1);
    // Destroy the blade outright, then keep the match running.
    damagePart(match, 0, "blade", 10_000);
    stepMatch(match);
    expect(match.bots[0].parts.get("blade")?.destroyed).toBe(true);
    expect(match.bots[0].assembled.spinJoints).toHaveLength(0);

    for (let i = 0; i < 240 && !match.status.over; i++) stepMatch(match);

    // The real assertion is that neither of these throws.
    expect(() => {
      freeMatch(match);
      world.free();
    }).not.toThrow();
  }, 60000);
});

describe("degradation stays deterministic", () => {
  it("replays the same fight to the same hash", async () => {
    const run = async () => {
      const world = await createArenaWorld();
      const match = createMatch(world, [
        CPU_WHIRLIGIG_DESIGN,
        CPU_BRAWLER_DESIGN,
      ]);
      for (let i = 0; i < 900 && !match.status.over; i++) stepMatch(match);
      const result = {
        hash: matchResultHash(match),
        state: combatStateString(match),
      };
      freeMatch(match);
      world.free();
      return result;
    };
    const first = await run();
    const second = await run();
    expect(second.hash).toBe(first.hash);
    expect(second.state).toBe(first.state);
  }, 90000);
});
