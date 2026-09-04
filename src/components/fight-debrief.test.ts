import { describe, expect, it } from "vitest";
import type { MatchScore } from "@/sim/combat";
import { type BotDesign, TEST_BOT_DESIGN } from "@/sim/design";
import type { MatchTeardown, TeardownBot, TeardownPart } from "@/sim/telemetry";
import {
  AGGRESSION_STEP,
  buildDebrief,
  clockFromTicks,
  DEBRIEF_MAX_LESSONS,
  PATIENCE_STEP,
  PLATE_SUGGESTION,
  suggestWeapon,
} from "./fight-debrief";

function part(
  over: Partial<TeardownPart> & { iid: string; name: string },
): TeardownPart {
  return {
    partId: over.iid,
    category: "structure",
    health: 100,
    maxHealth: 100,
    destroyed: false,
    damageTaken: 0,
    damageDealt: 0,
    hitsTaken: 0,
    hitsDealt: 0,
    destroyedAtTick: null,
    killedBy: null,
    killedByName: null,
    ...over,
  };
}

function bot(name: string, parts: TeardownPart[]): TeardownBot {
  const damageDealt = parts.reduce((sum, p) => sum + p.damageDealt, 0);
  const damageTaken = parts.reduce((sum, p) => sum + p.damageTaken, 0);
  const lost = parts.filter((p) => p.destroyedAtTick !== null);
  return {
    name,
    parts,
    damageDealt,
    damageTaken,
    firstLossTick:
      lost.length === 0
        ? null
        : Math.min(...lost.map((p) => p.destroyedAtTick ?? 0)),
    partsLost: lost.length,
  };
}

function teardown(
  mine: TeardownBot,
  theirs: TeardownBot,
  ticks = 1200,
): MatchTeardown {
  return {
    bots: [theirs, mine],
    ticks,
    totalImpacts: 0,
    truncated: false,
    hardestHits: [],
  };
}

function score(total: number, pressureTicks = 0): MatchScore {
  return {
    damageDealt: 0,
    damageTaken: 0,
    partsRemaining: 1,
    partCount: 1,
    healthRemaining: 1,
    healthTotal: 1,
    pressureTicks,
    mobileAtEnd: true,
    total,
  };
}

const BARE_CORE: BotDesign = {
  name: "Bare",
  parts: [{ iid: "core", partId: "core-cube" }],
  connections: [],
};

const opponent = bot("Impaler", [
  part({ iid: "ocore", name: "Cube Core", category: "core" }),
]);

describe("clockFromTicks", () => {
  it("formats sixty ticks a second as m:ss", () => {
    expect(clockFromTicks(0)).toBe("0:00");
    expect(clockFromTicks(720)).toBe("0:12");
    expect(clockFromTicks(3600)).toBe("1:00");
    expect(clockFromTicks(3659)).toBe("1:00");
  });
});

describe("suggestWeapon", () => {
  it("prefers an owned weapon by reach, skipping the one in hand, and falls back to the ladder", () => {
    expect(suggestWeapon(["ram-spike", "saw-blade"], null)).toBe("saw-blade");
    expect(suggestWeapon(["ram-spike"], "ram-spike")).toBe("lance");
    expect(suggestWeapon([], null)).toBe("lance");
    expect(suggestWeapon(undefined, "lance")).toBe("saw-blade");
  });
});

