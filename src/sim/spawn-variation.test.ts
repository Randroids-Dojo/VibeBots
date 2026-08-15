import { describe, expect, it } from "vitest";
import { createArenaWorld } from "./arena";
import {
  combatStateString,
  createMatch,
  freeMatch,
  SPAWN_ARRANGEMENTS,
  stepMatch,
} from "./combat";
import { CPU_BRAWLER_DESIGN, CPU_WHIRLIGIG_DESIGN } from "./design";
import { matchResultHash } from "./resolve";

async function runVariation(variation: number | undefined, ticks = 600) {
  const world = await createArenaWorld();
  const match = createMatch(world, [CPU_WHIRLIGIG_DESIGN, CPU_BRAWLER_DESIGN], {
    variation,
  });
  const start = {
    a: { ...match.bots[0].coreBody.translation() },
    b: { ...match.bots[1].coreBody.translation() },
  };
  for (let i = 0; i < ticks && !match.status.over; i++) stepMatch(match);
  const result = {
    start,
    hash: matchResultHash(match),
    state: combatStateString(match),
    tick: match.tick,
  };
  freeMatch(match);
  world.free();
  return result;
}

describe("spawn arrangements", () => {
  it("keeps every bot inside the arena walls", () => {
    // ARENA_WALL_HALF_EXTENT is 9; spawns must sit well inside it so a
    // variation never starts a bot in or against a wall.
    for (const [index, spawn] of SPAWN_ARRANGEMENTS.entries()) {
      for (const pos of [spawn.a, spawn.b]) {
        expect(Math.abs(pos.x), `arrangement ${index} x`).toBeLessThan(7);
        expect(Math.abs(pos.z), `arrangement ${index} z`).toBeLessThan(7);
      }
    }
  });

  it("always starts the two bots apart and facing across the arena", () => {
    for (const [index, spawn] of SPAWN_ARRANGEMENTS.entries()) {
      const gap = Math.sqrt(
        (spawn.a.x - spawn.b.x) ** 2 + (spawn.a.z - spawn.b.z) ** 2,
      );
      // Far enough not to spawn interpenetrating, close enough to engage.
      expect(gap, `arrangement ${index}`).toBeGreaterThan(4);
      expect(spawn.a.z).toBeLessThan(0);
      expect(spawn.b.z).toBeGreaterThan(0);
    }
  });
});

describe("match variation", () => {
  it("reproduces the historical spawn when unvaried", async () => {
    // The identity contract: an unvaried match must be byte-identical to
    // every match recorded before variation existed, so no stored replay
    // or golden vector moves.
    const unvaried = await runVariation(undefined);
    const explicitZero = await runVariation(0);

    // Rapier stores translations as f32, so compare with a tolerance
    // rather than exactly (0.42 reads back as 0.41999998).
    expect(unvaried.start.a.x).toBeCloseTo(0, 5);
    expect(unvaried.start.a.y).toBeCloseTo(0.42, 5);
    expect(unvaried.start.a.z).toBeCloseTo(-3, 5);
    expect(unvaried.start.b.z).toBeCloseTo(3, 5);
    expect(explicitZero.hash).toBe(unvaried.hash);
    expect(explicitZero.state).toBe(unvaried.state);
  }, 60000);

  it("actually produces a different fight", async () => {
    // The whole point: without this the bench had one outcome per matchup.
    const base = await runVariation(0);
    const other = await runVariation(4);
    expect(other.start.a.x).not.toBeCloseTo(base.start.a.x, 3);
    expect(other.hash).not.toBe(base.hash);
  }, 60000);

  it("is deterministic per variation", async () => {
    const first = await runVariation(3);
    const second = await runVariation(3);
    expect(second.hash).toBe(first.hash);
    expect(second.state).toBe(first.state);
    expect(second.tick).toBe(first.tick);
  }, 60000);

  it("wraps out-of-range indexes instead of crashing", async () => {
    const wrapped = await runVariation(SPAWN_ARRANGEMENTS.length);
    const zero = await runVariation(0);
    expect(wrapped.hash).toBe(zero.hash);
    // Negative indexes wrap forward rather than reading off the end.
    const negative = await runVariation(-1);
    const last = await runVariation(SPAWN_ARRANGEMENTS.length - 1);
    expect(negative.hash).toBe(last.hash);
  }, 90000);
});
