import { describe, expect, it } from "vitest";
import { createArenaWorld } from "./arena";
import { assembleBot } from "./assembly";
import { type BotDesign, TEST_BOT_DESIGN, validateDesign } from "./design";
import { FIGHT_LADDER } from "./opponents";
import {
  HARDENED_PLATE,
  PART_CATALOG,
  partDefSchema,
  partMass,
  SPINNER_BAR,
} from "./parts";
import { resolveMatch } from "./resolve";

// A cube bot carrying both new parts: a hardened plate on the deck and a
// spinner bar on a spin mount, plus two drive wheels.
const M_DESIGN: BotDesign = {
  name: "M test",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wl", partId: "drive-wheel" },
    { iid: "wr", partId: "drive-wheel" },
    { iid: "plate", partId: "hardened-plate" },
    { iid: "spin", partId: "spin-mount" },
    { iid: "bar", partId: "spinner-bar" },
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
      parentConnector: "top",
      childIid: "plate",
      childConnector: "bottom",
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
      childIid: "bar",
      childConnector: "hub",
    },
  ],
};

describe("M weapon and armor parts", () => {
  it("registers the hardened plate and spinner bar, both sold", () => {
    expect(PART_CATALOG["hardened-plate"]).toBe(HARDENED_PLATE);
    expect(PART_CATALOG["spinner-bar"]).toBe(SPINNER_BAR);
    expect(HARDENED_PLATE.priceEmeralds).toBeGreaterThan(0);
    expect(SPINNER_BAR.priceEmeralds).toBeGreaterThan(0);
  });

  it("makes the plate tougher armor and the bar a heavier hitter", () => {
    // Armor: much tougher than the light frame plate.
    expect(HARDENED_PLATE.durability).toBeGreaterThan(
      PART_CATALOG["frame-plate"].durability,
    );
    expect(HARDENED_PLATE.category).toBe("structure");
    // Weapon: a real spin power draw and heavier than the saw disc, so the
    // contact-force damage model rewards it more.
    expect(SPINNER_BAR.category).toBe("weapon");
    expect(SPINNER_BAR.powerDraw).toBeGreaterThan(0);
    expect(partMass(SPINNER_BAR)).toBeGreaterThan(
      partMass(PART_CATALOG["saw-blade"]),
    );
  });

  it("builds a valid bot that carries both parts", () => {
    expect(validateDesign(M_DESIGN).ok).toBe(true);
  });

  it("assembles with the spinner bar on its own spin motor", async () => {
    const world = await createArenaWorld();
    try {
      const bot = assembleBot(world, M_DESIGN, { x: 0, y: 0.6, z: 0 });
      expect(bot.bodies.size).toBe(6);
      // Two drive axles, and the spinner bar rides its own spin motor.
      expect(bot.axleJoints.length).toBe(2);
      expect(bot.spinJoints.length).toBe(1);
    } finally {
      world.free();
    }
  });
});

