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
      recordImpact(telemetry, impact({ tick: i }));
    }
    expect(telemetry.impacts).toHaveLength(MAX_TELEMETRY_IMPACTS);
    expect(telemetry.impactCount).toBe(MAX_TELEMETRY_IMPACTS + 25);
    expect(telemetry.truncated).toBe(true);
  });
});

describe("buildTeardown", () => {
  it("attributes damage to both the striking and the struck part", () => {
    const telemetry = createTelemetry();
    recordImpact(telemetry, impact({ damage: 12 }));
    recordImpact(telemetry, impact({ damage: 8 }));
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
    recordImpact(telemetry, impact({ attackerIid: "core", damage: 4 }));
    recordImpact(telemetry, impact({ attackerIid: "spike", damage: 30 }));
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
    recordImpact(telemetry, impact({ victimIid: "wheel", damage: 60 }));
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
      recordImpact(telemetry, impact({ damage }));
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
    recordImpact(telemetry, impact({ damage: 5, tick: 3, victimIid: "wheel" }));
    recordImpact(telemetry, impact({ damage: 5, tick: 1, victimIid: "core" }));
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
