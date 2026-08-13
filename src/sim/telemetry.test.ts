import { describe, expect, it } from "vitest";
import { createArenaWorld } from "./arena";
import {
  combatStateString,
  createMatch,
  freeMatch,
  stepMatch,
  teardownInputFrom,
} from "./combat";
import { CPU_WHIRLIGIG_DESIGN, TEST_BOT_DESIGN } from "./design";
import { matchResultHash } from "./resolve";
import {
  buildTeardown,
  createTelemetry,
  type ImpactEvent,
  MAX_TELEMETRY_IMPACTS,
  type MatchTelemetry,
  recordImpact,
  TEARDOWN_HIGHLIGHT_COUNT,
  type TeardownInput,
} from "./telemetry";

function impact(over: Partial<ImpactEvent> = {}): ImpactEvent {
  return {
    tick: 10,
    attackerBot: 0,
    attackerIid: "spike",
    victimBot: 1,
    victimIid: "core",
    force: 60,
    damage: 5,
    weapon: true,
    ...over,
  };
}

/** Records through the primitive-argument API the frame path uses. */
function log(telemetry: MatchTelemetry, over: Partial<ImpactEvent> = {}): void {
  const event = impact(over);
  recordImpact(
    telemetry,
    event.tick,
    event.attackerBot,
    event.attackerIid,
    event.victimBot,
    event.victimIid,
    event.force,
    event.damage,
    event.weapon,
  );
}

function input(over: Partial<TeardownInput> = {}): TeardownInput {
  return {
    telemetry: createTelemetry(),
    ticks: 100,
    bots: [
      {
        name: "A",
        parts: [
          {
            iid: "core",
            partId: "core-cube",
            name: "Cube Core",
            category: "core",
            health: 180,
            maxHealth: 180,
            destroyed: false,
          },
          {
            iid: "spike",
            partId: "ram-spike",
            name: "Ram Spike",
            category: "weapon",
            health: 150,
            maxHealth: 150,
            destroyed: false,
          },
        ],
      },
      {
        name: "B",
        parts: [
          {
            iid: "core",
            partId: "core-cube",
            name: "Cube Core",
            category: "core",
            health: 0,
            maxHealth: 180,
            destroyed: true,
          },
          {
            iid: "wheel",
            partId: "drive-wheel",
            name: "Drive Wheel",
            category: "mobility",
            health: 20,
            maxHealth: 80,
            destroyed: false,
          },
        ],
      },
    ],
    ...over,
  };
}

describe("telemetry recording", () => {
  it("caps the impact log but keeps the count honest", () => {
    const telemetry = createTelemetry();
    for (let i = 0; i < MAX_TELEMETRY_IMPACTS + 25; i++) {
      log(telemetry, { tick: i });
    }
    expect(telemetry.logged).toBe(MAX_TELEMETRY_IMPACTS);
    expect(telemetry.impactCount).toBe(MAX_TELEMETRY_IMPACTS + 25);
    expect(telemetry.truncated).toBe(true);
  });

  it("keeps exact damage totals after the log truncates", () => {
    // The teardown must never under-report a long fight: the log is a
    // bounded sample, the tallies are the truth.
    const telemetry = createTelemetry();
    const total = MAX_TELEMETRY_IMPACTS + 500;
    for (let i = 0; i < total; i++) {
      log(telemetry, { tick: i, damage: 2 });
    }
    expect(telemetry.truncated).toBe(true);

    const teardown = buildTeardown(input({ telemetry }));
    const attacker = teardown.bots[0].parts.find((p) => p.iid === "spike");
    const victim = teardown.bots[1].parts.find((p) => p.iid === "core");
    expect(attacker?.damageDealt).toBe(total * 2);
    expect(attacker?.hitsDealt).toBe(total);
    expect(victim?.damageTaken).toBe(total * 2);
    expect(victim?.hitsTaken).toBe(total);
    expect(teardown.bots[1].damageTaken).toBe(total * 2);
    expect(teardown.totalImpacts).toBe(total);
    expect(teardown.truncated).toBe(true);
  });

  it("still names the killing blow in a truncated match", () => {
    const telemetry = createTelemetry();
    // The real killer lands first, then the log fills past its cap with
    // chip damage. The big hit is outside the retained window, so only the
    // running tally can still name it. It has to outweigh the whole chip
    // total, not just one chip.
    log(telemetry, { attackerIid: "spike", damage: 9000 });
    for (let i = 0; i < MAX_TELEMETRY_IMPACTS + 10; i++) {
      log(telemetry, { attackerIid: "core", damage: 1, tick: i });
    }
    telemetry.destructions.push({ tick: 99, bot: 1, iid: "core" });
    const teardown = buildTeardown(input({ telemetry }));
    expect(teardown.bots[1].parts.find((p) => p.iid === "core")?.killedBy).toBe(
      "spike",
    );
  });

  it("reuses log slots instead of allocating per impact", () => {
    // stepMatch runs inside the arena's useFrame, so the record path must
    // not build a new object every hit (frame-loop rule).
    const telemetry = createTelemetry();
    log(telemetry, { damage: 1 });
    const firstSlot = telemetry.impacts[0];
    log(telemetry, { damage: 2 });
    telemetry.logged = 0;
    log(telemetry, { damage: 3 });
    expect(telemetry.impacts[0]).toBe(firstSlot);
    expect(telemetry.impacts[0].damage).toBe(3);
  });
});

