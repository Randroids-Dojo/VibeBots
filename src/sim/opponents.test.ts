import { describe, expect, it } from "vitest";
import { BLUEPRINTS } from "./blueprints";
import { validateDesign } from "./design";
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
    expect(outcomes).toEqual([true, true, true, false, false, false]);
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
    expect(top.id).toBe("gravestone");
    const lancerAtTop = await resolveMatch([top.design, lanced]);
    expect(lancerAtTop.status.over && lancerAtTop.status.winner).toBe(0);
    // And the top rung's counter is a build a player can buy from wave
    // two: the tempered lance in the nose and a ballast block on the tail.
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
    const counter = await resolveMatch([top.design, temperedTail]);
    expect(counter.status.over && counter.status.winner).toBe(1);
  }, 90_000);
});
