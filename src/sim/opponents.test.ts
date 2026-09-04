import { describe, expect, it } from "vitest";
import { BLUEPRINTS } from "./blueprints";
import { type BotDesign, TEST_BOT_DESIGN, validateDesign } from "./design";
import { FIGHT_LADDER, REPLICA_OPPONENTS } from "./opponents";
import { PART_CATALOG } from "./parts";
import { resolveMatch } from "./resolve";

describe("replica opponents", () => {
  it("has unique ids and models a distinct real bot each", () => {
    const ids = REPLICA_OPPONENTS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const inspirations = REPLICA_OPPONENTS.map((o) => o.inspiredBy);
    expect(new Set(inspirations).size).toBe(inspirations.length);
    expect(REPLICA_OPPONENTS.length).toBeGreaterThanOrEqual(3);
  });

  for (const opponent of REPLICA_OPPONENTS) {
    it(`${opponent.id} is a valid, in-budget design with exactly one core`, () => {
      const result = validateDesign(opponent.design);
      expect(result.ok).toBe(true);
      const cores = opponent.design.parts.filter(
        (p) => PART_CATALOG[p.partId]?.category === "core",
      );
      expect(cores).toHaveLength(1);
      // A non-trivial bot: a core plus drive and at least one non-core part.
      expect(opponent.design.parts.length).toBeGreaterThanOrEqual(4);
    });
  }
});

