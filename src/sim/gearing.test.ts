import { describe, expect, it } from "vitest";
import { useWorkshopStore } from "@/state/workshop-store";
import { createArenaWorld } from "./arena";
import { assembleBot, setDriveVelocity } from "./assembly";
import { combatStateString, createMatch, freeMatch, stepMatch } from "./combat";
import {
  type BotDesign,
  botDesignSchema,
  CPU_BRAWLER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  DEFAULT_GEAR_RATIO,
  gearPowerDraw,
  isGearableConnection,
  MAX_GEAR_RATIO,
  TEST_BOT_DESIGN,
  validateDesign,
} from "./design";
import { matchResultHash } from "./resolve";

/** The starter rammer with a given ratio on both drive axles. */
function geared(ratio: number | undefined): BotDesign {
  return {
    ...TEST_BOT_DESIGN,
    name: `Rammer ${ratio ?? "stock"}`,
    connections: TEST_BOT_DESIGN.connections.map((conn) =>
      conn.parentConnector.startsWith("axle") && ratio !== undefined
        ? { ...conn, gearRatio: ratio }
        : conn,
    ),
  };
}

/** Straight-line distance travelled from a standing start. */
async function driveDistance(
  design: BotDesign,
  ticks: number,
): Promise<number> {
  const world = await createArenaWorld();
  const bot = assembleBot(world, design, { x: 0, y: 0.42, z: 0 });
  const core = bot.bodies.get(bot.rootIid);
  if (!core) throw new Error("assembled bot lost its core");
  const start = core.translation().z;
  for (let i = 0; i < ticks; i++) {
    setDriveVelocity(bot, -12);
    world.step();
  }
  const travelled = Math.abs(core.translation().z - start);
  world.free();
  return travelled;
}

describe("gear ratio validation", () => {
  it("accepts a ratio on a drive axle", () => {
    expect(validateDesign(geared(1.8)).ok).toBe(true);
  });

  it("rejects a ratio on a rigid mount", () => {
    const design: BotDesign = {
      ...TEST_BOT_DESIGN,
      connections: TEST_BOT_DESIGN.connections.map((conn) =>
        conn.childIid === "spike" ? { ...conn, gearRatio: 2 } : conn,
      ),
    };
    const result = validateDesign(design);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "gear-ratio")).toBe(
      true,
    );
  });

  it("rejects a ratio on a spinner axle", () => {
    // A spinner runs at a fixed motor velocity by contract, so a ratio
    // there would silently do nothing.
    const design: BotDesign = {
      name: "Geared saw",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "wheel-l", partId: "drive-wheel" },
        { iid: "wheel-r", partId: "drive-wheel" },
        { iid: "mount", partId: "spin-mount" },
        { iid: "blade", partId: "saw-blade" },
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
          parentConnector: "front",
          childIid: "mount",
          childConnector: "base",
        },
        {
          parentIid: "mount",
          parentConnector: "spindle",
          childIid: "blade",
          childConnector: "hub",
          gearRatio: 2,
        },
      ],
    };
    const result = validateDesign(design);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "gear-ratio")).toBe(
      true,
    );
  });

  it("rejects a ratio outside the buildable range", () => {
    const withRatio = (gearRatio: number) => ({
      ...TEST_BOT_DESIGN,
      connections: [
        { ...TEST_BOT_DESIGN.connections[0], gearRatio },
        ...TEST_BOT_DESIGN.connections.slice(1),
      ],
    });
    // The range lives on the zod schema, so parse rather than validate.
    expect(botDesignSchema.safeParse(withRatio(99)).success).toBe(false);
    expect(botDesignSchema.safeParse(withRatio(0.1)).success).toBe(false);
    expect(botDesignSchema.safeParse(withRatio(MAX_GEAR_RATIO)).success).toBe(
      true,
    );
  });
});

