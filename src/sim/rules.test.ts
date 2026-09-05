import { describe, expect, it } from "vitest";
import { type RuleView, ruleHolds } from "./combat";
import { type BotDesign, botDesignSchema, TEST_BOT_DESIGN } from "./design";
import { FIGHT_LADDER } from "./opponents";
import { resolveMatch } from "./resolve";

// The stock brawler, the ladder's first rung: nothing up front.
const BRAWLER = FIGHT_LADDER[0].design;

const view = (over: Partial<RuleView> = {}): RuleView => ({
  hadWeapon: true,
  hasWeapon: true,
  enemyHasWeapon: true,
  enemyMobile: true,
  coreHealthRatio: 1,
  tick: 0,
  timeLimitTicks: 3600,
  targetDistance: 2,
  hadMobility: true,
  mobilityRatio: 1,
  ...over,
});

describe("ruleHolds (F-247)", () => {
  it("reads each condition from the tick's view and nothing else", () => {
    expect(ruleHolds("weapon-down", view())).toBe(false);
    expect(ruleHolds("weapon-down", view({ hasWeapon: false }))).toBe(true);
    // A design that never had a weapon has not lost one.
    expect(
      ruleHolds("weapon-down", view({ hadWeapon: false, hasWeapon: false })),
    ).toBe(false);
    expect(ruleHolds("enemy-weapon-down", view())).toBe(false);
    expect(
      ruleHolds("enemy-weapon-down", view({ enemyHasWeapon: false })),
    ).toBe(true);
    expect(ruleHolds("enemy-immobile", view())).toBe(false);
    expect(ruleHolds("enemy-immobile", view({ enemyMobile: false }))).toBe(
      true,
    );
    expect(ruleHolds("core-hurt", view({ coreHealthRatio: 0.4 }))).toBe(false);
    expect(ruleHolds("core-hurt", view({ coreHealthRatio: 0.39 }))).toBe(true);
    expect(ruleHolds("clock-late", view({ tick: 2399 }))).toBe(false);
    expect(ruleHolds("clock-late", view({ tick: 2400 }))).toBe(true);
    // The second vocabulary: range, own drive, the early clock.
    expect(ruleHolds("enemy-close", view({ targetDistance: 1.2 }))).toBe(false);
    expect(ruleHolds("enemy-close", view({ targetDistance: 1.19 }))).toBe(true);
    expect(ruleHolds("enemy-far", view({ targetDistance: 3 }))).toBe(false);
    expect(ruleHolds("enemy-far", view({ targetDistance: 3.01 }))).toBe(true);
    expect(ruleHolds("wheel-lost", view())).toBe(false);
    expect(ruleHolds("wheel-lost", view({ mobilityRatio: 0.5 }))).toBe(true);
    // A design that never had a wheel has not lost one.
    expect(
      ruleHolds("wheel-lost", view({ hadMobility: false, mobilityRatio: 0 })),
    ).toBe(false);
    expect(ruleHolds("clock-early", view({ tick: 1199 }))).toBe(true);
    expect(ruleHolds("clock-early", view({ tick: 1200 }))).toBe(false);
  });
});

describe("the second rule vocabulary, measured on the ladder", () => {
  const withRules = (rules: BotDesign["rules"]): BotDesign => ({
    ...TEST_BOT_DESIGN,
    rules,
  });
  const headstone = FIGHT_LADDER.find((rung) => rung.id === "headstone");
  if (!headstone) throw new Error("headstone missing");

  it("an arm's-reach charge, and an arm's-reach hold, each beat the top rung the starter build loses to", async () => {
    expect(headstone.id).toBe("headstone");
    const none = await resolveMatch([headstone.design, TEST_BOT_DESIGN]);
    expect(none.status.over && none.status.winner).toBe(0);
    const charge = await resolveMatch([
      headstone.design,
      withRules([{ when: "enemy-close", act: "charge" }]),
    ]);
    expect(charge.status.over && charge.status.winner).toBe(1);
    const hold = await resolveMatch([
      headstone.design,
      withRules([{ when: "enemy-close", act: "hold" }]),
    ]);
    expect(hold.status.over && hold.status.winner).toBe(1);
    // The rung names the charge as its free rule, and the test above is
    // what proves it (the same contract as F-250's counters).
    expect(headstone.ruleCounter?.rule).toEqual({
      when: "enemy-close",
      act: "charge",
    });
  }, 60_000);

  it("a rule that never holds leaves the fight byte-identical: no wheel is lost against the brawler", async () => {
    const none = await resolveMatch([BRAWLER, TEST_BOT_DESIGN]);
    const wheel = await resolveMatch([
      BRAWLER,
      withRules([{ when: "wheel-lost", act: "disengage" }]),
    ]);
    expect(wheel.hash).toBe(none.hash);
  }, 30_000);
});

describe("bench rules in a match (F-234, F-247)", () => {
  const withRules = (rules: BotDesign["rules"]): BotDesign => ({
    ...TEST_BOT_DESIGN,
    rules,
  });

  it("validates up to three rules from the fixed lists and nothing else", () => {
    const three = withRules([
      { when: "weapon-down", act: "disengage" },
      { when: "enemy-weapon-down", act: "charge" },
      { when: "clock-late", act: "hold" },
    ]);
    expect(botDesignSchema.safeParse(three).success).toBe(true);
    const four = withRules([
      ...(three.rules ?? []),
      { when: "core-hurt", act: "hold" },
    ]);
    expect(botDesignSchema.safeParse(four).success).toBe(false);
    const unknown = {
      ...TEST_BOT_DESIGN,
      rules: [{ when: "always", act: "disengage" }],
    };
    expect(botDesignSchema.safeParse(unknown).success).toBe(false);
  });

  it("an empty list is the same fight as no list, byte for byte", async () => {
    const none = await resolveMatch([BRAWLER, TEST_BOT_DESIGN]);
    const empty = await resolveMatch([BRAWLER, withRules([])]);
    expect(empty.hash).toBe(none.hash);
    expect(empty.status).toEqual(none.status);
  }, 30_000);

  it("one rule changes the fight: holding against a weaponless brawler, or charging it", async () => {
    // The stock brawler has nothing up front, so "their weapon is down"
    // holds from the first tick: a bot told to hold still never closes,
    // and the win the starter build takes off it goes away.
    const none = await resolveMatch([BRAWLER, TEST_BOT_DESIGN]);
    expect(none.status.over && none.status.winner).toBe(1);
    const hold = await resolveMatch([
      BRAWLER,
      withRules([{ when: "enemy-weapon-down", act: "hold" }]),
    ]);
    expect(hold.hash).not.toBe(none.hash);
    expect(hold.status.over && hold.status.winner === 1).toBe(false);
    const charge = await resolveMatch([
      BRAWLER,
      withRules([{ when: "enemy-weapon-down", act: "charge" }]),
    ]);
    expect(charge.hash).not.toBe(none.hash);
    // The first rule that holds wins: a rule that never holds ahead of
    // the hold rule leaves the hold in charge.
    const ordered = await resolveMatch([
      BRAWLER,
      withRules([
        { when: "weapon-down", act: "charge" },
        { when: "enemy-weapon-down", act: "hold" },
      ]),
    ]);
    expect(ordered.hash).toBe(hold.hash);
  }, 60_000);
});