describe("buildDebrief", () => {
  it("headlines each outcome and reason with the clock", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageDealt: 10,
      }),
    ]);
    const base = {
      teardown: teardown(mine, opponent, 1200),
      scores: null,
      me: 1 as const,
      design: TEST_BOT_DESIGN,
    };
    expect(
      buildDebrief({ ...base, winner: 1, reason: "disable" }).headline,
    ).toBe("You won by knockout at 0:20");
    expect(
      buildDebrief({ ...base, winner: 0, reason: "timeout" }).headline,
    ).toBe("You lost by decision at 0:20");
    expect(
      buildDebrief({ ...base, winner: null, reason: "disable" }).headline,
    ).toBe("Draw by knockout at 0:20");
  });

  it("tells a bot with no weapon to mount one, and points at a weapon to browse", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageTaken: 40,
      }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent),
      winner: 0,
      reason: "timeout",
      scores: [score(40), score(5)],
      me: 1,
      design: BARE_CORE,
      ownedPartIds: [],
    });
    expect(debrief.lessons[0]).toMatchObject({
      id: "no-hits",
      action: { kind: "browse", partId: "lance" },
      actionLabel: "Pick a weapon",
    });
    expect(debrief.lessons[0].text).toContain("has no weapon");
  });

  it("tells a bot whose weapon never connected to try another reach", () => {
    const mine = bot("Mine", [
      part({ iid: "core", name: "Cube Core", category: "core" }),
      part({ iid: "spike", name: "Ram Spike", category: "weapon" }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent),
      winner: 0,
      reason: "timeout",
      scores: [score(10), score(3)],
      me: 1,
      design: TEST_BOT_DESIGN,
      ownedPartIds: ["ram-spike", "saw-blade"],
    });
    const lesson = debrief.lessons[0];
    expect(lesson.id).toBe("no-hits");
    expect(lesson.text).toContain("Ram Spike never connected");
    expect(lesson.action).toEqual({ kind: "browse", partId: "saw-blade" });
  });

  it("still calls a weapon unconnected when only the hull dealt damage", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageDealt: 30,
        damageTaken: 10,
      }),
      part({ iid: "spike", name: "Ram Spike", category: "weapon" }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent),
      winner: 0,
      reason: "timeout",
      scores: [score(20), score(9)],
      me: 1,
      design: TEST_BOT_DESIGN,
    });
    expect(debrief.lessons[0].id).toBe("no-hits");
    expect(debrief.lessons[0].text).toContain("Ram Spike never connected");
  });

  it("names the first part lost, what took it, and selects it to fix", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageTaken: 10,
      }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 30,
      }),
      part({
        iid: "wheel-l",
        name: "Drive Wheel",
        category: "mobility",
        destroyed: true,
        destroyedAtTick: 420,
        killedByName: "Lance",
        damageTaken: 60,
      }),
      part({
        iid: "wheel-r",
        name: "Drive Wheel",
        category: "mobility",
        destroyed: true,
        destroyedAtTick: 900,
        killedByName: "Lance",
        damageTaken: 60,
      }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: TEST_BOT_DESIGN,
    });
    expect(debrief.lessons[0]).toMatchObject({
      id: "first-loss",
      action: { kind: "select", iid: "wheel-l" },
      actionLabel: "Show that part",
    });
    expect(debrief.lessons[0].text).toContain(
      "went first at 0:07, taken by Lance",
    );
  });

  it("sends a core that went down alone to the plates", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        destroyed: true,
        destroyedAtTick: 600,
        damageTaken: 120,
      }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 5,
      }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: TEST_BOT_DESIGN,
    });
    expect(debrief.lessons[0]).toMatchObject({
      id: "first-loss",
      action: { kind: "browse", partId: PLATE_SUGGESTION },
    });
    expect(debrief.lessons[0].text).toContain("Your core went down at 0:10");
  });

  it("names the part that soaked the damage when nothing was lost", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageTaken: 10,
      }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 40,
      }),
      part({ iid: "plate", name: "Frame Plate", damageTaken: 70 }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent),
      winner: 1,
      reason: "disable",
      scores: null,
      me: 1,
      design: TEST_BOT_DESIGN,
    });
    expect(debrief.lessons[0]).toMatchObject({
      id: "soak",
      action: { kind: "browse", partId: PLATE_SUGGESTION },
    });
    expect(debrief.lessons[0].text).toContain(
      "Frame Plate took 88% of the damage",
    );
  });

  it("reads the judges' card on a decision and opens Tune", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageTaken: 10,
      }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 12,
      }),
      part({ iid: "plate", name: "Frame Plate", damageTaken: 10 }),
      part({ iid: "wheel", name: "Drive Wheel", damageTaken: 10 }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent, 3600),
      winner: 0,
      reason: "timeout",
      scores: [score(61.4), score(40.2)],
      me: 1,
      design: TEST_BOT_DESIGN,
    });
    expect(debrief.headline).toBe("You lost by decision at 1:00");
    expect(debrief.lessons[0]).toMatchObject({
      id: "decision",
      action: { kind: "tune" },
      actionLabel: "Open Tune",
    });
    expect(debrief.lessons[0].text).toContain("61 to 40");
  });

  it("after a win, names the survivor that nearly did not, or calls it clean", () => {
    const worn = bot("Mine", [
      part({ iid: "core", name: "Cube Core", category: "core" }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 90,
      }),
      part({
        iid: "wheel-l",
        name: "Drive Wheel",
        category: "mobility",
        health: 30,
        maxHealth: 120,
        damageTaken: 90,
      }),
      part({
        iid: "wheel-r",
        name: "Drive Wheel",
        category: "mobility",
        health: 120,
        maxHealth: 120,
      }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(worn, opponent),
      winner: 1,
      reason: "disable",
      scores: null,
      me: 1,
      design: TEST_BOT_DESIGN,
    });
    // The wheel soaked every point and came home at a quarter: the soak
    // lesson leads, the weakest-survivor lesson follows, both on the wheel.
    expect(debrief.lessons.map((l) => l.id)).toEqual(["soak", "weakest"]);
    expect(debrief.lessons[1].text).toContain("Drive Wheel came home at 25%");
    expect(debrief.lessons[1].action).toEqual({
      kind: "select",
      iid: "wheel-l",
    });

    const clean = bot("Mine", [
      part({ iid: "core", name: "Cube Core", category: "core" }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 90,
      }),
    ]);
    const cleanDebrief = buildDebrief({
      teardown: teardown(clean, opponent),
      winner: 1,
      reason: "disable",
      scores: null,
      me: 1,
      design: TEST_BOT_DESIGN,
    });
    expect(cleanDebrief.lessons).toEqual([
      expect.objectContaining({ id: "clean", action: null, actionLabel: null }),
    ]);
    expect(cleanDebrief.lessons[0].text).toContain("Impaler could not answer");
  });

  it("reads a decision lost off the front foot as the throttle lever (H1)", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageTaken: 10,
      }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 12,
      }),
      part({ iid: "plate", name: "Frame Plate", damageTaken: 10 }),
      part({ iid: "wheel", name: "Drive Wheel", damageTaken: 10 }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent, 3600),
      winner: 0,
      reason: "timeout",
      scores: [score(61, 1800), score(40, 360)],
      me: 1,
      design: {
        ...TEST_BOT_DESIGN,
        behavior: { aggression: 0.5, flankBias: 0.5, patience: 0.5 },
      },
    });
    expect(debrief.lessons[0]).toMatchObject({
      id: "decision",
      action: {
        kind: "behavior",
        patch: { aggression: 0.5 + AGGRESSION_STEP },
      },
      actionLabel: "Raise aggression",
    });
    expect(debrief.lessons[0].text).toContain(
      "front foot 10% of the fight to their 50%",
    );
    // Already relentless: the lever has nowhere to go, so Tune it is.
    const maxed = buildDebrief({
      teardown: teardown(mine, opponent, 3600),
      winner: 0,
      reason: "timeout",
      scores: [score(61, 1800), score(40, 360)],
      me: 1,
      design: {
        ...TEST_BOT_DESIGN,
        behavior: { aggression: 1, flankBias: 0.5, patience: 0.5 },
      },
    });
    expect(maxed.lessons[0]).toMatchObject({
      id: "decision",
      action: { kind: "tune" },
    });
  });

  it("reads a knockout taken in the pocket as the patience lever (H1)", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageTaken: 100,
        destroyed: true,
        destroyedAtTick: 900,
        killedByName: "Saw Blade",
      }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 20,
      }),
      part({ iid: "wheel", name: "Drive Wheel", damageTaken: 60 }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: {
        ...TEST_BOT_DESIGN,
        behavior: { aggression: 0.5, flankBias: 0.5, patience: 0.4 },
      },
    });
    // The core went first, then the pocket lesson; the soak detail is cut.
    expect(debrief.lessons.map((l) => l.id)).toEqual(["first-loss", "resets"]);
    expect(debrief.lessons[1]).toMatchObject({
      action: { kind: "behavior", patch: { patience: 0.4 + PATIENCE_STEP } },
      actionLabel: "Raise patience",
    });
    expect(debrief.lessons[1].text).toContain("gave 20 and took 160");
  });

  it("caps the lessons and keeps the priority order", () => {
    const mine = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageTaken: 10,
      }),
      part({
        iid: "wheel-l",
        name: "Drive Wheel",
        category: "mobility",
        destroyed: true,
        destroyedAtTick: 300,
        killedByName: "Saw Blade",
        damageTaken: 20,
      }),
      part({ iid: "plate", name: "Frame Plate", damageTaken: 70 }),
    ]);
    const debrief = buildDebrief({
      teardown: teardown(mine, opponent, 3600),
      winner: 0,
      reason: "timeout",
      scores: [score(50), score(10)],
      me: 1,
      design: BARE_CORE,
      ownedPartIds: [],
    });
    // Four rules fire (no hits, first loss, decision, soak); two show.
    expect(debrief.lessons).toHaveLength(DEBRIEF_MAX_LESSONS);
    expect(debrief.lessons.map((l) => l.id)).toEqual(["no-hits", "first-loss"]);
  });

  it("reads the player's side wherever it sits", () => {
    const mine = bot("Mine", [
      part({ iid: "core", name: "Cube Core", category: "core" }),
      part({
        iid: "spike",
        name: "Ram Spike",
        category: "weapon",
        damageDealt: 50,
      }),
    ]);
    const swapped: MatchTeardown = {
      ...teardown(mine, opponent),
      bots: [mine, opponent],
    };
    const debrief = buildDebrief({
      teardown: swapped,
      winner: 0,
      reason: "disable",
      scores: null,
      me: 0,
      design: TEST_BOT_DESIGN,
    });
    expect(debrief.headline).toBe("You won by knockout at 0:20");
    expect(debrief.lessons[0].id).toBe("clean");
  });
});