describe("gear ratio determinism", () => {
  it("ratio 1 reproduces the ungeared fight exactly", async () => {
    // This is the contract that lets gearing ship without bumping
    // SIM_VERSION or invalidating a single stored replay.
    const run = async (design: BotDesign) => {
      const world = await createArenaWorld();
      const match = createMatch(world, [design, CPU_BRAWLER_DESIGN]);
      for (let i = 0; i < 600 && !match.status.over; i++) stepMatch(match);
      const result = {
        hash: matchResultHash(match),
        state: combatStateString(match),
      };
      freeMatch(match);
      world.free();
      return result;
    };

    const stock = await run(geared(undefined));
    const explicitOne = await run({
      ...geared(DEFAULT_GEAR_RATIO),
      name: TEST_BOT_DESIGN.name,
    });
    expect(explicitOne.hash).toBe(stock.hash);
    expect(explicitOne.state).toBe(stock.state);
  }, 60000);
});

describe("isGearableConnection", () => {
  it("refuses a spinner hub mounted straight onto a drive axle", () => {
    // A saw blade hub is an axle with motor "spin", and nothing stops it
    // being bolted to the core's drive axle. The workshop used to test only
    // the PARENT connector, so it would happily write a ratio onto this and
    // then validation would reject the design the player just built.
    const design: BotDesign = {
      name: "Blade on the drive axle",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "wheel-r", partId: "drive-wheel" },
        { iid: "blade", partId: "saw-blade" },
      ],
      connections: [
        {
          parentIid: "core",
          parentConnector: "axle-right",
          childIid: "wheel-r",
          childConnector: "hub",
        },
        {
          parentIid: "core",
          parentConnector: "axle-left",
          childIid: "blade",
          childConnector: "hub",
        },
      ],
    };
    const toWheel = design.connections[0];
    const toBlade = design.connections[1];
    expect(isGearableConnection(design, toWheel)).toBe(true);
    expect(isGearableConnection(design, toBlade)).toBe(false);

    // And the store's setter agrees with validation: gearing this design
    // leaves the blade alone, so the result stays legal.
    useWorkshopStore.getState().loadDesign(design);
    useWorkshopStore.getState().setGearRatio(2);
    const geared = useWorkshopStore.getState().design;
    expect(
      geared.connections.find((c) => c.childIid === "wheel-r")?.gearRatio,
    ).toBe(2);
    expect(
      geared.connections.find((c) => c.childIid === "blade")?.gearRatio,
    ).toBeUndefined();
    // The setter must not manufacture a gear-ratio violation. (This
    // layout is illegal for an unrelated geometry reason, a blade that
    // large overlaps the core, so assert on the gearing rule specifically.)
    const check = validateDesign(geared);
    const gearIssues = check.ok
      ? []
      : check.issues.filter((issue) => issue.code === "gear-ratio");
    expect(gearIssues).toEqual([]);
  });
});

describe("gearing costs power", () => {
  it("is free at or below ratio 1 and rises with reduction", () => {
    expect(gearPowerDraw(undefined)).toBe(0);
    expect(gearPowerDraw(1)).toBe(0);
    expect(gearPowerDraw(0.6)).toBe(0);
    expect(gearPowerDraw(2)).toBeGreaterThan(gearPowerDraw(1.5));
  });

  it("makes torque compete with the weapon for the core budget", () => {
    // The saw bot already spends most of the cube core's supply on its
    // blade, so it cannot also run maximum reduction. That competition is
    // the point: without it, benching showed gearing up as a near strict
    // upgrade (17% to 67% win rate across the stock roster).
    const maxGeared: BotDesign = {
      ...CPU_WHIRLIGIG_DESIGN,
      connections: CPU_WHIRLIGIG_DESIGN.connections.map((conn) =>
        conn.parentConnector.startsWith("axle")
          ? { ...conn, gearRatio: MAX_GEAR_RATIO }
          : conn,
      ),
    };
    const result = validateDesign(maxGeared);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.code === "power")).toBe(true);

    // A modest reduction still fits, so the choice is a budget, not a ban.
    const mildlyGeared: BotDesign = {
      ...CPU_WHIRLIGIG_DESIGN,
      connections: CPU_WHIRLIGIG_DESIGN.connections.map((conn) =>
        conn.parentConnector.startsWith("axle")
          ? { ...conn, gearRatio: 1.2 }
          : conn,
      ),
    };
    expect(validateDesign(mildlyGeared).ok).toBe(true);
  });

  it("leaves an ungeared design's power draw untouched", () => {
    const before = validateDesign(TEST_BOT_DESIGN);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const after = validateDesign(geared(1));
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.stats.powerDraw).toBe(before.stats.powerDraw);
  });
});

