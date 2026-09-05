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
      "grindstone",
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
      const result = await resolveMatch([rung.design, rammer], undefined, {
        arenaId: rung.arenaId,
      });
      expect(result.status.over).toBe(true);
      outcomes.push(result.status.over && result.status.winner === 1);
    }
    expect(outcomes).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
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
    expect(top.id).toBe("grindstone");
    const lancerAtTop = await resolveMatch([top.design, lanced]);
    expect(lancerAtTop.status.over && lancerAtTop.status.winner).toBe(0);
    const headstone = FIGHT_LADDER[6];
    expect(headstone.id).toBe("headstone");
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
    // up 15, tail or no tail: that rung's answer is a tilt, not a buy.
    const levelAtTop = await resolveMatch([headstone.design, temperedTail]);
    expect(levelAtTop.status.over && levelAtTop.status.winner).toBe(0);
    const tiltedTail = {
      ...temperedTail,
      connections: temperedTail.connections.map((c) =>
        c.childIid === "spike" ? { ...c, pitch: 15 as const } : c,
      ),
    };
    const tiltedAtTop = await resolveMatch([headstone.design, tiltedTail]);
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
    const noTailAtTop = await resolveMatch([headstone.design, tiltedNoTail]);
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

  it("Contagion fights in the Pit, where the starter still beats it and the Cube Lancer that beats it in the Ring does not (measured)", async () => {
    const contagion = FIGHT_LADDER.find((rung) => rung.id === "contagion");
    if (!contagion) throw new Error("contagion missing");
    expect(contagion.arenaId).toBe("pit");
    // Every other rung fights in the Ring (absent means the default).
    for (const rung of FIGHT_LADDER) {
      if (rung.id !== "contagion") expect(rung.arenaId).toBeUndefined();
    }
    const starter = await resolveMatch([contagion.design, rammer], undefined, {
      arenaId: "pit",
    });
    expect(starter.status.over && starter.status.winner).toBe(1);
    const lanced = {
      ...rammer,
      parts: rammer.parts.map((part) =>
        part.iid === "spike" ? { ...part, partId: "lance" } : part,
      ),
    };
    const ring = await resolveMatch([contagion.design, lanced], undefined, {
      arenaId: "ring",
    });
    expect(ring.status.over && ring.status.winner).toBe(1);
    const pit = await resolveMatch([contagion.design, lanced], undefined, {
      arenaId: "pit",
    });
    expect(pit.status.over && pit.status.winner).toBe(0);
  }, 60_000);

  it("the Tower Basher blueprint wins three rungs with its hammer on a boom (F-258, measured)", async () => {
    const basher = BLUEPRINTS.find((b) => b.id === "tower-basher")?.design;
    if (!basher) throw new Error("tower basher missing");
    expect(basher.parts.map((p) => p.partId)).toContain("boom-arm");
    expect(basher.parts.map((p) => p.partId)).not.toContain("mast-pole");
    const wins: string[] = [];
    for (const rung of FIGHT_LADDER) {
      const result = await resolveMatch([rung.design, basher], undefined, {
        arenaId: rung.arenaId,
      });
      if (result.status.over && result.status.winner === 1) wins.push(rung.id);
    }
    // Up the mast the hammer won Brawler alone; out front it also takes
    // Contagion in the Pit and Impaler.
    expect(wins).toEqual(["brawler", "contagion", "impaler"]);
  }, 90_000);
  it("Grindstone stops the Ripsaw build that sweeps the rest and falls to the Heavy Bar build Headstone stops (measured)", async () => {
    const grindstone = FIGHT_LADDER[FIGHT_LADDER.length - 1];
    expect(grindstone.id).toBe("grindstone");
    const spin = (blade: string, plate?: string): BotDesign => ({
      name: "Spinner",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "wl", partId: "drive-wheel" },
        { iid: "wr", partId: "drive-wheel" },
        { iid: "spin", partId: "spin-mount" },
        { iid: "blade", partId: blade },
        ...(plate ? [{ iid: "plate", partId: plate }] : []),
      ],
      connections: [
        {
          parentIid: "core",
          parentConnector: "axle-left",
          childIid: "wl",
          childConnector: "hub",
        },
        {
          parentIid: "core",
          parentConnector: "axle-right",
          childIid: "wr",
          childConnector: "hub",
        },
        {
          parentIid: "core",
          parentConnector: "front",
          childIid: "spin",
          childConnector: "base",
        },
        {
          parentIid: "spin",
          parentConnector: "spindle",
          childIid: "blade",
          childConnector: "hub",
        },
        ...(plate
          ? [
              {
                parentIid: "core",
                parentConnector: "top",
                childIid: "plate",
                childConnector: "bottom",
              },
            ]
          : []),
      ],
    });
    // The plain Ripsaw build beats Headstone and loses to Grindstone.
    const headstone = FIGHT_LADDER[6];
    const ripAtHeadstone = await resolveMatch([
      headstone.design,
      spin("ripsaw"),
    ]);
    expect(ripAtHeadstone.status.over && ripAtHeadstone.status.winner).toBe(1);
    const ripAtTop = await resolveMatch([grindstone.design, spin("ripsaw")]);
    expect(ripAtTop.status.over && ripAtTop.status.winner).toBe(0);
    // The Heavy Bar on a Hardened Plate beats Grindstone and loses to
    // Headstone: the top of the ladder is a cycle, not a wall.
    const sweep = spin("heavy-bar", "hardened-plate");
    const sweepAtTop = await resolveMatch([grindstone.design, sweep]);
    expect(sweepAtTop.status.over && sweepAtTop.status.winner).toBe(1);
    const sweepAtHeadstone = await resolveMatch([headstone.design, sweep]);
    expect(sweepAtHeadstone.status.over && sweepAtHeadstone.status.winner).toBe(
      0,
    );
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
      grindstone: "heavy-bar",
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
      const result = await resolveMatch([rung.design, tower], undefined, {
        arenaId: rung.arenaId,
      });
      if (result.status.over && result.status.winner === 1) wins.push(rung.id);
    }
    expect(wins).toContain("bulldozer");
    expect(wins).toContain("impaler");
    expect(wins.length).toBeGreaterThanOrEqual(3);
  }, 90_000);
});
