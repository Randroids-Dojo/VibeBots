import { z } from "zod";
import { computeLayout, isQuarterTurned } from "./layout";
import {
  type Connector,
  PART_CATALOG,
  type PartDef,
  partMass,
  shapeHalfExtents,
} from "./parts";
import { weightClassProblem } from "./weight-classes";

/**
 * A bot design is a connector graph: part instances plus connections that
 * must form a tree rooted at the single core part. validateDesign is the
 * pure validity check the GDD requires before any combat (REQ-002); the
 * workshop UI and the server both call it.
 */

// Merge levels (Lv 1 to 3 by consuming duplicate copies) were retired on
// 2026-09-04 (F-230): tiers are the progression, as separate parts. A part
// instance is just its id and its part; a stored design that still carries
// a mergeLevel parses without it, because the schema strips unknown keys.
export const partInstanceSchema = z.object({
  /** Instance id, unique within the design. */
  iid: z.string().min(1),
  partId: z.string().min(1),
});
export type PartInstance = z.infer<typeof partInstanceSchema>;

export const orientationSchema = z
  .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
  .optional();
export type Orientation = 0 | 90 | 180 | 270;

/**
 * Drive gearing (F-229). Above 1 trades top speed for torque, below 1 the
 * reverse. 1 is the identity: a connection without a ratio and one with
 * exactly 1 produce a byte-identical fight, which is what lets this ship
 * without invalidating any stored replay.
 */
export const DEFAULT_GEAR_RATIO = 1;

/**
 * Extra power drawn per drive axle per unit of reduction above 1.
 *
 * Without this, gearing up is a near strict upgrade: benching the starter
 * bot across the stock roster moved it from a 17% win rate at ratio 1 to
 * 67% at maximum reduction, because the drivetrain is torque limited and
 * the commanded top speed rarely binds. Torque has to cost something, and
 * the core's power budget is the cost that already exists. Gearing DOWN for
 * speed is free: a taller-geared shaft asks less of the motor.
 *
 * Calibrated so a weapon-carrying bot cannot also run maximum reduction:
 * the saw bot has 30 power spare, and two axles at the top preset cost more
 * than that. Was 12 against an earlier 2.5 ceiling; when F-238 made the
 * presets the rule and capped them at 2.2, 12 stopped pricing the saw bot
 * out and the whole point of the cost quietly lapsed. Re-derive this
 * alongside the presets, not independently of them.
 */
export const GEAR_POWER_PER_RATIO = 13;

/**
 * The reductions a bot can be built with (F-238). These are balance
 * figures, not presentation: the power cost was tuned against benched win
 * rates at these ratios, so they belong beside the rule rather than in a
 * panel.
 *
 * This fixed set IS the rule, enforced by the schema below rather than a
 * range. A continuous range meant the server accepted reductions no player
 * could build in the workshop, so a hand-authored design could fight with
 * more torque than any legitimate bot. Weight classes are enforced the same
 * way, for the same reason: the client is not trusted to keep to its own
 * options.
 */
export const GEAR_RATIO_PRESETS: readonly number[] = [
  0.7,
  DEFAULT_GEAR_RATIO,
  1.6,
  2.2,
];

/** Whether a value is one of the buildable reductions. */
export function isGearRatioPreset(ratio: number): boolean {
  return GEAR_RATIO_PRESETS.includes(ratio);
}

/** Extra power a connection's gearing costs. Zero at or below ratio 1. */
export function gearPowerDraw(gearRatio: number | undefined): number {
  const ratio = gearRatio ?? DEFAULT_GEAR_RATIO;
  if (ratio <= DEFAULT_GEAR_RATIO) return 0;
  // Rounded to a tenth: catalog draws are whole numbers, and an unrounded
  // product leaks float noise (14.400000000000002) into both the power
  // budget and the number shown on the button.
  return (
    Math.round((ratio - DEFAULT_GEAR_RATIO) * GEAR_POWER_PER_RATIO * 10) / 10
  );
}

export const connectionSchema = z.object({
  parentIid: z.string().min(1),
  parentConnector: z.string().min(1),
  childIid: z.string().min(1),
  childConnector: z.string().min(1),
  /** Yaw quarter-turns of the child around the attachment (F-006). */
  orientation: orientationSchema,
  /**
   * Drive gear ratio on an axle connection (F-229). Must be one of the
   * buildable reductions, so client and server agree on what exists
   * (F-238); which connections may carry one is validateDesign's rule.
   */
  gearRatio: z
    .number()
    .refine(isGearRatioPreset, {
      message: `gear ratio must be one of ${GEAR_RATIO_PRESETS.join(", ")}`,
    })
    .optional(),
});
export type Connection = z.infer<typeof connectionSchema>;