/**
 * A stand-in for the motorised axle: setDriveVelocity is the real path the
 * sim drives, so the gearing math is asserted through it rather than
 * through an extracted helper that only existed for the tests.
 */
function recordingDrive(ratios: number[]) {
  const commands: Array<{ velocity: number; factor: number }> = [];
  const bot = {
    axleJoints: ratios.map((ratio, index) => ({
      ratio,
      side: index === 0 ? -1 : 1,
      joint: {
        configureMotorVelocity(velocity: number, factor: number) {
          commands.push({ velocity, factor });
        },
      },
    })),
  } as unknown as Parameters<typeof setDriveVelocity>[0];
  return { bot, commands };
}

describe("drive gearing math", () => {
  it("is the identity at ratio 1", () => {
    const { bot, commands } = recordingDrive([DEFAULT_GEAR_RATIO]);
    setDriveVelocity(bot, -12, 0, 50);
    expect(commands[0].velocity).toBe(-12);
    expect(commands[0].factor).toBe(50);
  });

  it("trades commanded speed for motor torque", () => {
    const read = (ratio: number) => {
      const { bot, commands } = recordingDrive([ratio]);
      setDriveVelocity(bot, -12, 0, 50);
      return commands[0];
    };
    const stock = read(1);
    const torquey = read(2);
    const fast = read(0.5);

    // Geared for torque: half the shaft speed, twice the motor authority.
    expect(Math.abs(torquey.velocity)).toBeLessThan(Math.abs(stock.velocity));
    expect(torquey.factor).toBeGreaterThan(stock.factor);
    // Geared for speed: the mirror image.
    expect(Math.abs(fast.velocity)).toBeGreaterThan(Math.abs(stock.velocity));
    expect(fast.factor).toBeLessThan(stock.factor);
  });

  it("keeps the differential steer split under gearing", () => {
    // Steering must still turn the bot, and gearing scales both sides
    // equally, so the ratio between them is unchanged.
    const split = (ratio: number) => {
      const { bot, commands } = recordingDrive([ratio, ratio]);
      setDriveVelocity(bot, -12, 0.4, 50);
      return commands[0].velocity / commands[1].velocity;
    };
    expect(split(2)).toBeCloseTo(split(1), 9);
    const { bot, commands } = recordingDrive([2, 2]);
    setDriveVelocity(bot, -12, 0.4, 50);
    expect(commands[0].velocity).not.toBe(commands[1].velocity);
  });
});

describe("gear ratio in the sim", () => {
  it("changes how far a bot drives, in a measurable way", async () => {
    // Deliberately NOT asserting a direction here. The stock drivetrain is
    // torque limited (see the slice notes): the commanded top speed rarely
    // binds, so a taller gear currently helps more than it costs. What must
    // hold is that the ratio is actually wired into the sim at all.
    const stock = await driveDistance(geared(undefined), 300);
    const torquey = await driveDistance(geared(2), 300);
    expect(Math.abs(torquey - stock)).toBeGreaterThan(0.5);
  }, 60000);

  it("keeps every buildable ratio driving rather than stalling", async () => {
    for (const ratio of [0.5, 1, 1.5, 2.5]) {
      const distance = await driveDistance(geared(ratio), 300);
      expect(distance, `ratio ${ratio}`).toBeGreaterThan(0.25);
    }
  }, 60000);
});
