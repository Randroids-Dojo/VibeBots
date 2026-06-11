import type {
  EventQueue,
  RevoluteImpulseJoint,
  RigidBody,
  World,
} from "@dimforge/rapier3d-deterministic-compat";
import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { type AssembledBot, assembleBot, setDriveVelocity } from "./assembly";
import type { BotDesign } from "./design";
import { PART_CATALOG, type PartDef, type Vec3 } from "./parts";

/**
 * Autonomous combat core: per-part damage from contact forces, part
 * destruction with physical detachment, and disable conditions. No player
 * input exists anywhere in this module (REQ-001); behavior comes from the
 * controller stub and, later, behavior parameters baked into the design.
 *
 * Determinism: damage derives only from rapier contact-force events of the
 * shared deterministic sim; deaths are processed in design part order.
 */

/**
 * Contact forces below this never damage parts. Measured with the starter
 * Testbots: rolling and spawn-settle forces peak near 26 N, ram and
 * sustained-shove contact holds near 49 N, so 35 N separates locomotion
 * from combat contact. Retune when part masses change.
 */
export const CONTACT_FORCE_THRESHOLD = 35;
export const DAMAGE_PER_NEWTON = 0.02;
export const DRIVE_SPEED = 12;

/** Default match length: 60 seconds of sim time (REQ-005). */
export const DEFAULT_TIME_LIMIT_TICKS = 3600;
/** Cores closer than this count as combat pressure for both bots. */
export const PRESSURE_RANGE = 2;

/**
 * Timeout judgment weights (placeholders until the fun-factor pass).
 * total = dealt * W_DEALT - taken * W_TAKEN + aliveRatio * W_PARTS
 *         + pressureRatio * W_PRESSURE + min(distance, DISTANCE_CAP)
 */
export const W_DEALT = 2;
export const W_TAKEN = 1;
export const W_PARTS = 50;
export const W_PRESSURE = 25;
export const DISTANCE_CAP = 25;

export interface PartCombatState {
  health: number;
  maxHealth: number;
  /** Destroyed parts took fatal damage; non-core parts also detach. */
  destroyed: boolean;
}

export interface CombatBot {
  design: BotDesign;
  assembled: AssembledBot;
  parts: Map<string, PartCombatState>;
  disabled: boolean;
  /** Core body cached at creation; the root body is never removed. */
  coreBody: RigidBody;
  /** Instance ids of mobility-category parts, from the match's catalog. */
  mobilityIids: ReadonlySet<string>;
  /** Child instance id -> parent instance id, from the design tree. */
  parentIid: ReadonlyMap<string, string>;
  /** Score accumulators for timeout judgment. */
  damageDealt: number;
  damageTaken: number;
  pressureTicks: number;
  distanceTraveled: number;
  lastCorePos: Vec3;
}

export interface MatchScore {
  damageDealt: number;
  damageTaken: number;
  partsRemaining: number;
  partCount: number;
  pressureTicks: number;
  distanceTraveled: number;
  total: number;
}

export type MatchEndReason = "disable" | "timeout";

export type MatchStatus =
  | { over: false }
  | {
      over: true;
      winner: 0 | 1 | null;
      reason: MatchEndReason;
      scores: [MatchScore, MatchScore];
    };

export interface MatchState {
  world: World;
  eventQueue: EventQueue;
  bots: [CombatBot, CombatBot];
  /** collider handle -> owning bot index and part instance. */
  colliderIndex: Map<number, { bot: 0 | 1; iid: string }>;
  tick: number;
  timeLimitTicks: number;
  status: MatchStatus;
}

function makeCombatBot(
  world: World,
  design: BotDesign,
  origin: Vec3,
  catalog: Record<string, PartDef>,
): CombatBot {
  const assembled = assembleBot(world, design, origin, catalog);
  const parts = new Map<string, PartCombatState>();
  for (const instance of design.parts) {
    const durability = catalog[instance.partId].durability;
    parts.set(instance.iid, {
      health: durability,
      maxHealth: durability,
      destroyed: false,
    });
  }
  for (const collider of assembled.colliders.values()) {
    collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    collider.setContactForceEventThreshold(CONTACT_FORCE_THRESHOLD);
  }
  const coreBody = assembled.bodies.get(assembled.rootIid);
  if (!coreBody) throw new Error("assembled bot lost its core body");
  const mobilityIids = new Set(
    design.parts
      .filter((p) => catalog[p.partId].category === "mobility")
      .map((p) => p.iid),
  );
  const parentIid = new Map(
    design.connections.map((c) => [c.childIid, c.parentIid]),
  );
  return {
    design,
    assembled,
    parts,
    disabled: false,
    coreBody,
    mobilityIids,
    parentIid,
    damageDealt: 0,
    damageTaken: 0,
    pressureTicks: 0,
    distanceTraveled: 0,
    lastCorePos: { ...origin },
  };
}