describe("fight ladder", () => {
  const rammer = BLUEPRINTS[0].design;

  it("lists every rung once, valid, with a hint, easiest first", () => {
    expect(rammer.name).toBe("Cube Rammer");
    const ids = FIGHT_LADDER.map((rung) => rung.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "brawler",
      "contagion",
      "night-terror",
      "bulldozer",
      "impaler",
      "gravestone",
      "headstone",
    ]);
    for (const rung of FIGHT_LADDER) {
      expect(validateDesign(rung.design).ok).toBe(true);
      expect(rung.hint.length).toBeGreaterThan(0);
      expect(rung.blurb.length).toBeGreaterThan(0);
    }
    // Every replica is on the ladder, so nothing the picker used to
    // offer went missing.
    for (const opponent of REPLICA_OPPONENTS) {
      expect(ids).toContain(opponent.id);
    }
  });

  it("is a real ladder for the first build, and the debrief's counter climbs it (H2, measured)", async () => {
    // The sim is deterministic, so these are facts about the build, not
    // odds: the Cube Rammer beats the first three rungs on the card and
    // loses to the last two.
    const outcomes: boolean[] = [];
    for (const rung of FIGHT_LADDER) {
      const result = await resolveMatch([rung.design, rammer]);
      expect(result.status.over).toBe(true);
      outcomes.push(result.status.over && result.status.winner === 1);
    }
    expect(outcomes).toEqual([true, true, true, false, false, false, false]);
    // The debrief's never-connected lesson sends a spike build to a
    // longer reach; a lance in the spike's place beats Impaler and then
    // meets the top rung, which beats it (H4), so the ladder keeps asking.
    const lanced = {
      ...rammer,
      name: "Cube Lancer",
      parts: rammer.parts.map((part) =>
        part.iid === "spike" ? { ...part, partId: "lance" } : part,
      ),
    };
    expect(validateDesign(lanced).ok).toBe(true);
    const impaler = FIGHT_LADDER[4];
    expect(impaler.id).toBe("impaler");
    const overImpaler = await resolveMatch([impaler.design, lanced]);
    expect(overImpaler.status.over && overImpaler.status.winner).toBe(1);
    const top = FIGHT_LADDER[FIGHT_LADDER.length - 1];
    expect(top.id).toBe("headstone");
    const lancerAtTop = await resolveMatch([top.design, lanced]);
    expect(lancerAtTop.status.over && lancerAtTop.status.winner).toBe(0);
    // And Gravestone's counter is a build a player can buy from wave two:
    // the tempered lance in the nose and a ballast block on the tail.
    const gravestone = FIGHT_LADDER[5];
    expect(gravestone.id).toBe("gravestone");
    const temperedTail = {
      ...rammer,
      name: "Tempered Tail",
      parts: [
        ...rammer.parts.map((part) =>
          part.iid === "spike" ? { ...part, partId: "tempered-lance" } : part,
        ),
        { iid: "tail", partId: "ballast-block" },
      ],
      connections: [
        ...rammer.connections,
        {
          parentIid: "core",
          parentConnector: "back",
          childIid: "tail",
          childConnector: "nose",
        },
      ],
    };
    expect(validateDesign(temperedTail).ok).toBe(true);
    const counter = await resolveMatch([gravestone.design, temperedTail]);
    expect(counter.status.over && counter.status.winner).toBe(1);
    // The seventh rung eats that same lance level, and falls to it tilted
    // up 15, tail or no tail: the top of the ladder is a tilt, not a buy.
    const levelAtTop = await resolveMatch([top.design, temperedTail]);
    expect(levelAtTop.status.over && levelAtTop.status.winner).toBe(0);
    const tiltedTail = {
      ...temperedTail,
      connections: temperedTail.connections.map((c) =>
        c.childIid === "spike" ? { ...c, pitch: 15 as const } : c,
      ),
    };
    const tiltedAtTop = await resolveMatch([top.design, tiltedTail]);
    expect(tiltedAtTop.status.over && tiltedAtTop.status.winner).toBe(1);
    const tiltedNoTail = {
      ...lanced,
      parts: lanced.parts.map((part) =>
        part.iid === "spike" ? { ...part, partId: "tempered-lance" } : part,
      ),
      connections: lanced.connections.map((c) =>
        c.childIid === "spike" ? { ...c, pitch: 15 as const } : c,
      ),
    };
    const noTailAtTop = await resolveMatch([top.design, tiltedNoTail]);
    expect(noTailAtTop.status.over && noTailAtTop.status.winner).toBe(1);
  }, 120_000);

  it("names a free counter on the rungs an angle flips, and the angle really flips them (second lever, measured)", async () => {
    const tilted = (partId: string, pitch: 15): BotDesign => ({
      ...TEST_BOT_DESIGN,
      parts: TEST_BOT_DESIGN.parts.map((p) =>
        p.iid === "spike" ? { ...p, partId } : p,
      ),
      connections: TEST_BOT_DESIGN.connections.map((c) =>
        c.childIid === "spike" ? { ...c, pitch } : c,
      ),
    });
    const gravestone = FIGHT_LADDER.find((rung) => rung.id === "gravestone");
    const nightTerror = FIGHT_LADDER.find((rung) => rung.id === "night-terror");
    expect(gravestone?.pitchCounter).toMatchObject({
      partId: "ram-spike",
      pitch: 15,
    });
    expect(nightTerror?.pitchCounter).toMatchObject({
      partId: "lance",
      pitch: 15,
    });
    expect(
      FIGHT_LADDER.find((rung) => rung.id === "headstone")?.pitchCounter,
    ).toMatchObject({ partId: "tempered-lance", pitch: 15 });
    if (!gravestone || !nightTerror) throw new Error("rungs missing");
    // Level, the starter spike loses to Gravestone; up 15, it wins.
    const level = await resolveMatch([gravestone.design, TEST_BOT_DESIGN]);
    expect(level.status.over && level.status.winner).toBe(0);
    const up = await resolveMatch([gravestone.design, tilted("ram-spike", 15)]);
    expect(up.status.over && up.status.winner).toBe(1);
    // A level lance draws with Night Terror; up 15, it wins.
    const lanceUp = await resolveMatch([
      nightTerror.design,
      tilted("lance", 15),
    ]);
    expect(lanceUp.status.over && lanceUp.status.winner).toBe(1);
  }, 60_000);

  it("names a counter per rung that the catalog sells and the measured cases above use (F-250)", () => {
    const counters = Object.fromEntries(
      FIGHT_LADDER.map((rung) => [rung.id, rung.counter.partId]),
    );
    expect(counters).toEqual({
      brawler: "ram-spike",
      contagion: "ram-spike",
      "night-terror": "ram-spike",
      bulldozer: "tower-core",
      impaler: "lance",
      gravestone: "tempered-lance",
      headstone: "tempered-lance",
    });
    for (const rung of FIGHT_LADDER) {
      expect(PART_CATALOG[rung.counter.partId]).toBeDefined();
      expect(rung.counter.text).toContain(rung.name);
      expect(rung.counter.text).toContain(
        PART_CATALOG[rung.counter.partId].name,
      );
    }
  });

  it("gives the Tower core an edge of its own: it wins the two shove rungs the cube loses (F-249, measured)", async () => {
    // The same two wheels and spike on the tall chassis. Before the
    // reshape (SIM_VERSION 7) this build never closed on anyone.
    const tower = {
      ...rammer,
      name: "Tower Rammer",
      parts: rammer.parts.map((part) =>
        part.iid === "core" ? { ...part, partId: "tower-core" } : part,
      ),
    };
    expect(validateDesign(tower).ok).toBe(true);
    const wins: string[] = [];
    for (const rung of FIGHT_LADDER) {
      const result = await resolveMatch([rung.design, tower]);
      if (result.status.over && result.status.winner === 1) wins.push(rung.id);
    }
    expect(wins).toContain("bulldozer");
    expect(wins).toContain("impaler");
    expect(wins.length).toBeGreaterThanOrEqual(3);
  }, 90_000);
});
