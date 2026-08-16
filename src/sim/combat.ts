import type {
  EventQueue,
  RigidBody,
  World,
} from "@dimforge/rapier3d-deterministic-compat";
import RAPIER from "@dimforge/rapier3d-deterministic-compat";
import {
  type AssembledBot,
  assembleBot,
  SPIN_MOTOR_FACTOR,
  SPIN_MOTOR_VELOCITY,
  setDriveVelocity,
} from "./assembly";
import {
  type BotDesign,
  NEUTRAL_BEHAVIOR,
  partInstanceDurability,
} from "./design";
import { PART_CATALOG, type PartDef, type Vec3, vec3Distance } from "./parts";
import {
  createTelemetry,
  type MatchTelemetry,
  recordDestruction,
  recordImpact,
  type TeardownInput,
} from "./telemetry";

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
/**
 * Damage degradation (F-232). A part used to work at full strength until
 * the tick it hit zero and vanished, which erased the most legible failure
 * mode a mechanic knows: the part that still works, but works worse. A
 * part's effectiveness now falls linearly with its health down to this
 * floor, so a chewed-up wheel drags its side and a battered spinner winds
 * down instead of staying lethal until the frame it breaks.
 *
 * The floor is not zero: a part at 1 hp still turns, it is just bad. A
 * zero floor would make the last sliver of health worthless and turn every
 * damaged bot into a sitting target.
 */
export const MIN_PART_EFFECTIVENESS = 0.35;

/** Linear falloff from 1 at full health to the floor at zero. Pure. */
export function partEffectiveness(healthRatio: number): number {
  const ratio = clamp(healthRatio, 0, 1);
  return MIN_PART_EFFECTIVENESS + (1 - MIN_PART_EFFECTIVENESS) * ratio;
}
/** Timeout totals closer than this are an honest draw, not float noise. */
export const SCORE_DRAW_EPSILON = 1;

/** Controller ram cycle: back off after closing in, then charge again. */
export const BACKOFF_TRIGGER_RANGE = 0.95;
export const BACKOFF_TICKS = 60;
export const BACKOFF_SPEED_FACTOR = 0.8;
export const RETARGET_INTERVAL_TICKS = 15;
export const TARGET_HYSTERESIS = 8;
export const FLANK_DISTANCE = 0.7;

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

export interface CombatBrainState {
  targetIid: string | null;
  targetScore: number;
  retargetAtTick: number;
  backoffUntilTick: number;
}