describe("tier ladder wave one (G4)", () => {
  const TIER_IDS = [
    "grip-wheel",
    "super-wheel",
    "light-plate",
    "corner-block",
    "wedge-block",
    "skid",
    "lance",
    "cleaver",
  ];

  it("registers every wave-one part, all sold", () => {
    for (const id of TIER_IDS) {
      expect(PART_CATALOG[id], id).toBeDefined();
      expect(PART_CATALOG[id].priceEmeralds, id).toBeGreaterThan(0);
    }
    expect(Object.keys(PART_CATALOG)).toHaveLength(33);
  });

  it("climbs the wheel ladder in mass, power, and price", () => {
    const [standard, grip, sup] = [
      "drive-wheel",
      "grip-wheel",
      "super-wheel",
    ].map((id) => PART_CATALOG[id]);
    expect(partMass(grip)).toBeGreaterThan(partMass(standard));
    expect(partMass(sup)).toBeGreaterThan(partMass(grip));
    expect(grip.powerDraw).toBeGreaterThan(standard.powerDraw);
    expect(sup.powerDraw).toBeGreaterThan(grip.powerDraw);
    expect(grip.priceEmeralds).toBeGreaterThan(standard.priceEmeralds);
    expect(sup.priceEmeralds).toBeGreaterThan(grip.priceEmeralds);
    // A tier-two part costs about two tier-one copies (question 2 default).
    expect(grip.priceEmeralds).toBe(2 * standard.priceEmeralds);
  });

  it("keeps a wide wheel outboard of every core's flank", () => {
    for (const wheelId of ["grip-wheel", "super-wheel"]) {
      const wheel = PART_CATALOG[wheelId];
      if (wheel.shape.type !== "cylinder") throw new Error("expected cylinder");
      for (const coreId of ["core-cube", "wedge-core", "tower-core"]) {
        const core = PART_CATALOG[coreId];
        const stub = core.connectors.find((c) => c.id === "axle-right");
        if (!stub || core.shape.type !== "cuboid")
          throw new Error("core shape");
        expect(
          stub.position.x - wheel.shape.halfHeight,
          `${wheelId} on ${coreId}`,
        ).toBeGreaterThan(core.shape.hx);
      }
    }
  });

  it("puts the light plate below the frame plate and the lance past the spike", () => {
    expect(partMass(PART_CATALOG["light-plate"])).toBeLessThan(
      partMass(PART_CATALOG["frame-plate"]),
    );
    expect(PART_CATALOG["light-plate"].durability).toBeLessThan(
      PART_CATALOG["frame-plate"].durability,
    );
    const spike = PART_CATALOG["ram-spike"];
    const lance = PART_CATALOG.lance;
    if (spike.shape.type !== "cuboid" || lance.shape.type !== "cuboid") {
      throw new Error("expected cuboids");
    }
    expect(lance.shape.hz).toBeGreaterThan(spike.shape.hz);
    expect(lance.durability).toBeLessThan(spike.durability);
  });
});

describe("catalog wave four", () => {
  it("registers two rungs at twice the part below, heavier and harder", () => {
    for (const [above, below] of [
      ["ripsaw", "saw-blade"],
      ["great-cleaver", "cleaver"],
    ] as const) {
      expect(PART_CATALOG[above], above).toBeDefined();
      expect(PART_CATALOG[above].priceEmeralds).toBe(
        2 * PART_CATALOG[below].priceEmeralds,
      );
      expect(PART_CATALOG[above].connectors).toEqual(
        PART_CATALOG[below].connectors,
      );
      expect(partMass(PART_CATALOG[above])).toBeGreaterThan(
        partMass(PART_CATALOG[below]),
      );
      expect(PART_CATALOG[above].durability).toBeGreaterThan(
        PART_CATALOG[below].durability,
      );
    }
    // The saw keeps its disc; the cleaver keeps its cross-section and
    // density and gains edge length. No hammer rung shipped (F-258).
    expect(PART_CATALOG.ripsaw.shape).toEqual(PART_CATALOG["saw-blade"].shape);
    const cleaver = PART_CATALOG.cleaver;
    const great = PART_CATALOG["great-cleaver"];
    if (cleaver.shape.type !== "cuboid" || great.shape.type !== "cuboid") {
      throw new Error("cleavers are cuboids");
    }
    expect(great.shape.hx).toBe(cleaver.shape.hx);
    expect(great.shape.hy).toBe(cleaver.shape.hy);
    expect(great.shape.hz).toBeGreaterThan(cleaver.shape.hz);
    expect(great.density).toBe(cleaver.density);
    expect(PART_CATALOG.sledge).toBeUndefined();
  });

  it("the Ripsaw beats Headstone where the Saw Blade loses, and the Great Cleaver beats Headstone and Contagion where the Cleaver loses (measured)", async () => {
    const spin = (bladeId: string): BotDesign => ({
      name: "Spinner",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "wl", partId: "drive-wheel" },
        { iid: "wr", partId: "drive-wheel" },
        { iid: "spin", partId: "spin-mount" },
        { iid: "blade", partId: bladeId },
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
      ],
    });
    const edged = (cleaverId: string): BotDesign => ({
      ...TEST_BOT_DESIGN,
      parts: [...TEST_BOT_DESIGN.parts, { iid: "edge", partId: cleaverId }],
      connections: [
        ...TEST_BOT_DESIGN.connections,
        {
          parentIid: "core",
          parentConnector: "top",
          childIid: "edge",
          childConnector: "mount",
        },
      ],
    });
    const fightIn = async (player: BotDesign, rungId: string) => {
      const r = FIGHT_LADDER.find((rung) => rung.id === rungId);
      if (!r) throw new Error(`rung ${rungId} missing`);
      const result = await resolveMatch([r.design, player], undefined, {
        arenaId: r.arenaId,
      });
      if (!result.status.over) throw new Error("fight did not end");
      return result.status.winner;
    };
    expect(await fightIn(spin("saw-blade"), "headstone")).toBe(0);
    expect(await fightIn(spin("ripsaw"), "headstone")).toBe(1);
    expect(await fightIn(edged("cleaver"), "headstone")).toBe(0);
    expect(await fightIn(edged("great-cleaver"), "headstone")).toBe(1);
    expect(await fightIn(edged("cleaver"), "contagion")).toBe(0);
    expect(await fightIn(edged("great-cleaver"), "contagion")).toBe(1);
  }, 60_000);
});

