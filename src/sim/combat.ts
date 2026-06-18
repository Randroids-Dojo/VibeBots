import type {
  EventQueue,
  RigidBody,
  World,
} from "@dimforge/rapier3d-deterministic-compat";
import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { type AssembledBot, assembleBot, setDriveVelocity } from "./assembly";
import { type BotDesign, partInstanceDurability } from "./design";
import { PART_CATALOG, type PartDef, type Vec3, vec3Distance } from "./parts";

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
 * Only bot-versus-bot contacts deal damage; ground and self contacts are
 * free (arena hazards come later). Measured over full exhibitions (probe,
 * 2026-06-10): cross-bot wheel contact peaks near 19 N, core shoving holds
 * 30 to 49 N. 20 N makes sustained shoving grind cores down while wheel
 * brushes stay near-free; the scale makes a shove-dominated match destroy
 * parts well before the time limit. Retune when part masses change.
 */
export const CONTACT_FORCE_THRESHOLD = 20;
export const DAMAGE_PER_NEWTON = 0.22;
/** Victim damage multiplier when the striking part is a weapon. */
export const WEAPON_DAMAGE_MULTIPLIER = 6;
/**
 * Per-event damage cap (after the weapon multiplier). First impacts fire
 * several very-high-force events in a burst; uncapped they one-shot cores
 * and the show ends at the opening clash.
 */
export const MAX_EVENT_DAMAGE = 45;
export const DRIVE_SPEED = 12;
/** Timeout totals closer than this are an honest draw, not float noise. */
export const SCORE_DRAW_EPSILON = 1;

/** Controller ram cycle: back off after closing in, then charge again. */
export const BACKOFF_TRIGGER_RANGE = 0.95;
export const BACKOFF_TICKS = 60;
export const BACKOFF_SPEED_FACTOR = 0.8;

/** Default match length: 60 seconds of sim time (REQ-005). */
export const DEFAULT_TIME_LIMIT_TICKS = 3600;
/** Pressure needs the enemy within range AND closing velocity above this. */
export const PRESSURE_RANGE = 3;
export const PRESSURE_CLOSING_SPEED = 0.5;

/**
 * Timeout judgment weights (placeholders until the fun-factor pass).
 * The weapon multiplier makes dealt/taken genuinely asymmetric (a weapon
 * bot deals several times what it takes per clash); health ratio, parts
 * ratio, end-of-match mobility, and directional pressure (accrued only
 * while actually advancing on the enemy) separate bots further.
 */
export const W_DEALT = 2;
export const W_TAKEN = 1;
export const W_HEALTH = 50;
export const W_PARTS = 30;
export const W_PRESSURE = 25;
export const W_MOBILE = 15;

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
  /** Ram-cycle controller state: charging when 0, else back off until tick. */
  backoffUntilTick: number;
}