describe("buildDebrief and bench rules (F-247)", () => {
  const RAMMER: BotDesign = {
    name: "Rammer",
    parts: [
      { iid: "core", partId: "core-cube" },
      { iid: "spike", partId: "ram-spike" },
    ],
    connections: [],
  };
  const lostSpike = bot("Mine", [
    part({ iid: "core", name: "Cube Core", category: "core", damageTaken: 60 }),
    part({
      iid: "spike",
      name: "Ram Spike",
      category: "weapon",
      damageDealt: 20,
      destroyed: true,
      destroyedAtTick: 600,
      killedBy: "obar",
      killedByName: "Spinner Bar",
    }),
  ]);
  const rival = bot("Rival", [
    part({ iid: "ocore", name: "Cube Core", category: "core" }),
    part({ iid: "obar", name: "Spinner Bar", category: "weapon" }),
  ]);

  it("offers the weapon-down rule when the weapon went down and the bot fought on", () => {
    const debrief = buildDebrief({
      teardown: teardown(lostSpike, rival, 2400),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
    });
    const lesson = debrief.lessons.find((l) => l.id === "rule");
    expect(lesson).toMatchObject({
      action: {
        kind: "rule",
        rule: { when: "weapon-down", act: "disengage" },
      },
      actionLabel: "Add the rule",
    });
    expect(lesson?.text).toContain("went down at 0:10");
    expect(lesson?.text).toContain("fought on without it for 0:30");
    expect(lesson?.text).toContain("When my weapon is down, back off.");
  });

  it("stays quiet when the rule is already there, the weapon survived, the end came fast, or the bot won", () => {
    const has = buildDebrief({
      teardown: teardown(lostSpike, rival, 2400),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: {
        ...RAMMER,
        rules: [{ when: "weapon-down", act: "hold" }],
      },
    });
    expect(has.lessons.map((l) => l.id)).not.toContain("rule");
    const quick = buildDebrief({
      teardown: teardown(lostSpike, rival, 700),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
    });
    expect(quick.lessons.map((l) => l.id)).not.toContain("rule");
    const won = buildDebrief({
      teardown: teardown(lostSpike, rival, 2400),
      winner: 1,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
    });
    expect(won.lessons.map((l) => l.id)).not.toContain("rule");
  });
});