describe("catalog wave three", () => {
  const WAVE_THREE = ["armour-plate", "tempered-spike", "heavy-bar"] as const;

  it("registers the three rungs, all sold, at about twice the part below", () => {
    for (const id of WAVE_THREE) {
      expect(PART_CATALOG[id], id).toBeDefined();
      expect(PART_CATALOG[id].priceEmeralds, id).toBeGreaterThan(0);
    }
    expect(PART_CATALOG["armour-plate"].priceEmeralds).toBe(
      2 * PART_CATALOG["frame-plate"].priceEmeralds,
    );
    expect(PART_CATALOG["tempered-spike"].priceEmeralds).toBe(
      2 * PART_CATALOG["ram-spike"].priceEmeralds,
    );
    expect(PART_CATALOG["heavy-bar"].priceEmeralds).toBe(
      2 * PART_CATALOG["spinner-bar"].priceEmeralds,
    );
  });

  it("keeps the plate's and the bar's shape and climbs in mass and durability", () => {
    for (const [above, below] of [
      ["armour-plate", "frame-plate"],
      ["heavy-bar", "spinner-bar"],
    ] as const) {
      expect(PART_CATALOG[above].shape).toEqual(PART_CATALOG[below].shape);
      expect(PART_CATALOG[above].connectors).toEqual(
        PART_CATALOG[below].connectors,
      );
      expect(partMass(PART_CATALOG[above])).toBeGreaterThan(
        partMass(PART_CATALOG[below]),
      );
      expect(PART_CATALOG[above].durability).toBeGreaterThan(
        PART_CATALOG[below].durability,
      );
    }
    // A heavier bar on the same motor draws more.
    expect(PART_CATALOG["heavy-bar"].powerDraw).toBeGreaterThan(
      PART_CATALOG["spinner-bar"].powerDraw,
    );
  });

  it("draws the spike out at the same cross-section and density, mounted at its tip", () => {
    const spike = PART_CATALOG["ram-spike"];
    const tempered = PART_CATALOG["tempered-spike"];
    if (spike.shape.type !== "cuboid" || tempered.shape.type !== "cuboid") {
      throw new Error("spikes are cuboids");
    }
    expect(tempered.shape.hx).toBe(spike.shape.hx);
    expect(tempered.shape.hy).toBe(spike.shape.hy);
    expect(tempered.shape.hz).toBeGreaterThan(spike.shape.hz);
    expect(tempered.density).toBe(spike.density);
    expect(tempered.durability).toBeGreaterThan(spike.durability);
    expect(tempered.connectors).toEqual([
      {
        id: "mount",
        kind: "rigid",
        position: { x: 0, y: 0, z: tempered.shape.hz },
      },
    ]);
  });

  it("builds valid bots with each rung in the part below's place", () => {
    const withSpike = (partId: string): BotDesign => ({
      ...TEST_BOT_DESIGN,
      parts: TEST_BOT_DESIGN.parts.map((p) =>
        p.iid === "spike" ? { ...p, partId } : p,
      ),
    });
    expect(validateDesign(withSpike("tempered-spike")).ok).toBe(true);
    const plated: BotDesign = {
      ...TEST_BOT_DESIGN,
      parts: [
        ...TEST_BOT_DESIGN.parts,
        { iid: "plate", partId: "armour-plate" },
      ],
      connections: [
        ...TEST_BOT_DESIGN.connections,
        {
          parentIid: "core",
          parentConnector: "top",
          childIid: "plate",
          childConnector: "bottom",
        },
      ],
    };
    expect(validateDesign(plated).ok).toBe(true);
  });
});