export interface MatchScore {
  damageDealt: number;
  damageTaken: number;
  partsRemaining: number;
  partCount: number;
  healthRemaining: number;
  healthTotal: number;
  pressureTicks: number;
  mobileAtEnd: boolean;
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
  colliderIndex: Map<number, { bot: 0 | 1; iid: string; isWeapon: boolean }>;
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
    const durability = partInstanceDurability(instance, catalog);
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
    backoffUntilTick: 0,
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
  const colliderIndex = new Map<
    number,
    { bot: 0 | 1; iid: string; isWeapon: boolean }
  >();
  ([a, b] as const).forEach((bot, index) => {
    for (const [iid, collider] of bot.assembled.colliders) {
      const partId = bot.design.parts.find((p) => p.iid === iid)?.partId ?? "";
      colliderIndex.set(collider.handle, {
        bot: index as 0 | 1,
        iid,
        isWeapon: catalog[partId]?.category === "weapon",
      });
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
): number {
  const state = match.bots[bot].parts.get(iid);
  if (!state || state.destroyed || amount <= 0) return 0;
  // Overkill pays nothing: only health actually removed counts as damage.
  const applied = Math.min(amount, state.health);
  state.health -= applied;
  match.bots[bot].damageTaken += applied;
  return applied;
}

/** Local +z rotated by the body's quaternion. Pure arithmetic, no trig. */
function bodyPlusZ(body: RigidBody): { x: number; z: number } {
  const q = body.rotation();
  return {
    x: 2 * (q.x * q.z + q.w * q.y),
    z: 1 - 2 * (q.x * q.x + q.y * q.y),
  };
}

const STEER_GAIN = 2;
const MAX_STEER = 0.9;

/**
 * The controller: weapon-first differential drive with ram cycles.
 * Steers toward the enemy (cross product of facing and to-enemy in the
 * ground plane), charges, backs off briefly after closing in, charges
 * again. Repeated impacts are what make physical combat read as combat:
 * a constant push just wedges the bots below the damage threshold.
 * Deterministic: tick and sim state only, arithmetic only.
 */
function runControllers(match: MatchState): void {
  const cores = match.bots.map((bot) => bot.coreBody.translation());
  const gap = vec3Distance(cores[0], cores[1]);
  match.bots.forEach((bot, index) => {
    if (bot.disabled) {
      setDriveVelocity(bot.assembled, 0);
      return;
    }
    if (bot.backoffUntilTick === 0 && gap < BACKOFF_TRIGGER_RANGE) {
      bot.backoffUntilTick = match.tick + BACKOFF_TICKS;
    } else if (
      bot.backoffUntilTick !== 0 &&
      match.tick >= bot.backoffUntilTick
    ) {
      bot.backoffUntilTick = 0;
    }

    const me = cores[index];
    const enemy = cores[1 - index];
    const toLen = Math.sqrt((enemy.x - me.x) ** 2 + (enemy.z - me.z) ** 2) || 1;
    const tx = (enemy.x - me.x) / toLen;
    const tz = (enemy.z - me.z) / toLen;
    // The bot's front (weapon side) is local -z.
    const plusZ = bodyPlusZ(bot.coreBody);
    const fLen = Math.sqrt(plusZ.x ** 2 + plusZ.z ** 2) || 1;
    const fx = -plusZ.x / fLen;
    const fz = -plusZ.z / fLen;
    const aligned = fx * tx + fz * tz;
    const cross = fx * tz - fz * tx;
    // Enemy behind: commit to a full turn (cross alone is zero directly
    // astern, the pursuit singularity). Tie-break is deterministic.
    const steer =
      aligned < -0.2
        ? cross >= 0
          ? MAX_STEER
          : -MAX_STEER
        : Math.max(-MAX_STEER, Math.min(MAX_STEER, STEER_GAIN * cross));

    if (bot.backoffUntilTick !== 0) {
      // Reverse straight back to set up the next ram.
      setDriveVelocity(bot.assembled, DRIVE_SPEED * BACKOFF_SPEED_FACTOR, 0);
    } else {
      // Negative motor velocity drives the front (local -z) forward;
      // throttle down while turning hard so the turn actually happens.
      const throttle = aligned < -0.2 ? 0.45 : 1;
      setDriveVelocity(bot.assembled, -DRIVE_SPEED * throttle, steer);
    }
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
        const axleIndex = bot.assembled.axleJoints.findIndex(
          (motor) => motor.joint === joint,
        );
        if (axleIndex >= 0) bot.assembled.axleJoints.splice(axleIndex, 1);
      }
    }
    if (!anyDeath || bot.disabled) continue;

    // Immobilized: no mobility part is both intact and still attached
    // (parts riding detached debris do not count).
    if (!isMobile(bot)) bot.disabled = true;
  }
}

function isMobile(bot: CombatBot): boolean {
  if (bot.disabled) return false;
  if (bot.mobilityIids.size === 0) return true;
  for (const iid of bot.mobilityIids) {
    if (!bot.parts.get(iid)?.destroyed && attachedToCore(bot, iid)) return true;
  }
  return false;
}

function scoreBot(bot: CombatBot, timeLimitTicks: number): MatchScore {
  let partsRemaining = 0;
  let healthRemaining = 0;
  let healthTotal = 0;
  for (const state of bot.parts.values()) {
    if (!state.destroyed) partsRemaining += 1;
    healthRemaining += state.health;
    healthTotal += state.maxHealth;
  }
  const partCount = bot.parts.size;
  const aliveRatio = partCount > 0 ? partsRemaining / partCount : 0;
  const healthRatio = healthTotal > 0 ? healthRemaining / healthTotal : 0;
  const pressureRatio =
    timeLimitTicks > 0 ? bot.pressureTicks / timeLimitTicks : 0;
  const mobileAtEnd = isMobile(bot);
  const total =
    bot.damageDealt * W_DEALT -
    bot.damageTaken * W_TAKEN +
    healthRatio * W_HEALTH +
    aliveRatio * W_PARTS +
    pressureRatio * W_PRESSURE +
    (mobileAtEnd ? W_MOBILE : 0);
  return {
    damageDealt: bot.damageDealt,
    damageTaken: bot.damageTaken,
    partsRemaining,
    partCount,
    healthRemaining,
    healthTotal,
    pressureTicks: bot.pressureTicks,
    mobileAtEnd,
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
    const margin = scores[0].total - scores[1].total;
    // Sub-epsilon margins are float noise from symmetric grinding, not a
    // result a viewer should be told is a win.
    winner =
      margin > SCORE_DRAW_EPSILON ? 0 : margin < -SCORE_DRAW_EPSILON ? 1 : null;
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
      const other = owners[1 - side];
      // Only combat contact damages: both parts owned, different bots,
      // and the striking part must still be alive (debris is inert).
      if (!other || other.bot === owner.bot) continue;
      if (match.bots[other.bot].parts.get(other.iid)?.destroyed) continue;
      // Weapons concentrate force: the struck part takes extra damage.
      const amount = Math.min(
        other.isWeapon ? damage * WEAPON_DAMAGE_MULTIPLIER : damage,
        MAX_EVENT_DAMAGE,
      );
      // Hitting destroyed debris applies (and credits) nothing.
      const applied = damagePart(match, owner.bot, owner.iid, amount);
      if (applied > 0) {
        match.bots[other.bot].damageDealt += applied;
      }
    }
  });

  // Directional pressure: in range AND actually closing on the enemy.
  const a = match.bots[0].coreBody.translation();
  const b = match.bots[1].coreBody.translation();
  const gap = vec3Distance(a, b);
  if (gap < PRESSURE_RANGE && gap > 0) {
    for (const [index, bot] of match.bots.entries()) {
      if (bot.disabled) continue;
      const me = index === 0 ? a : b;
      const enemy = index === 0 ? b : a;
      const vel = bot.coreBody.linvel();
      const closingSpeed =
        (vel.x * (enemy.x - me.x) +
          vel.y * (enemy.y - me.y) +
          vel.z * (enemy.z - me.z)) /
        gap;
      if (closingSpeed > PRESSURE_CLOSING_SPEED) {
        bot.pressureTicks += 1;
      }
    }
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
      ].join("/");
      return `${parts};${score}`;
    })
    .join("|");
}