/** Hard cap on parts per design: sim cost is the server's to control. */
export const MAX_DESIGN_PARTS = 32;

/**
 * Behavior tuning baked into the design (B3, REQ-001): the controller
 * is still fully autonomous; these bias its decisions. All values are
 * normalized 0..1 around a 0.5 neutral that reproduces the classic
 * controller exactly, so designs without behavior are byte-identical.
 */
export const botBehaviorSchema = z.object({
  /** Throttle bias: 0 cautious, 1 relentless. */
  aggression: z.number().min(0).max(1),
  /** Flank arc width when out-weaponed: 0 hugs, 1 swings wide. */
  flankBias: z.number().min(0).max(1),
  /** Backoff cycle length after closing in: 0 brief, 1 long resets. */
  patience: z.number().min(0).max(1),
});
export type BotBehavior = z.infer<typeof botBehaviorSchema>;

export const NEUTRAL_BEHAVIOR: BotBehavior = {
  aggression: 0.5,
  flankBias: 0.5,
  patience: 0.5,
};

/**
 * Bench rules (F-234, F-247): up to three "when X, do Y" lines the
 * controller checks in order every tick before its usual steering. The
 * first rule whose condition holds decides that tick's move. A design
 * without rules, or with an empty list, takes exactly the path it took
 * before rules existed, so stored results stay valid and the sim version
 * does not move. Conditions read sim state only, in a fixed order.
 */
export const RULE_CONDITIONS = [
  "weapon-down",
  "enemy-weapon-down",
  "enemy-immobile",
  "core-hurt",
  "clock-late",
] as const;
export const RULE_ACTIONS = ["disengage", "charge", "hold"] as const;
export type RuleCondition = (typeof RULE_CONDITIONS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];
export const botRuleSchema = z.object({
  when: z.enum(RULE_CONDITIONS),
  act: z.enum(RULE_ACTIONS),
});
export type BotRule = z.infer<typeof botRuleSchema>;
export const MAX_DESIGN_RULES = 3;
/** Core health below this fraction counts as hurt (the core-hurt rule). */
export const CORE_HURT_RATIO = 0.4;

/**
 * Cosmetic paint (G5): two palette ids, the body paint and the trim. The
 * sim never reads it, so a painted bot and an unpainted one fight byte for
 * byte the same; the renderer resolves the ids (src/lib/bot-paint.ts) and
 * an unknown id leaves a part in its own look.
 */
/** The fixed paint palette ids; the swatch table in src/lib/bot-paint.ts
 *  carries their names and colours. The schema accepts nothing else, so a
 *  stored or shared design can never carry a paint the renderer would
 *  silently drop. */
export const BOT_PAINT_IDS = [
  "ember",
  "crimson",
  "cobalt",
  "jade",
  "violet",
  "gold",
  "slate",
  "bone",
] as const;
export type BotPaintId = (typeof BOT_PAINT_IDS)[number];

export const botPaintSchema = z.object({
  primary: z.enum(BOT_PAINT_IDS),
  accent: z.enum(BOT_PAINT_IDS),
});
export type BotPaint = z.infer<typeof botPaintSchema>;

export const botDesignSchema = z.object({
  name: z.string().min(1).max(60),
  parts: z
    .array(partInstanceSchema)
    .min(1)
    .max(MAX_DESIGN_PARTS * 2),
  connections: z.array(connectionSchema).max(MAX_DESIGN_PARTS * 2),
  behavior: botBehaviorSchema.optional(),
  /** Bench rules, first match wins; absent or empty means none (F-247). */
  rules: z.array(botRuleSchema).max(MAX_DESIGN_RULES).optional(),
  /**
   * Declared weight class id (F-228). Optional: an undeclared design is
   * unclassed and unconstrained, so every design that validated before
   * still validates. Enforced here rather than only in the workshop so the
   * server rejects an over-weight bot at match resolve too.
   */
  weightClass: z.string().min(1).optional(),
  /** Cosmetic only (G5); see botPaintSchema. */
  paint: botPaintSchema.optional(),
});
export type BotDesign = z.infer<typeof botDesignSchema>;

