import type { World } from "@dimforge/rapier3d-deterministic-compat";
import { describe, expect, it } from "vitest";
import { createArenaWorld } from "./arena";
import { assembleBot, setDriveVelocity } from "./assembly";
import { TEST_BOT_DESIGN } from "./design";
import { fnv1a64 } from "./hash";
import { vec3Distance } from "./parts";

async function driveAndHash(
  steps: number,
): Promise<{ hash: string; rootZ: number; rootX: number }> {
  const world = await createArenaWorld();
  try {
    const bot = assembleBot(world, TEST_BOT_DESIGN, { x: 0, y: 0.5, z: 0 });
    setDriveVelocity(bot, 10);
    for (let i = 0; i < steps; i++) {
      world.step();
    }
    const root = bot.bodies.get(bot.rootIid);
    if (!root) throw new Error("root body missing");
    const t = root.translation();
    return { hash: fnv1a64(world.takeSnapshot()), rootZ: t.z, rootX: t.x };
  } finally {
    world.free();
  }
}

describe("assembleBot", () => {
  it("creates one body per part and motors per axle connection", async () => {
    const world = await createArenaWorld();
    try {
      const bot = assembleBot(world, TEST_BOT_DESIGN, { x: 0, y: 0.5, z: 0 });
      expect(bot.bodies.size).toBe(4);
      expect(bot.joints.length).toBe(3);
      expect(bot.axleJoints.length).toBe(2);
      expect(bot.rootIid).toBe("core");
    } finally {
      world.free();
    }
  });

  it("throws on invalid designs", async () => {
    const world = await createArenaWorld();
    try {
      expect(() =>
        assembleBot(
          world,
          {
            name: "broken",
            parts: [{ iid: "x", partId: "ram-spike" }],
            connections: [],
          },
          { x: 0, y: 1, z: 0 },
        ),
      ).toThrow(/invalid design/);
    } finally {
      world.free();
    }
  });

  it("drives the bot along the ground deterministically", async () => {
    const a = await driveAndHash(300);
    const b = await driveAndHash(300);
    expect(b.hash).toBe(a.hash);
    // Wheels spin around the x axis, so the bot rolls along z.
    expect(Math.abs(a.rootZ)).toBeGreaterThan(0.5);
    expect(Math.abs(a.rootX)).toBeLessThan(0.25);
  });

  it("keeps the assembly intact while driving", async () => {
    const world = await createArenaWorld();
    try {
      const bot = assembleBot(world, TEST_BOT_DESIGN, { x: 0, y: 0.5, z: 0 });
      setDriveVelocity(bot, 10);
      for (let i = 0; i < 300; i++) {
        world.step();
      }
      const root = bot.bodies.get("core");
      const spike = bot.bodies.get("spike");
      if (!root || !spike) throw new Error("bodies missing");
      const dist = vec3Distance(root.translation(), spike.translation());
      // Spike mount keeps it 0.5m from the core center.
      expect(dist).toBeGreaterThan(0.3);
      expect(dist).toBeLessThan(0.7);
    } finally {
      world.free();
    }
  });
});