describe("buildTeardown", () => {
  it("attributes damage to both the striking and the struck part", () => {
    const telemetry = createTelemetry();
    log(telemetry, { damage: 12 });
    log(telemetry, { damage: 8 });
    const teardown = buildTeardown(input({ telemetry }));

    const attacker = teardown.bots[0].parts.find((p) => p.iid === "spike");
    const victim = teardown.bots[1].parts.find((p) => p.iid === "core");
    expect(attacker?.damageDealt).toBe(20);
    expect(attacker?.hitsDealt).toBe(2);
    expect(attacker?.damageTaken).toBe(0);
    expect(victim?.damageTaken).toBe(20);
    expect(victim?.hitsTaken).toBe(2);
    expect(teardown.bots[0].damageDealt).toBe(20);
    expect(teardown.bots[1].damageTaken).toBe(20);
  });

  it("names the part that did the most damage to a destroyed part", () => {
    const telemetry = createTelemetry();
    log(telemetry, { attackerIid: "core", damage: 4 });
    log(telemetry, { attackerIid: "spike", damage: 30 });
    telemetry.destructions.push({ tick: 42, bot: 1, iid: "core" });
    const teardown = buildTeardown(input({ telemetry }));

    const victim = teardown.bots[1].parts.find((p) => p.iid === "core");
    expect(victim?.killedBy).toBe("spike");
    expect(victim?.destroyedAtTick).toBe(42);
    expect(teardown.bots[1].firstLossTick).toBe(42);
    expect(teardown.bots[1].partsLost).toBe(1);
  });

  it("leaves killedBy null for parts that survived", () => {
    const telemetry = createTelemetry();
    log(telemetry, { victimIid: "wheel", damage: 60 });
    const teardown = buildTeardown(input({ telemetry }));

    const survivor = teardown.bots[1].parts.find((p) => p.iid === "wheel");
    expect(survivor?.damageTaken).toBe(60);
    expect(survivor?.killedBy).toBeNull();
    expect(survivor?.destroyedAtTick).toBeNull();
    expect(teardown.bots[1].firstLossTick).toBeNull();
  });

  it("ranks the hardest hits by damage and names both parts", () => {
    const telemetry = createTelemetry();
    for (const damage of [1, 9, 3, 40, 7, 22, 15]) {
      log(telemetry, { damage });
    }
    const teardown = buildTeardown(input({ telemetry }));

    expect(teardown.hardestHits).toHaveLength(TEARDOWN_HIGHLIGHT_COUNT);
    expect(teardown.hardestHits.map((h) => h.damage)).toEqual([
      40, 22, 15, 9, 7,
    ]);
    expect(teardown.hardestHits[0].attackerPartName).toBe("Ram Spike");
    expect(teardown.hardestHits[0].victimPartName).toBe("Cube Core");
  });

  it("is order-stable when damage ties", () => {
    const telemetry = createTelemetry();
    log(telemetry, { damage: 5, tick: 3, victimIid: "wheel" });
    log(telemetry, { damage: 5, tick: 1, victimIid: "core" });
    const first = buildTeardown(input({ telemetry }));
    const second = buildTeardown(input({ telemetry }));
    expect(first.hardestHits.map((h) => h.victimIid)).toEqual(
      second.hardestHits.map((h) => h.victimIid),
    );
    expect(first.hardestHits[0].tick).toBe(1);
  });
});

describe("recorded matches", () => {
  it("produce the identical fight as unrecorded ones", async () => {
    const run = async (telemetry: boolean) => {
      const world = await createArenaWorld();
      const match = createMatch(
        world,
        [CPU_WHIRLIGIG_DESIGN, TEST_BOT_DESIGN],
        { telemetry },
      );
      for (let i = 0; i < 600 && !match.status.over; i++) stepMatch(match);
      const result = {
        hash: matchResultHash(match),
        state: combatStateString(match),
        tick: match.tick,
        teardown: teardownInputFrom(match),
      };
      freeMatch(match);
      world.free();
      return result;
    };

    const recorded = await run(true);
    const plain = await run(false);
    expect(recorded.hash).toBe(plain.hash);
    expect(recorded.state).toBe(plain.state);
    expect(recorded.tick).toBe(plain.tick);
    expect(plain.teardown).toBeNull();
    expect(recorded.teardown).not.toBeNull();
  });

  it("record impacts that reconcile with the combat damage totals", async () => {
    const world = await createArenaWorld();
    const match = createMatch(world, [CPU_WHIRLIGIG_DESIGN, TEST_BOT_DESIGN], {
      telemetry: true,
    });
    for (let i = 0; i < 900 && !match.status.over; i++) stepMatch(match);

    const teardownInput = teardownInputFrom(match);
    expect(teardownInput).not.toBeNull();
    if (!teardownInput) throw new Error("recorded match lost its telemetry");
    const teardown = buildTeardown(teardownInput);

    expect(teardown.totalImpacts).toBeGreaterThan(0);
    expect(teardown.truncated).toBe(false);
    for (const [index, bot] of teardown.bots.entries()) {
      // The log is the same damage the scoreboard counted, to float noise.
      expect(bot.damageTaken).toBeCloseTo(match.bots[index].damageTaken, 6);
      expect(bot.damageDealt).toBeCloseTo(match.bots[index].damageDealt, 6);
      // A part sheet row exists for every design part, in design order.
      expect(bot.parts.map((p) => p.iid)).toEqual(
        match.bots[index].design.parts.map((p) => p.iid),
      );
    }

    // Destroyed parts carry the tick they died and who did it.
    for (const [index, bot] of teardown.bots.entries()) {
      for (const part of bot.parts) {
        const live = match.bots[index].parts.get(part.iid);
        expect(part.destroyed).toBe(live?.destroyed);
        if (part.destroyed) expect(part.destroyedAtTick).not.toBeNull();
      }
    }

    freeMatch(match);
    world.free();
  });
});