export interface DesignStats {
  partCount: number;
  totalMass: number;
  powerDraw: number;
  powerSupply: number;
}

/**
 * Machine-readable reason a design is illegal. The tech inspection groups
 * issues by code, so it reports "Connections: failed" with the offending
 * messages under it instead of one flat wall of strings, and it never has
 * to reimplement (and drift from) the checks above.
 */
export type DesignIssueCode =
  | "duplicate-iid"
  | "unknown-part"
  | "too-many-parts"
  | "core-count"
  | "core-is-child"
  | "unknown-instance"
  | "missing-connector"
  | "kind-mismatch"
  | "oriented-axle"
  | "connector-reused"
  | "multiple-parents"
  | "disconnected"
  | "overlap"
  | "power"
  | "weight-class"
  | "gear-ratio";

export interface DesignIssue {
  code: DesignIssueCode;
  message: string;
}

export type ValidationResult =
  | { ok: true; stats: DesignStats }
  | { ok: false; errors: string[]; issues: DesignIssue[] };

function resolvePart(
  instance: PartInstance,
  catalog: Record<string, PartDef>,
): PartDef | undefined {
  return catalog[instance.partId];
}

/**
 * Resolves both ends of a connection to their connector definitions.
 * Returns null when either end does not exist (the connection is already
 * invalid for a different reason).
 */
export function connectionEnds(
  design: BotDesign,
  conn: Connection,
  catalog: Record<string, PartDef> = PART_CATALOG,
): { parent: Connector; child: Connector } | null {
  const parentPartId = design.parts.find(
    (part) => part.iid === conn.parentIid,
  )?.partId;
  const childPartId = design.parts.find(
    (part) => part.iid === conn.childIid,
  )?.partId;
  const parent = catalog[parentPartId ?? ""]?.connectors.find(
    (entry) => entry.id === conn.parentConnector,
  );
  const child = catalog[childPartId ?? ""]?.connectors.find(
    (entry) => entry.id === conn.childConnector,
  );
  return parent && child ? { parent, child } : null;
}

/**
 * Whether a connection can carry a gear ratio (F-229). Gearing is a
 * drive-motor property: a rigid mount has no motor, and a spinner runs at a
 * fixed velocity by contract, so a ratio on either would silently do
 * nothing. BOTH ends must be checked, because a spinner-hubbed part can be
 * mounted straight onto a drive axle.
 *
 * Exported so the workshop asks this question instead of answering it: the
 * store's setter and the gearing panel's readout both call this, which is
 * what stops the UI writing a ratio the validator then rejects.
 */
export function isGearableConnector(parent: Connector, child: Connector) {
  return (
    parent.kind === "axle" && parent.motor !== "spin" && child.motor !== "spin"
  );
}

export function isGearableConnection(
  design: BotDesign,
  conn: Connection,
  catalog: Record<string, PartDef> = PART_CATALOG,
): boolean {
  const ends = connectionEnds(design, conn, catalog);
  return ends !== null && isGearableConnector(ends.parent, ends.child);
}

export function partInstanceDurability(
  instance: PartInstance,
  catalog: Record<string, PartDef> = PART_CATALOG,
): number {
  const part = resolvePart(instance, catalog);
  if (!part) return 0;
  return part.durability;
}