describe("catalog wave three, measured on the ladder", () => {
  const rung = (id: string): BotDesign => {
    const found = FIGHT_LADDER.find((r) => r.id === id);
    if (!found) throw new Error(`rung ${id} missing`);
    return found.design;
  };
  const withSpike = (partId: string): BotDesign => ({
    ...TEST_BOT_DESIGN,
    parts: TEST_BOT_DESIGN.parts.map((p) =>
      p.iid === "spike" ? { ...p, partId } : p,
    ),
  });
  const plated = (base: BotDesign, plateId: string): BotDesign => ({
    ...base,
    parts: [...base.parts, { iid: "plate", partId: plateId }],
    connections: [
      ...base.connections,
      {
        parentIid: "core",
        parentConnector: "top",
        childIid: "plate",
        childConnector: "bottom",
      },
    ],
  });
  const spinner = (barId: string): BotDesign => ({
    name: "Spinner",
    parts: [
      { iid: "core", partId: "core-cube" },
      { iid: "wl", partId: "drive-wheel" },
      { iid: "wr", partId: "drive-wheel" },
      { iid: "spin", partId: "spin-mount" },
      { iid: "bar", partId: barId },
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
        childIid: "bar",
        childConnector: "hub",
      },
    ],
  });
  // Opponent at seat 0, the player's build at seat 1, as the arena runs it.
  const fight = async (player: BotDesign, rungId: string) => {
    // Each rung fights in its own arena (Contagion in the Pit).
    const result = await resolveMatch([rung(rungId), player], undefined, {
      arenaId: FIGHT_LADDER.find((r) => r.id === rungId)?.arenaId,
    });
    if (!result.status.over) throw new Error("fight did not end");
    return result.status;
  };

  it("the Heavy Bar beats Impaler where the Spinner Bar loses, and with a Hardened Plate sweeps the first six rungs", async () => {
    expect((await fight(spinner("spinner-bar"), "impaler")).winner).toBe(0);
    expect((await fight(spinner("heavy-bar"), "impaler")).winner).toBe(1);
    const sweep = plated(spinner("heavy-bar"), "hardened-plate");
    for (const r of FIGHT_LADDER) {
      // The seventh rung was built to stop this build (measured there).
      const expected = r.id === "headstone" ? 0 : 1;
      expect((await fight(sweep, r.id)).winner, r.id).toBe(expected);
    }
  }, 60_000);

  it("the Tempered Spike disables Brawler level, where the Ram Spike only outlasts it", async () => {
    const spike = await fight(withSpike("ram-spike"), "brawler");
    expect(spike.winner).toBe(1);
    expect(spike.reason).toBe("timeout");
    const tempered = await fight(withSpike("tempered-spike"), "brawler");
    expect(tempered.winner).toBe(1);
    expect(tempered.reason).toBe("disable");
  }, 60_000);

  it("the Armour Plate on the starter build beats Night Terror where the Frame Plate draws", async () => {
    expect(
      (
        await fight(
          plated(withSpike("ram-spike"), "frame-plate"),
          "night-terror",
        )
      ).winner,
    ).toBeNull();
    expect(
      (
        await fight(
          plated(withSpike("ram-spike"), "armour-plate"),
          "night-terror",
        )
      ).winner,
    ).toBe(1);
  }, 60_000);
});

describe("catalog blurbs", () => {
  it("gives every part a short, dash-free line about what it is for", () => {
    for (const part of Object.values(PART_CATALOG)) {
      expect(part.blurb.trim().length, part.id).toBeGreaterThan(0);
      expect(part.blurb.length, part.id).toBeLessThan(71);
      // Player-facing copy: no em-dashes, en-dashes, or hyphens.
      expect(part.blurb, part.id).not.toMatch(/[\u2013\u2014-]/);
      expect(partDefSchema.safeParse(part).success, part.id).toBe(true);
    }
  });

  it("requires the blurb in the schema", () => {
    const { blurb: _blurb, ...missing } = PART_CATALOG["core-cube"];
    expect(partDefSchema.safeParse(missing).success).toBe(false);
    expect(
      partDefSchema.safeParse({ ...PART_CATALOG["core-cube"], blurb: "" })
        .success,
    ).toBe(false);
  });
});
