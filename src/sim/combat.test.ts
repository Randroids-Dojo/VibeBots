import type { World } from "@dimforge/rapier3d-deterministic-compat";
import { describe, expect, it } from "vitest";
import {
  combatStateString,
  createMatch,
  damagePart,
  freeMatch,
  type MatchOptions,
  type MatchState,
  stepMatch,
} from "./combat";
import { DT, GRAVITY } from "./constants";
import { TEST_BOT_DESIGN } from "./design";
import { fnv1a64 } from "./hash";
import { vec3Distance } from "./parts";
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

async function newMatch(options?: MatchOptions): Promise<{
  world: World;
  match: MatchState;
  cleanup: () => void;
}> {
  const world = await arenaWorld();
  const match = createMatch(world, [TEST_BOT_DESIGN, TEST_BOT_DESIGN], options);
  return {
    world,
    match,
    cleanup: () => {
      freeMatch(match);
      world.free();
    },
  };
}

function totalDamage(match: MatchState): number {
  return match.bots
    .flatMap((bot) => [...bot.parts.values()])
    .reduce((sum, part) => sum + (part.maxHealth - part.health), 0);
}

function coreDistance(match: MatchState): number {
  const [a, b] = match.bots.map((bot) => bot.coreBody.translation());
  return vec3Distance(a, b);
}

describe("autonomous combat", () => {
  it("drives the bots into each other and deals contact damage", async () => {
    const { match, cleanup } = await newMatch();
    try {
      const startDistance = coreDistance(match);
      // No spawn-drop or rolling self-damage before the bots ever touch.
      for (let i = 0; i < 30; i++) {
        stepMatch(match);
      }
      expect(totalDamage(match)).toBe(0);
      for (let i = 0; i < 90 && coreDistance(match) > 1.5; i++) {
        stepMatch(match);
      }
      expect(coreDistance(match)).toBeLessThan(startDistance);
      for (let i = 0; i < 480; i++) {
        stepMatch(match);
      }
      expect(totalDamage(match)).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("is deterministic across fresh matches", async () => {
    async function run(): Promise<string> {
      const { match, cleanup } = await newMatch();
      try {
        for (let i = 0; i < 600; i++) {
          stepMatch(match);
        }
        return `${fnv1a64(match.world.takeSnapshot())}::${combatStateString(match)}`;
      } finally {
        cleanup();
      }
    }
    const a = await run();
    const b = await run();
    expect(b).toBe(a);
  });

  it("detaches a destroyed part from its parent", async () => {
    const { match, cleanup } = await newMatch();
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
      // Detachment must not splash depenetration damage onto the core.
      for (let i = 0; i < 20; i++) {
        stepMatch(match);
      }
      const core = match.bots[0].parts.get("core");
      expect(core?.health).toBe(core?.maxHealth);
    } finally {
      cleanup();
    }
  });

  it("disables a bot when all mobility parts are destroyed", async () => {
    const { match, cleanup } = await newMatch();
    try {
      damagePart(match, 0, "wheel-l", 9999);
      damagePart(match, 0, "wheel-r", 9999);
      stepMatch(match);
      expect(match.bots[0].disabled).toBe(true);
      expect(match.status).toMatchObject({
        over: true,
        winner: 1,
        reason: "disable",
      });
    } finally {
      cleanup();
    }
  });

  it("disables a bot when its core is destroyed", async () => {
    const { match, cleanup } = await newMatch();
    try {
      damagePart(match, 1, "core", 9999);
      stepMatch(match);
      expect(match.bots[1].disabled).toBe(true);
      expect(match.status).toMatchObject({
        over: true,
        winner: 0,
        reason: "disable",
      });
    } finally {
      cleanup();
    }
  });

  it("ends by timeout with score-based judgment (REQ-005)", async () => {
    // 60 ticks: the bots are still meters apart when time expires.
    const { match, cleanup } = await newMatch({ timeLimitTicks: 60 });
    try {
      // Tilt the judgment: bot 1 starts the match already damaged.
      damagePart(match, 1, "core", 50);
      for (let i = 0; i < 120; i++) {
        stepMatch(match);
      }
      expect(match.tick).toBe(60);
      const status = match.status;
      expect(status.over).toBe(true);
      if (status.over) {
        expect(status.reason).toBe("timeout");
        expect(status.winner).toBe(0);
        expect(status.scores[1].damageTaken).toBeGreaterThanOrEqual(50);
        expect(status.scores[1].healthRemaining).toBeLessThan(
          status.scores[1].healthTotal,
        );
        expect(status.scores[0].total).toBeGreaterThan(status.scores[1].total);
      }
    } finally {
      cleanup();
    }
  });

  it("clamps overkill damage to the part's remaining health", async () => {
    const { match, cleanup } = await newMatch();
    try {
      const applied = damagePart(match, 0, "wheel-l", 9999);
      expect(applied).toBe(80);
      expect(match.bots[0].damageTaken).toBe(80);
      // A destroyed part absorbs (and credits) nothing further.
      stepMatch(match);
      expect(damagePart(match, 0, "wheel-l", 50)).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("reports disable as the end reason with scores attached", async () => {
    const { match, cleanup } = await newMatch();
    try {
      damagePart(match, 1, "core", 9999);
      stepMatch(match);
      const status = match.status;
      expect(status.over).toBe(true);
      if (status.over) {
        expect(status.reason).toBe("disable");
        expect(status.winner).toBe(0);
        expect(status.scores[0].partsRemaining).toBe(4);
        expect(status.scores[1].partsRemaining).toBe(3);
      }
    } finally {
      cleanup();
    }
  });

  it("never accepts input after match start (controllers only read sim state)", async () => {
    const { match, cleanup } = await newMatch();
    try {
      // The public stepping surface takes no input parameter at all; this
      // guards the REQ-001 contract at the type level.
      const step: (m: MatchState) => void = stepMatch;
      step(match);
      expect(match.tick).toBe(1);
    } finally {
      cleanup();
    }
  });
});