export function validateDesign(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
): ValidationResult {
  const issues: DesignIssue[] = [];
  const errors: string[] = [];
  const fail = (code: DesignIssueCode, message: string) => {
    issues.push({ code, message });
    errors.push(message);
  };

  const byIid = new Map<string, PartInstance>();
  for (const part of design.parts) {
    if (byIid.has(part.iid))
      fail("duplicate-iid", `duplicate instance id "${part.iid}"`);
    byIid.set(part.iid, part);
    if (!resolvePart(part, catalog))
      fail("unknown-part", `unknown part "${part.partId}" (${part.iid})`);
  }

  if (design.parts.length > MAX_DESIGN_PARTS) {
    fail(
      "too-many-parts",
      `too many parts: ${design.parts.length} (limit ${MAX_DESIGN_PARTS})`,
    );
  }

  const cores = design.parts.filter(
    (p) => resolvePart(p, catalog)?.category === "core",
  );
  if (cores.length !== 1)
    fail(
      "core-count",
      `a design needs exactly one core part, found ${cores.length}`,
    );

  if (errors.length > 0) return { ok: false, errors, issues };

  const usedConnectors = new Set<string>();
  const parentOf = new Map<string, string>();
  for (const conn of design.connections) {
    const parent = byIid.get(conn.parentIid);
    const child = byIid.get(conn.childIid);
    if (!parent || !child) {
      fail(
        "unknown-instance",
        `connection references unknown instance "${!parent ? conn.parentIid : conn.childIid}"`,
      );
      continue;
    }
    const parentConn = resolvePart(parent, catalog)?.connectors.find(
      (c) => c.id === conn.parentConnector,
    );
    const childConn = resolvePart(child, catalog)?.connectors.find(
      (c) => c.id === conn.childConnector,
    );
    if (!parentConn || !childConn) {
      fail(
        "missing-connector",
        `connection ${conn.parentIid}:${conn.parentConnector} -> ${conn.childIid}:${conn.childConnector} names a missing connector`,
      );
      continue;
    }
    if (parentConn.kind !== childConn.kind) {
      fail(
        "kind-mismatch",
        `connector kind mismatch: ${conn.parentIid}:${conn.parentConnector} is ${parentConn.kind}, ${conn.childIid}:${conn.childConnector} is ${childConn.kind}`,
      );
    }
    if ((conn.orientation ?? 0) !== 0 && parentConn.kind === "axle") {
      fail(
        "oriented-axle",
        `axle connections cannot be oriented (${conn.parentIid}:${conn.parentConnector})`,
      );
    }
    // Gearing is a drive-motor property. A rigid mount has no motor, and a
    // spinner runs at a fixed velocity by contract, so a ratio on either
    // would silently do nothing.
    if (
      conn.gearRatio !== undefined &&
      !isGearableConnector(parentConn, childConn)
    ) {
      fail(
        "gear-ratio",
        `gear ratio only applies to drive axles (${conn.parentIid}:${conn.parentConnector})`,
      );
    }
    for (const key of [
      `${conn.parentIid}:${conn.parentConnector}`,
      `${conn.childIid}:${conn.childConnector}`,
    ]) {
      if (usedConnectors.has(key))
        fail("connector-reused", `connector ${key} used more than once`);
      usedConnectors.add(key);
    }
    if (parentOf.has(conn.childIid)) {
      fail(
        "multiple-parents",
        `instance "${conn.childIid}" has more than one parent`,
      );
    }
    parentOf.set(conn.childIid, conn.parentIid);
  }

  const rootIid = cores[0].iid;
  if (parentOf.has(rootIid))
    fail("core-is-child", "the core part cannot be a child");

  const reachable = new Set<string>([rootIid]);
  const childrenOf = new Map<string, string[]>();
  for (const [child, parent] of parentOf) {
    const list = childrenOf.get(parent) ?? [];
    list.push(child);
    childrenOf.set(parent, list);
  }
  const queue = [rootIid];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    for (const child of childrenOf.get(next) ?? []) {
      if (!reachable.has(child)) {
        reachable.add(child);
        queue.push(child);
      }
    }
  }
  for (const part of design.parts) {
    if (!reachable.has(part.iid)) {
      fail(
        "disconnected",
        `instance "${part.iid}" is not connected to the core`,
      );
    }
  }

  // Overlapping part volumes are illegal: contacts between jointed pairs
  // are disabled in combat, so an overlapped part detaching would fire a
  // violent depenetration impulse. Yaw quarter-turns keep every part
  // axis-aligned, so world AABBs are exact.
  if (errors.length === 0) {
    const placements = computeLayout(design, catalog);
    const boxes: Array<{ iid: string; min: number[]; max: number[] }> = [];
    for (const part of design.parts) {
      const def = resolvePart(part, catalog);
      const placement = placements.get(part.iid);
      if (!def || !placement) continue;
      const { hx, hy, hz } = shapeHalfExtents(def.shape);
      // Quarter-turn yaw swaps the x/z extents for 90 and 270.
      const halfTurned = isQuarterTurned(placement.rotation);
      const ex = halfTurned ? hz : hx;
      const ez = halfTurned ? hx : hz;
      const p = placement.position;
      boxes.push({
        iid: part.iid,
        min: [p.x - ex, p.y - hy, p.z - ez],
        max: [p.x + ex, p.y + hy, p.z + ez],
      });
    }
    const EPS = 1e-6;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.min[0] < b.max[0] - EPS &&
          b.min[0] < a.max[0] - EPS &&
          a.min[1] < b.max[1] - EPS &&
          b.min[1] < a.max[1] - EPS &&
          a.min[2] < b.max[2] - EPS &&
          b.min[2] < a.max[2] - EPS;
        if (overlaps) {
          fail("overlap", `parts overlap: "${a.iid}" and "${b.iid}"`);
        }
      }
    }
  }

  let totalMass = 0;
  let powerDraw = 0;
  let powerSupply = 0;
  for (const part of design.parts) {
    const def = resolvePart(part, catalog);
    if (!def) continue;
    totalMass += partMass(def);
    powerDraw += def.powerDraw;
    powerSupply += def.powerSupply;
  }
  // Reduction gearing costs power, so torque competes with the weapon for
  // the core's budget instead of being free.
  for (const conn of design.connections) {
    powerDraw += gearPowerDraw(conn.gearRatio);
  }
  if (powerDraw > powerSupply) {
    fail(
      "power",
      `power overdraw: parts draw ${powerDraw}, supply is ${powerSupply}`,
    );
  }

  // Weight class (F-228). An undeclared design is unclassed and passes, so
  // every design that was legal before this rule existed is still legal.
  // An unknown class id is a bad declaration, not a free pass.
  const weightProblem = weightClassProblem(totalMass, design.weightClass);
  if (weightProblem !== null) fail("weight-class", weightProblem);

  if (errors.length > 0) return { ok: false, errors, issues };
  return {
    ok: true,
    stats: {
      partCount: design.parts.length,
      totalMass,
      powerDraw,
      powerSupply,
    },
  };
}