export interface MatchOptions {
  catalog?: Record<string, PartDef>;
  timeLimitTicks?: number;
}

export function createMatch(
  world: World,
  designs: [BotDesign, BotDesign],
  options: MatchOptions = {},
): MatchState {
  const catalog = options.catalog ?? PART_CATALOG;
  // Spawn just above rest height; a tall drop would exceed the damage
  // threshold on landing and bots would hurt themselves before contact.
  const a = makeCombatBot(world, designs[0], { x: 0, y: 0.42, z: -3 }, catalog);
  const b = makeCombatBot(world, designs[1], { x: 0, y: 0.42, z: 3 }, catalog);
  const colliderIndex = new Map<number, { bot: 0 | 1; iid: string }>();
  ([a, b] as const).forEach((bot, index) => {
    for (const [iid, collider] of bot.assembled.colliders) {
      colliderIndex.set(collider.handle, { bot: index as 0 | 1, iid });
    }
  });
  return {
    world,
    eventQueue: new RAPIER.EventQueue(true),
    bots: [a, b],
    colliderIndex,
    tick: 0,
    timeLimitTicks: options.timeLimitTicks ?? DEFAULT_TIME_LIMIT_TICKS,
    status: { over: false },
  };
}

/**
 * Direct damage entry point, shared by contact processing, future active
 * weapons, and tests.
 */
export function damagePart(
  match: MatchState,
  bot: 0 | 1,
  iid: string,
  amount: number,
): void {
  const state = match.bots[bot].parts.get(iid);
  if (!state || state.destroyed || amount <= 0) return;
  state.health -= amount;
  match.bots[bot].damageTaken += amount;
}

/** The controller stub: full throttle toward the opponent's core. */
function runControllers(match: MatchState): void {
  const cores = match.bots.map((bot) => bot.coreBody.translation());
  match.bots.forEach((bot, index) => {
    if (bot.disabled) {
      setDriveVelocity(bot.assembled, 0);
      return;
    }
    const myZ = cores[index].z;
    const enemyZ = cores[1 - index].z;
    const direction = enemyZ > myZ ? 1 : -1;
    setDriveVelocity(bot.assembled, direction * DRIVE_SPEED);
  });
}

/** A part contributes only while its whole chain to the core is intact. */
function attachedToCore(bot: CombatBot, iid: string): boolean {
  let current = iid;
  while (current !== bot.assembled.rootIid) {
    if (bot.parts.get(current)?.destroyed) return false;
    const parent = bot.parentIid.get(current);
    if (parent === undefined) return false;
    current = parent;
  }
  return !bot.parts.get(bot.assembled.rootIid)?.destroyed;
}

function processDeaths(match: MatchState): void {
  for (const bot of match.bots) {
    // Design part order keeps death processing deterministic.
    let anyDeath = false;
    for (const instance of bot.design.parts) {
      const state = bot.parts.get(instance.iid);
      if (!state || state.destroyed || state.health > 0) continue;
      state.destroyed = true;
      state.health = 0;
      anyDeath = true;
      if (instance.iid === bot.assembled.rootIid) {
        bot.disabled = true;
        continue;
      }
      const joint = bot.assembled.jointToParent.get(instance.iid);
      if (joint) {
        match.world.removeImpulseJoint(joint, true);
        bot.assembled.jointToParent.delete(instance.iid);
        const jointIndex = bot.assembled.joints.indexOf(joint);
        if (jointIndex >= 0) bot.assembled.joints.splice(jointIndex, 1);
        const axleIndex = bot.assembled.axleJoints.indexOf(
          joint as RevoluteImpulseJoint,
        );
        if (axleIndex >= 0) bot.assembled.axleJoints.splice(axleIndex, 1);
      }
    }
    if (!anyDeath || bot.disabled) continue;

    // Immobilized: no mobility part is both intact and still attached
    // (parts riding detached debris do not count).
    if (bot.mobilityIids.size > 0) {
      let mobile = false;
      for (const iid of bot.mobilityIids) {
        if (!bot.parts.get(iid)?.destroyed && attachedToCore(bot, iid)) {
          mobile = true;
          break;
        }
      }
      if (!mobile) bot.disabled = true;
    }
  }
}