export interface TargetCandidate {
  iid: string;
  score: number;
  category: PartDef["category"];
  healthRatio: number;
  subtreeSize: number;
  distance: number;
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
  /** Instance ids of weapon-category parts, from the match's catalog. */
  weaponIids: ReadonlySet<string>;
  /** Part definitions by instance id, cached so the brain never searches. */
  partDefs: ReadonlyMap<string, PartDef>;
  /** Child instance id -> parent instance id, from the design tree. */
  parentIid: ReadonlyMap<string, string>;
  /** Parent instance id -> sorted child instance ids, from the design tree. */
  childIids: ReadonlyMap<string, readonly string[]>;
  /** Number of attached design nodes rooted at this part. */
  subtreeSizes: ReadonlyMap<string, number>;
  /** Score accumulators for timeout judgment. */
  damageDealt: number;
  damageTaken: number;
  pressureTicks: number;
  brain: CombatBrainState;
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
  /**
   * Impact and destruction log when the caller opted in. Recording is
   * observation only: an unrecorded match produces the identical hash, so
   * the bench can run thousands of matches without paying for the log.
   */
  telemetry: MatchTelemetry | null;
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
  const weaponIids = new Set(
    design.parts
      .filter((p) => catalog[p.partId].category === "weapon")
      .map((p) => p.iid),
  );
  const partDefs = new Map(
    design.parts.map((p) => [p.iid, catalog[p.partId]] as const),
  );
  const parentIid = new Map(
    design.connections.map((c) => [c.childIid, c.parentIid]),
  );
  const mutableChildren = new Map<string, string[]>();
  for (const part of design.parts) {
    mutableChildren.set(part.iid, []);
  }
  for (const conn of design.connections) {
    const children = mutableChildren.get(conn.parentIid) ?? [];
    children.push(conn.childIid);
    mutableChildren.set(conn.parentIid, children);
  }
  const childIids = new Map<string, readonly string[]>();
  for (const [iid, children] of mutableChildren) {
    childIids.set(
      iid,
      children.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  const subtreeSizes = new Map<string, number>();
  const countSubtree = (iid: string): number => {
    const cached = subtreeSizes.get(iid);
    if (cached !== undefined) return cached;
    let total = 1;
    for (const child of childIids.get(iid) ?? []) {
      total += countSubtree(child);
    }
    subtreeSizes.set(iid, total);
    return total;
  };
  for (const part of design.parts) {
    countSubtree(part.iid);
  }
  return {
    design,
    assembled,
    parts,
    disabled: false,
    coreBody,
    mobilityIids,
    weaponIids,
    partDefs,
    parentIid,
    childIids,
    subtreeSizes,
    damageDealt: 0,
    damageTaken: 0,
    pressureTicks: 0,
    brain: {
      targetIid: null,
      targetScore: 0,
      retargetAtTick: 0,
      backoffUntilTick: 0,
    },
  };
}

/**
 * Starting arrangements for a match (F-237 methodology fix).
 *
 * The sim is fully deterministic and spawns were fixed, so one matchup was
 * one outcome forever: a six-opponent bench produced six data points with
 * no variance, which is fine for catching a regression and useless for
 * judging balance. Varying where the bots start turns the same roster into
 * a real sample.
 *
 * Index 0 is exactly the historical spawn, so an unvaried match is
 * byte-identical to every match ever recorded and no stored replay or
 * golden vector moves. Offsets are pure data, well inside the wall ring,
 * and lateral ones force an opening turn instead of a head-on charge.
 */
export const SPAWN_ARRANGEMENTS: ReadonlyArray<{
  a: { x: number; z: number };
  b: { x: number; z: number };
}> = [
  { a: { x: 0, z: -3 }, b: { x: 0, z: 3 } },
  { a: { x: -1.5, z: -3 }, b: { x: 1.5, z: 3 } },
  { a: { x: 1.5, z: -3 }, b: { x: -1.5, z: 3 } },
  { a: { x: 0, z: -4.5 }, b: { x: 0, z: 4.5 } },
  { a: { x: -2, z: -2.5 }, b: { x: 2, z: 2.5 } },
  { a: { x: 2, z: -4 }, b: { x: -2, z: 4 } },
];

/** Spawn height: just above rest, so landing cannot self-damage. */
const SPAWN_Y = 0.42;

/**
 * The arrangement for a variation index, wrapping in both directions so a
 * caller iterating past the end (or passing a negative) gets a real spawn
 * rather than reading off the array.
 */
export function spawnArrangement(
  variation = 0,
): (typeof SPAWN_ARRANGEMENTS)[number] {
  const count = SPAWN_ARRANGEMENTS.length;
  return SPAWN_ARRANGEMENTS[((variation % count) + count) % count];
}

export interface MatchOptions {
  catalog?: Record<string, PartDef>;
  timeLimitTicks?: number;
  /** Record the impact log that feeds the post-match teardown sheet. */
  telemetry?: boolean;
  /**
   * Index into SPAWN_ARRANGEMENTS. Omitted or 0 reproduces the historical
   * fixed spawn exactly; higher indexes wrap.
   */
  variation?: number;
}

export function createMatch(
  world: World,
  designs: [BotDesign, BotDesign],
  options: MatchOptions = {},
): MatchState {
  const catalog = options.catalog ?? PART_CATALOG;
  // Spawn just above rest height; a tall drop would exceed the damage
  // threshold on landing and bots would hurt themselves before contact.
  const spawn = spawnArrangement(options.variation);
  const a = makeCombatBot(
    world,
    designs[0],
    { x: spawn.a.x, y: SPAWN_Y, z: spawn.a.z },
    catalog,
  );
  const b = makeCombatBot(
    world,
    designs[1],
    { x: spawn.b.x, y: SPAWN_Y, z: spawn.b.z },
    catalog,
  );
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
    telemetry: options.telemetry
      ? createTelemetry([
          designs[0].parts.map((part) => part.iid),
          designs[1].parts.map((part) => part.iid),
        ])
      : null,
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function groundDistance(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

function partPosition(bot: CombatBot, iid: string): Vec3 | null {
  const body = bot.assembled.bodies.get(iid);
  if (!body) return null;
  return body.translation();
}

function intactAttachedIids(
  bot: CombatBot,
  iids: ReadonlySet<string>,
): string[] {
  return bot.design.parts
    .map((p) => p.iid)
    .filter(
      (iid) =>
        iids.has(iid) &&
        !bot.parts.get(iid)?.destroyed &&
        attachedToCore(bot, iid),
    );
}

/** Health ratio of one part, 0 when it is gone or unknown. */
function healthRatioOf(bot: CombatBot, iid: string): number {
  const state = bot.parts.get(iid);
  if (!state || state.destroyed || state.maxHealth <= 0) return 0;
  return clamp(state.health / state.maxHealth, 0, 1);
}

/**
 * Drive condition, filled in place. Both figures come from one pass over
 * the mobility parts because runControllers needs both every tick:
 * `ratio` is how many wheels are left (the damage-aware throttle floor) and
 * `wear` is the mean effectiveness of the ones that remain (F-232).
 *
 * Written into a module-level scratch object rather than returned fresh:
 * this runs inside the arena's useFrame, where the frame-loop rule forbids
 * steady-state allocation. Traversal follows design part order, so the
 * float summation order is identical to a per-part loop.
 */
interface DriveCondition {
  ratio: number;
  wear: number;
}
const driveScratch: DriveCondition = { ratio: 1, wear: 1 };

function readDriveCondition(bot: CombatBot): DriveCondition {
  if (bot.mobilityIids.size === 0) {
    driveScratch.ratio = 1;
    driveScratch.wear = 1;
    return driveScratch;
  }
  let usable = 0;
  let total = 0;
  const parts = bot.design.parts;
  for (let i = 0; i < parts.length; i++) {
    const iid = parts[i].iid;
    if (!bot.mobilityIids.has(iid)) continue;
    if (bot.parts.get(iid)?.destroyed) continue;
    if (!attachedToCore(bot, iid)) continue;
    usable += 1;
    total += partEffectiveness(healthRatioOf(bot, iid));
  }
  driveScratch.ratio = usable / bot.mobilityIids.size;
  driveScratch.wear = usable === 0 ? 1 : total / usable;
  return driveScratch;
}

function hasUsableWeapon(bot: CombatBot): boolean {
  return intactAttachedIids(bot, bot.weaponIids).length > 0;
}

function firstUsableWeaponPosition(bot: CombatBot): Vec3 | null {
  const weapons = intactAttachedIids(bot, bot.weaponIids);
  return weapons.length > 0 ? partPosition(bot, weapons[0]) : null;
}

function stableSide(index: number, iid: string): number {
  let hash = index === 0 ? 17 : 31;
  for (let i = 0; i < iid.length; i++) {
    hash = Math.imul(hash ^ iid.charCodeAt(i), 16777619);
  }
  return (hash & 1) === 0 ? -1 : 1;
}

function categoryTargetValue(category: PartDef["category"]): number {
  switch (category) {
    case "core":
      return 90;
    case "weapon":
      return 72;
    case "mobility":
      return 68;
    case "structure":
      return 30;
  }
}

export function rankTargetCandidates(
  match: MatchState,
  botIndex: 0 | 1,
): TargetCandidate[] {
  const bot = match.bots[botIndex];
  const enemy = match.bots[1 - botIndex];
  const botCore = bot.coreBody.translation();
  const enemyCore = enemy.coreBody.translation();
  const enemyHasWeapon = hasUsableWeapon(enemy);
  const botHasWeapon = hasUsableWeapon(bot);
  const candidates: TargetCandidate[] = [];

  for (const part of enemy.design.parts) {
    const state = enemy.parts.get(part.iid);
    const def = enemy.partDefs.get(part.iid);
    const position = partPosition(enemy, part.iid);
    if (!state || !def || !position) continue;
    if (state.destroyed || !attachedToCore(enemy, part.iid)) continue;

    const healthRatio =
      state.maxHealth > 0 ? clamp(state.health / state.maxHealth, 0, 1) : 0;
    const subtreeSize = enemy.subtreeSizes.get(part.iid) ?? 1;
    const distance = groundDistance(botCore, position);
    const fromEnemyCore = groundDistance(enemyCore, position);
    const reachScore = clamp(24 - distance * 3, 0, 24);
    const exposedScore = clamp(fromEnemyCore * 16, 0, 18);
    const weaknessScore = (1 - healthRatio) * 42;
    const bridgeScore =
      part.iid === enemy.assembled.rootIid
        ? 0
        : clamp((subtreeSize - 1) * 12, 0, 36);
    const leafScore =
      (enemy.childIids.get(part.iid)?.length ?? 0) === 0 ? 6 : 0;
    const selfFit =
      botHasWeapon && (def.category === "core" || def.category === "weapon")
        ? 12
        : !botHasWeapon && def.category === "mobility"
          ? 16
          : 0;
    const dangerScore =
      enemyHasWeapon && def.category === "weapon"
        ? 18
        : enemyHasWeapon && def.category === "mobility"
          ? 8
          : 0;
    const score =
      categoryTargetValue(def.category) +
      weaknessScore +
      bridgeScore +
      exposedScore +
      reachScore +
      leafScore +
      selfFit +
      dangerScore;

    candidates.push({
      iid: part.iid,
      score,
      category: def.category,
      healthRatio,
      subtreeSize,
      distance,
    });
  }

  return candidates.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    if (a.iid < b.iid) return -1;
    if (a.iid > b.iid) return 1;
    return 0;
  });
}

function chooseTarget(
  match: MatchState,
  botIndex: 0 | 1,
): TargetCandidate | null {
  const bot = match.bots[botIndex];
  const enemy = match.bots[1 - botIndex];
  const currentIid = bot.brain.targetIid;
  const currentState =
    currentIid === null ? undefined : enemy.parts.get(currentIid);
  const currentValid =
    currentIid !== null &&
    currentState !== undefined &&
    !currentState.destroyed &&
    attachedToCore(enemy, currentIid);
  if (
    currentValid &&
    currentIid !== null &&
    match.tick < bot.brain.retargetAtTick
  ) {
    const currentDef = enemy.partDefs.get(currentIid);
    if (currentDef) {
      return {
        iid: currentIid,
        score: bot.brain.targetScore,
        category: currentDef.category,
        healthRatio:
          currentState.maxHealth > 0
            ? clamp(currentState.health / currentState.maxHealth, 0, 1)
            : 0,
        subtreeSize: enemy.subtreeSizes.get(currentIid) ?? 1,
        distance: groundDistance(
          bot.coreBody.translation(),
          partPosition(enemy, currentIid) ?? enemy.coreBody.translation(),
        ),
      };
    }
  }

  const ranked = rankTargetCandidates(match, botIndex);
  const best = ranked[0] ?? null;
  if (!best) {
    bot.brain.targetIid = null;
    bot.brain.targetScore = 0;
    bot.brain.retargetAtTick = match.tick + RETARGET_INTERVAL_TICKS;
    return null;
  }
  const current = bot.brain.targetIid
    ? ranked.find((candidate) => candidate.iid === bot.brain.targetIid)
    : undefined;
  const selected =
    current && current.score + TARGET_HYSTERESIS >= best.score ? current : best;
  bot.brain.targetIid = selected.iid;
  bot.brain.targetScore = selected.score;
  bot.brain.retargetAtTick = match.tick + RETARGET_INTERVAL_TICKS;
  return selected;
}

/**
 * Spins each weapon at its own current effectiveness, so a chewed-up blade
 * winds down instead of staying lethal until the frame it breaks. A
 * disabled bot stops its spinners entirely. Loops in place rather than
 * taking a callback: this runs every tick inside the arena's useFrame.
 */
function applySpinWear(bot: CombatBot): void {
  const spins = bot.assembled.spinJoints;
  for (let i = 0; i < spins.length; i++) {
    const spin = spins[i];
    const effectiveness = bot.disabled
      ? 0
      : partEffectiveness(healthRatioOf(bot, spin.childIid));
    spin.joint.configureMotorVelocity(
      SPIN_MOTOR_VELOCITY * effectiveness,
      SPIN_MOTOR_FACTOR,
    );
  }
}

/**
 * The controller: deterministic target scoring plus differential drive.
 * Each bot selects the opponent part that best converts its current build
 * into damage: weakened weapons, exposed mobility, bridge structures, and
 * cores all compete by score. The drive intent then aims the bot so its own
 * weapon offset reaches that target, or flanks if it is out-weaponed.
 */
function runControllers(match: MatchState): void {
  match.bots.forEach((bot, rawIndex) => {
    const index = rawIndex as 0 | 1;
    if (bot.disabled) {
      setDriveVelocity(bot.assembled, 0);
      applySpinWear(bot);
      return;
    }
    const enemy = match.bots[1 - index];
    const target = chooseTarget(match, index);
    const me = bot.coreBody.translation();
    const enemyCore = enemy.coreBody.translation();
    const targetPos =
      target === null
        ? enemyCore
        : (partPosition(enemy, target.iid) ?? enemyCore);
    const targetDistance = groundDistance(me, targetPos);
    const botHasWeapon = hasUsableWeapon(bot);
    const enemyHasWeapon = hasUsableWeapon(enemy);
    // Worn drive parts turn slower (F-232), and a damaged spinner winds
    // down instead of staying at full rim speed until it breaks.
    const drive = readDriveCondition(bot);
    const mobility = drive.ratio;
    const wear = drive.wear;
    applySpinWear(bot);

    const behavior = bot.design.behavior ?? NEUTRAL_BEHAVIOR;
    // Neutral 0.5 reproduces the classic constants exactly; the factors
    // scale linearly to 0.5x..1.5x across the slider range.
    const behaviorScale = (value: number) => 0.5 + value;
    if (
      bot.brain.backoffUntilTick === 0 &&
      targetDistance < BACKOFF_TRIGGER_RANGE
    ) {
      bot.brain.backoffUntilTick =
        match.tick +
        Math.round(BACKOFF_TICKS * behaviorScale(behavior.patience));
    } else if (
      bot.brain.backoffUntilTick !== 0 &&
      match.tick >= bot.brain.backoffUntilTick
    ) {
      bot.brain.backoffUntilTick = 0;
    }

    let aimX = targetPos.x;
    let aimZ = targetPos.z;
    const weaponPos = firstUsableWeaponPosition(bot);
    if (botHasWeapon && weaponPos) {
      aimX += (me.x - weaponPos.x) * 0.9;
      aimZ += (me.z - weaponPos.z) * 0.9;
    }
    if (enemyHasWeapon && (!botHasWeapon || mobility < 0.75)) {
      const enemyPlusZ = bodyPlusZ(enemy.coreBody);
      const enemyFrontLen =
        Math.sqrt(enemyPlusZ.x ** 2 + enemyPlusZ.z ** 2) || 1;
      const enemyFrontX = -enemyPlusZ.x / enemyFrontLen;
      const enemyFrontZ = -enemyPlusZ.z / enemyFrontLen;
      const side = stableSide(index, target?.iid ?? enemy.assembled.rootIid);
      const flank = FLANK_DISTANCE * behaviorScale(behavior.flankBias);
      aimX += -enemyFrontZ * flank * side - enemyFrontX * 0.3;
      aimZ += enemyFrontX * flank * side - enemyFrontZ * 0.3;
    }

    const toLen = Math.sqrt((aimX - me.x) ** 2 + (aimZ - me.z) ** 2) || 1;
    const tx = (aimX - me.x) / toLen;
    const tz = (aimZ - me.z) / toLen;
    const plusZ = bodyPlusZ(bot.coreBody);
    const fLen = Math.sqrt(plusZ.x ** 2 + plusZ.z ** 2) || 1;
    // The bot's front and weapon side is local -z.
    const fx = -plusZ.x / fLen;
    const fz = -plusZ.z / fLen;
    const aligned = fx * tx + fz * tz;
    const cross = fx * tz - fz * tx;
    const steer =
      aligned < -0.2
        ? cross >= 0
          ? MAX_STEER
          : -MAX_STEER
        : clamp(STEER_GAIN * cross, -MAX_STEER, MAX_STEER);

    if (bot.brain.backoffUntilTick !== 0) {
      setDriveVelocity(
        bot.assembled,
        DRIVE_SPEED * BACKOFF_SPEED_FACTOR * wear,
        0,
      );
      return;
    }

    const turnThrottle = aligned < -0.2 ? 0.45 : 1 - Math.abs(steer) * 0.35;
    // Aggression widens or narrows the damage-aware throttle floor.
    const damageThrottle =
      (0.72 + mobility * 0.28) * (0.8 + behavior.aggression * 0.4);
    setDriveVelocity(
      bot.assembled,
      -DRIVE_SPEED * clamp(turnThrottle * damageThrottle, 0.35, 1) * wear,
      steer,
    );
  });
}

function processDeaths(match: MatchState): void {
  // Indexed rather than .entries(): this runs every tick and Map/array
  // entry iteration allocates a tuple per element (frame-loop rule).
  for (let botIndex = 0; botIndex < match.bots.length; botIndex++) {
    const bot = match.bots[botIndex];
    // Design part order keeps death processing deterministic.
    let anyDeath = false;
    for (const instance of bot.design.parts) {
      const state = bot.parts.get(instance.iid);
      if (!state || state.destroyed || state.health > 0) continue;
      state.destroyed = true;
      state.health = 0;
      anyDeath = true;
      if (match.telemetry) {
        recordDestruction(
          match.telemetry,
          match.tick,
          botIndex as 0 | 1,
          instance.iid,
        );
      }
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
        // Spin joints must be dropped too. This was harmless while spinners
        // were configured once at assembly and never touched again, but
        // degradation (F-232) drives them every tick, so a stale entry is a
        // call into a joint the world has already freed.
        const spinIndex = bot.assembled.spinJoints.findIndex(
          (motor) => motor.joint === joint,
        );
        if (spinIndex >= 0) bot.assembled.spinJoints.splice(spinIndex, 1);
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
        if (match.telemetry) {
          recordImpact(
            match.telemetry,
            match.tick,
            other.bot,
            other.iid,
            owner.bot,
            owner.iid,
            force,
            applied,
            other.isWeapon,
          );
        }
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

/**
 * Extracts the plain data the teardown sheet is built from. Returns null
 * when the match was not recorded, so callers cannot silently render an
 * empty sheet as if the fight had no impacts.
 */
export function teardownInputFrom(match: MatchState): TeardownInput | null {
  if (!match.telemetry) return null;
  const bots = match.bots.map((bot) => ({
    name: bot.design.name,
    parts: bot.design.parts.map((instance) => {
      const state = bot.parts.get(instance.iid);
      const def = bot.partDefs.get(instance.iid);
      return {
        iid: instance.iid,
        partId: instance.partId,
        name: def?.name ?? instance.partId,
        category: def?.category ?? "structure",
        health: state?.health ?? 0,
        maxHealth: state?.maxHealth ?? 0,
        destroyed: state?.destroyed ?? false,
      };
    }),
  })) as TeardownInput["bots"];
  return { telemetry: match.telemetry, bots, ticks: match.tick };
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