describe("buildDebrief and the weapon angle (second lever)", () => {
  const RAMMER: BotDesign = {
    name: "Rammer",
    parts: [
      { iid: "core", partId: "core-cube" },
      { iid: "spike", partId: "ram-spike" },
    ],
    connections: [
      {
        parentIid: "core",
        parentConnector: "front",
        childIid: "spike",
        childConnector: "mount",
      },
    ],
  };
  const mine = bot("Mine", [
    part({ iid: "core", name: "Cube Core", category: "core", damageTaken: 40 }),
    part({
      iid: "spike",
      name: "Ram Spike",
      category: "weapon",
      damageDealt: 30,
    }),
  ]);
  const gravestone = bot("Gravestone", [
    part({ iid: "ocore", name: "Cube Core", category: "core" }),
  ]);

  it("leads a loss to Gravestone with the free tilt when the spike sits level, then the counter to buy", () => {
    const debrief = buildDebrief({
      teardown: teardown(mine, gravestone),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
      rungId: "gravestone",
    });
    expect(debrief.lessons[0]).toMatchObject({
      id: "pitch",
      action: { kind: "pitch", iid: "spike", pitch: 15 },
      actionLabel: "Tilt it up 15",
    });
    expect(debrief.lessons[0].text).toContain("tilted up 15");
    expect(debrief.lessons[1]?.id).toBe("counter");
  });

  it("stays quiet when the spike is already tilted, the rung has no tilt to teach, or the bot won", () => {
    const tilted = buildDebrief({
      teardown: teardown(mine, gravestone),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: {
        ...RAMMER,
        connections: [{ ...RAMMER.connections[0], pitch: 15 }],
      },
      rungId: "gravestone",
    });
    expect(tilted.lessons.map((l) => l.id)).not.toContain("pitch");
    const brawler = buildDebrief({
      teardown: teardown(mine, gravestone),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
      rungId: "brawler",
    });
    expect(brawler.lessons.map((l) => l.id)).not.toContain("pitch");
    const won = buildDebrief({
      teardown: teardown(mine, gravestone),
      winner: 1,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
      rungId: "gravestone",
    });
    expect(won.lessons.map((l) => l.id)).not.toContain("pitch");
  });
});