function scoreBot(bot: CombatBot, timeLimitTicks: number): MatchScore {
  let partsRemaining = 0;
  for (const state of bot.parts.values()) {
    if (!state.destroyed) partsRemaining += 1;
  }
  const partCount = bot.parts.size;
  const aliveRatio = partCount > 0 ? partsRemaining / partCount : 0;
  const pressureRatio =
    timeLimitTicks > 0 ? bot.pressureTicks / timeLimitTicks : 0;
  const total =
    bot.damageDealt * W_DEALT -
    bot.damageTaken * W_TAKEN +
    aliveRatio * W_PARTS +
    pressureRatio * W_PRESSURE +
    Math.min(bot.distanceTraveled, DISTANCE_CAP);
  return {
    damageDealt: bot.damageDealt,
    damageTaken: bot.damageTaken,
    partsRemaining,
    partCount,
    pressureTicks: bot.pressureTicks,
    distanceTraveled: bot.distanceTraveled,
    total,
  };
}

function endMatch(match: MatchState, reason: MatchEndReason): void {
  const scores: [MatchScore, MatchScore] = [
    scoreBot(match.bots[0], match.timeLimitTicks),
    scoreBot(match.bots[1], match.timeLimitTicks),
  ];
  let winner: 0 | 1 | null;
  if (reason === "disable") {
    const [a, b] = match.bots;
    winner = a.disabled && b.disabled ? null : a.disabled ? 1 : 0;
  } else {
    winner =
      scores[0].total > scores[1].total
        ? 0
        : scores[1].total > scores[0].total
          ? 1
          : null;
  }
  match.status = { over: true, winner, reason, scores };
}

function updateStatus(match: MatchState): void {
  const [a, b] = match.bots;
  if (a.disabled || b.disabled) {
    endMatch(match, "disable");
    return;
  }
  if (match.tick >= match.timeLimitTicks) {
    endMatch(match, "timeout");
  }
}

/** Advances the match by one fixed timestep. */
export function stepMatch(match: MatchState): void {
  if (match.status.over) return;
  runControllers(match);
  match.world.step(match.eventQueue);
  match.tick += 1;

  match.eventQueue.drainContactForceEvents((event) => {
    const force = event.totalForceMagnitude();
    const damage = (force - CONTACT_FORCE_THRESHOLD) * DAMAGE_PER_NEWTON;
    if (damage <= 0) return;
    const owners = [event.collider1(), event.collider2()].map((handle) =>
      match.colliderIndex.get(handle),
    );
    for (const [side, owner] of owners.entries()) {
      if (!owner) continue;
      damagePart(match, owner.bot, owner.iid, damage);
      const other = owners[1 - side];
      if (other && other.bot !== owner.bot) {
        match.bots[other.bot].damageDealt += damage;
      }
    }
  });

  // Mobility and pressure accumulators for timeout judgment.
  const corePositions = match.bots.map((bot) => bot.coreBody.translation());
  for (const [index, bot] of match.bots.entries()) {
    const pos = corePositions[index];
    const last = bot.lastCorePos;
    bot.distanceTraveled += Math.sqrt(
      (pos.x - last.x) ** 2 + (pos.y - last.y) ** 2 + (pos.z - last.z) ** 2,
    );
    bot.lastCorePos = { x: pos.x, y: pos.y, z: pos.z };
  }
  const [a, b] = corePositions;
  const coreGap = Math.sqrt(
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2,
  );
  if (coreGap < PRESSURE_RANGE) {
    match.bots[0].pressureTicks += 1;
    match.bots[1].pressureTicks += 1;
  }

  processDeaths(match);
  updateStatus(match);
}

/**
 * Frees the match's own WASM-side resources. The world is owned by the
 * caller and freed separately.
 */
export function freeMatch(match: MatchState): void {
  match.eventQueue.free();
}

/** Stable serialization of combat state, for hashing alongside snapshots. */
export function combatStateString(match: MatchState): string {
  return match.bots
    .map((bot) => {
      const parts = bot.design.parts
        .map((p) => {
          const s = bot.parts.get(p.iid);
          return `${p.iid}=${s?.health.toFixed(4)}${s?.destroyed ? "x" : ""}`;
        })
        .join(",");
      const score = [
        bot.damageDealt.toFixed(4),
        bot.damageTaken.toFixed(4),
        bot.pressureTicks,
        bot.distanceTraveled.toFixed(4),
      ].join("/");
      return `${parts};${score}`;
    })
    .join("|");
}
