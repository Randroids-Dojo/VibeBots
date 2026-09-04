import type { World } from "@dimforge/rapier3d-deterministic-compat";
import { describe, expect, it } from "vitest";
import { createArenaWorld } from "./arena";
import {
  combatStateString,
  createMatch,
  damagePart,
  freeMatch,
  type MatchOptions,
  type MatchState,
  rankTargetCandidates,
  stepMatch,
} from "./combat";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  CPU_BULLDOZER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  NEUTRAL_BEHAVIOR,
  TEST_BOT_DESIGN,
} from "./design";
import { fnv1a64 } from "./hash";
import { vec3Distance } from "./parts";
import { matchResultHash } from "./resolve";

async function newMatch(options?: MatchOptions): Promise<{
  world: World;
  match: MatchState;
  cleanup: () => void;
}> {
  const world = await createArenaWorld();
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

const BRIDGE_BOT_DESIGN: BotDesign = {
  name: "Bridge Bot",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "bridge", partId: "cross-frame" },
    { iid: "head", partId: "sensor-head" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "wheel-l",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "wheel-r",
      childConnector: "hub",
    },
    {
      parentIid: "core",
      parentConnector: "top",
      childIid: "bridge",
      childConnector: "bottom",
    },
    {
      parentIid: "bridge",
      parentConnector: "top",
      childIid: "head",
      childConnector: "neck",
    },
  ],
};

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

  it("uses the catalog durability for combat health; a stale merge level changes nothing (F-230)", async () => {
    const world = await createArenaWorld();
    const stale = {
      ...TEST_BOT_DESIGN,
      parts: TEST_BOT_DESIGN.parts.map((part) =>
        part.iid === "wheel-l"
          ? ({ ...part, mergeLevel: 3 } as typeof part)
          : part,
      ),
    };
    const match = createMatch(world, [stale, TEST_BOT_DESIGN]);
    try {
      const wheel = match.bots[0].parts.get("wheel-l");
      expect(wheel?.maxHealth).toBe(80);
      expect(damagePart(match, 0, "wheel-l", 9999)).toBe(80);
    } finally {
      freeMatch(match);
      world.free();
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

  it("stock exhibition matchup produces a damaging, legible fight", async () => {
    const world = await createArenaWorld();
    // Rammer at index 1: its spike faces the Brawler.
    const match = createMatch(world, [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN]);
    try {
      for (let i = 0; i < 3600 && !match.status.over; i++) {
        stepMatch(match);
      }
      const status = match.status;
      expect(status.over).toBe(true);
      if (status.over) {
        // The fight must be visibly destructive and the winner earned:
        // the Rammer's spike grinds the Brawler down.
        expect(status.winner).toBe(1);
        expect(status.scores[0].damageTaken).toBeGreaterThan(50);
        expect(status.scores[1].damageDealt).toBeGreaterThan(50);
        expect(status.scores[0].healthRemaining).toBeLessThan(
          status.scores[0].healthTotal * 0.8,
        );
        expect(status.scores[0].partsRemaining).toBeLessThan(
          status.scores[0].partCount,
        );
      }
    } finally {
      freeMatch(match);
      world.free();
    }
  });

  it("targets a nearly destroyed weapon before a healthy core", async () => {
    const world = await createArenaWorld();
    const match = createMatch(world, [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN]);
    try {
      damagePart(match, 1, "spike", 145);
      const [target] = rankTargetCandidates(match, 0);
      expect(target.iid).toBe("spike");
      expect(target.category).toBe("weapon");
    } finally {
      freeMatch(match);
      world.free();
    }
  });

  it("values bridge structures above the leaf parts they detach", async () => {
    const world = await createArenaWorld();
    const match = createMatch(world, [TEST_BOT_DESIGN, BRIDGE_BOT_DESIGN]);
    try {
      const candidates = rankTargetCandidates(match, 0);
      const bridgeIndex = candidates.findIndex((c) => c.iid === "bridge");
      const headIndex = candidates.findIndex((c) => c.iid === "head");
      expect(bridgeIndex).toBeGreaterThanOrEqual(0);
      expect(headIndex).toBeGreaterThanOrEqual(0);
      expect(bridgeIndex).toBeLessThan(headIndex);
    } finally {
      freeMatch(match);
      world.free();
    }
  });

  it("stores the selected weakness in the deterministic brain state", async () => {
    const world = await createArenaWorld();
    const match = createMatch(world, [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN]);
    try {
      damagePart(match, 1, "spike", 145);
      stepMatch(match);
      expect(match.bots[0].brain.targetIid).toBe("spike");
    } finally {
      freeMatch(match);
      world.free();
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

describe("B2 bulldozer in combat", () => {
  it("assembles, fights deterministically, and trades damage", async () => {
    const run = async () => {
      const world = await createArenaWorld();
      const match = createMatch(world, [CPU_BULLDOZER_DESIGN, TEST_BOT_DESIGN]);
      for (let i = 0; i < 1200; i++) stepMatch(match);
      const hash = matchResultHash(match);
      const totals = match.bots.map((bot) => {
        let health = 0;
        let max = 0;
        for (const part of bot.parts.values()) {
          health += part.destroyed ? 0 : part.health;
          max += part.maxHealth;
        }
        return { health, max };
      });
      freeMatch(match);
      world.free();
      return { hash, totals };
    };
    const a = await run();
    const b = await run();
    // Same designs, same world: identical result hash across fresh runs.
    expect(b.hash).toBe(a.hash);
    // The clash is real: both stock builds take damage inside the window.
    for (const t of a.totals) {
      expect(t.health).toBeLessThan(t.max);
      expect(t.health).toBeGreaterThan(0);
    }
  });
});

describe("B2b saw blade in combat", () => {
  it("spins from assembly and out-damages what it takes", async () => {
    const world = await createArenaWorld();
    const match = createMatch(world, [
      CPU_WHIRLIGIG_DESIGN,
      CPU_BRAWLER_DESIGN,
    ]);
    // The blade spins up from the first steps without any controller.
    for (let i = 0; i < 30; i++) stepMatch(match);
    const blade = match.bots[0].assembled.bodies.get("blade");
    expect(blade).toBeTruthy();
    const spin = blade ? Math.abs(blade.angvel().z) : 0;
    expect(spin).toBeGreaterThan(8);
    for (let i = 0; i < 1400; i++) stepMatch(match);
    const totals = match.bots.map((bot) => {
      let health = 0;
      let max = 0;
      for (const part of bot.parts.values()) {
        health += part.destroyed ? 0 : part.health;
        max += part.maxHealth;
      }
      return { health, max };
    });
    // The saw carries the matchup: the brawler loses more of its build.
    const sawLoss = 1 - totals[0].health / totals[0].max;
    const brawlerLoss = 1 - totals[1].health / totals[1].max;
    expect(brawlerLoss).toBeGreaterThan(0.02);
    expect(brawlerLoss).toBeGreaterThan(sawLoss);
    freeMatch(match);
    world.free();
  });

  it("stays deterministic with a spin motor in the world", async () => {
    const run = async () => {
      const world = await createArenaWorld();
      const match = createMatch(world, [CPU_WHIRLIGIG_DESIGN, TEST_BOT_DESIGN]);
      for (let i = 0; i < 900; i++) stepMatch(match);
      const hash = matchResultHash(match);
      freeMatch(match);
      world.free();
      return hash;
    };
    expect(await run()).toBe(await run());
  });
});

describe("B3 behavior parameters", () => {
  const hashAfter = async (designs: [BotDesign, BotDesign], steps: number) => {
    const world = await createArenaWorld();
    const match = createMatch(world, designs);
    for (let i = 0; i < steps; i++) stepMatch(match);
    const hash = matchResultHash(match);
    freeMatch(match);
    world.free();
    return hash;
  };

  it("neutral behavior reproduces the classic controller exactly", async () => {
    const withNeutral: [BotDesign, BotDesign] = [
      { ...CPU_BRAWLER_DESIGN, behavior: { ...NEUTRAL_BEHAVIOR } },
      { ...TEST_BOT_DESIGN, behavior: { ...NEUTRAL_BEHAVIOR } },
    ];
    expect(await hashAfter(withNeutral, 700)).toBe(
      await hashAfter([CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN], 700),
    );
  });

  it("behavior extremes change the fight", async () => {
    const hot: [BotDesign, BotDesign] = [
      {
        ...CPU_BRAWLER_DESIGN,
        behavior: { aggression: 1, flankBias: 0, patience: 0 },
      },
      TEST_BOT_DESIGN,
    ];
    const cold: [BotDesign, BotDesign] = [
      {
        ...CPU_BRAWLER_DESIGN,
        behavior: { aggression: 0, flankBias: 1, patience: 1 },
      },
      TEST_BOT_DESIGN,
    ];
    expect(await hashAfter(hot, 700)).not.toBe(await hashAfter(cold, 700));
  });
});