/** A known-valid starter design used by tests and the test arena. */
export const TEST_BOT_DESIGN: BotDesign = {
  name: "Rammer",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "spike", partId: "ram-spike" },
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
      childIid: "spike",
      childConnector: "mount",
    },
  ],
};

/**
 * A second stock design so exhibition matchups are asymmetric: identical
 * mirror bots take perfectly symmetric damage and always draw. The plate
 * adds mass and a different silhouette instead of a weapon.
 */
export const CPU_BRAWLER_DESIGN: BotDesign = {
  name: "Brawler",
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "wheel-l", partId: "drive-wheel" },
    { iid: "wheel-r", partId: "drive-wheel" },
    { iid: "plate", partId: "frame-plate" },
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
      childIid: "plate",
      childConnector: "bottom",
    },
  ],
};

/**
 * A stock heavy built from the B2 catalog: roller drums for a low
 * tracked stance, an armor wedge nose, and a plow blade. Exercises the
 * new parts in every exhibition and CPU test fight that selects it.
 */
export const CPU_BULLDOZER_DESIGN: BotDesign = {
  name: "Bulldozer",
  // Heavy and unhurried: shoves relentlessly, never swings wide.
  behavior: { aggression: 0.85, flankBias: 0.15, patience: 0.7 },
  parts: [
    { iid: "core", partId: "core-cube" },
    { iid: "drum-l", partId: "roller-drum" },
    { iid: "drum-r", partId: "roller-drum" },
    { iid: "wedge", partId: "armor-wedge" },
    { iid: "plow", partId: "plow-blade" },
  ],
  connections: [
    {
      parentIid: "core",
      parentConnector: "axle-left",
      childIid: "drum-l",
      childConnector: "hub-left",
    },
    {
      parentIid: "core",
      parentConnector: "axle-right",
      childIid: "drum-r",
      childConnector: "hub-right",
    },
    {
      parentIid: "core",
      parentConnector: "front",
      childIid: "wedge",
      childConnector: "mount",
    },
    {
      parentIid: "wedge",
      parentConnector: "face",
      childIid: "plow",
      childConnector: "mount",
    },
  ],
};

/**
 * The saw archetype (B2b): a spin-mounted blade on the nose, driven by
 * a constant-velocity axle motor from assembly. Rim hits massively
 * outdamage shoving, at the cost of a fragile blade.
 */
export const CPU_WHIRLIGIG_DESIGN: BotDesign = {
  name: "Whirligig",
  // Darting saw-carrier: quick resets, wide arcs to bring the blade in.
  behavior: { aggression: 0.6, flankBias: 0.8, patience: 0.2 },
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
    },
  ],
};
