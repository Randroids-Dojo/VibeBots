import type { World } from "@dimforge/rapier3d-deterministic-compat";
import { describe, expect, it } from "vitest";
import {
  combatStateString,
  createMatch,
  damagePart,
  type MatchState,
  stepMatch,
} from "./combat";
import { DT, GRAVITY } from "./constants";
import { TEST_BOT_DESIGN } from "./design";
import { fnv1a64 } from "./hash";
import { ensureRapier } from "./world";

async function arenaWorld(): Promise<World> {
  const R = await ensureRapier();
  const world = new R.World(GRAVITY);
  world.integrationParameters.dt = DT;
  world.createCollider(
    R.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0),
  );
  return world;
}

async function newMatch(): Promise<{ world: World; match: MatchState }> {
  const world = await arenaWorld();
  const match = createMatch(world, [TEST_BOT_DESIGN, TEST_BOT_DESIGN]);
  return { world, match };
}

function coreDistance(match: MatchState): number {
  const [a, b] = match.bots.map((bot) =>
    bot.assembled.bodies.get(bot.assembled.rootIid)?.translation(),
  );
  if (!a || !b) throw new Error("cores missing");
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

describe("autonomous combat", () => {
  it("drives the bots into each other and deals contact damage", async () => {
    const { world, match } = await newMatch();
    try {
      const startDistance = coreDistance(match);
      for (let i = 0; i < 120 && coreDistance(match) > 1.5; i++) {
        stepMatch(match);
      }
      expect(coreDistance(match)).toBeLessThan(startDistance);
      for (let i = 0; i < 480; i++) {
        stepMatch(match);
      }
      const totalDamage = match.bots
        .flatMap((bot) => [...bot.parts.values()])
        .reduce((sum, part) => sum + (part.maxHealth - part.health), 0);
      expect(totalDamage).toBeGreaterThan(0);
    } finally {
      world.free();
    }
  });

  it("is deterministic across fresh matches", async () => {
    async function run(): Promise<string> {
      const { world, match } = await newMatch();
      try {
        for (let i = 0; i < 600; i++) {
          stepMatch(match);
        }
        return `${fnv1a64(world.takeSnapshot())}::${combatStateString(match)}`;
      } finally {
        world.free();
      }
    }
    const a = await run();
    const b = await run();
    expect(b).toBe(a);
  });

  it("detaches a destroyed part from its parent", async () => {
    const { world, match } = await newMatch();
    try {
      const jointsBefore = match.bots[0].assembled.jointToParent.size;
      damagePart(match, 0, "wheel-l", 9999);
      stepMatch(match);
      const wheel = match.bots[0].parts.get("wheel-l");
      expect(wheel?.destroyed).toBe(true);
      expect(match.bots[0].assembled.jointToParent.size).toBe(jointsBefore - 1);
      // One wheel left: still mobile, not disabled.
      expect(match.bots[0].disabled).toBe(false);
      expect(match.status.over).toBe(false);
    } finally {
      world.free();
    }
  });

  it("disables a bot when all mobility parts are destroyed", async () => {
    const { world, match } = await newMatch();
    try {
      damagePart(match, 0, "wheel-l", 9999);
      damagePart(match, 0, "wheel-r", 9999);
      stepMatch(match);
      expect(match.bots[0].disabled).toBe(true);
      expect(match.status).toEqual({ over: true, winner: 1 });
    } finally {
      world.free();
    }
  });

  it("disables a bot when its core is destroyed", async () => {
    const { world, match } = await newMatch();
    try {
      damagePart(match, 1, "core", 9999);
      stepMatch(match);
      expect(match.bots[1].disabled).toBe(true);
      expect(match.status).toEqual({ over: true, winner: 0 });
    } finally {
      world.free();
    }
  });

  it("never accepts input after match start (controllers only read sim state)", async () => {
    const { world, match } = await newMatch();
    try {
      // The public stepping surface takes no input parameter at all; this
      // guards the REQ-001 contract at the type level.
      const step: (m: MatchState) => void = stepMatch;
      step(match);
      expect(match.tick).toBe(1);
    } finally {
      world.free();
    }
  });
});