describe("buildDebrief on the ladder (F-250)", () => {
  const RAMMER: BotDesign = {
    name: "Rammer",
    parts: [
      { iid: "core", partId: "core-cube" },
      { iid: "spike", partId: "ram-spike" },
    ],
    connections: [],
  };
  const mine = bot("Mine", [
    part({ iid: "core", name: "Cube Core", category: "core", damageTaken: 40 }),
    part({
      iid: "spike",
      name: "Ram Spike",
      category: "weapon",
      damageDealt: 30,
    }),
  ]);
  const gravestone = bot("Gravestone", [
    part({ iid: "ocore", name: "Cube Core", category: "core" }),
  ]);

  it("leads a loss to a rung with the counter the ladder test proves, and browses it", () => {
    const debrief = buildDebrief({
      teardown: teardown(mine, gravestone),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
      rungId: "gravestone",
    });
    expect(debrief.lessons[0]).toMatchObject({
      id: "counter",
      action: { kind: "browse", partId: "tempered-lance" },
      actionLabel: "Browse the Tempered Lance",
    });
    expect(debrief.lessons[0].text).toContain("Gravestone eats lances");
    expect(debrief.lessons[0].text).toContain("Tempered Lance");
  });

  it("says nothing about the counter after a win, for a rival, or when the bot already carries it", () => {
    const won = buildDebrief({
      teardown: teardown(mine, gravestone),
      winner: 1,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
      rungId: "gravestone",
    });
    expect(won.lessons.map((lesson) => lesson.id)).not.toContain("counter");
    const rival = buildDebrief({
      teardown: teardown(mine, gravestone),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: RAMMER,
    });
    expect(rival.lessons.map((lesson) => lesson.id)).not.toContain("counter");
    const carried = buildDebrief({
      teardown: teardown(mine, gravestone),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: {
        ...RAMMER,
        parts: [
          { iid: "core", partId: "core-cube" },
          { iid: "lance", partId: "tempered-lance" },
        ],
      },
      rungId: "gravestone",
    });
    expect(carried.lessons.map((lesson) => lesson.id)).not.toContain("counter");
  });

  it("keeps the weapon lesson first for a weaponless bot and points it at the rung's counter", () => {
    const bare = bot("Mine", [
      part({
        iid: "core",
        name: "Cube Core",
        category: "core",
        damageTaken: 40,
      }),
    ]);
    const impaler = buildDebrief({
      teardown: teardown(bare, opponent),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: BARE_CORE,
      rungId: "impaler",
    });
    expect(impaler.lessons[0]).toMatchObject({
      id: "no-hits",
      action: { kind: "browse", partId: "lance" },
      actionLabel: "Pick a weapon",
    });
    expect(impaler.lessons[0].text).toContain("This bot has no weapon");
    expect(impaler.lessons[0].text).toContain("Impaler punishes a spike");
    // Bulldozer's counter is a core, so the weapon lesson still picks a
    // weapon while its text names the rung.
    const bulldozer = buildDebrief({
      teardown: teardown(bare, opponent),
      winner: 0,
      reason: "disable",
      scores: null,
      me: 1,
      design: BARE_CORE,
      rungId: "bulldozer",
    });
    expect(bulldozer.lessons[0].id).toBe("no-hits");
    expect(bulldozer.lessons[0].text).toContain("Bulldozer outshoves a cube");
    expect(bulldozer.lessons[0].action).not.toMatchObject({
      partId: "tower-core",
    });
  });
});
