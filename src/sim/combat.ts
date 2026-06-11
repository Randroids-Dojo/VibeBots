import type {
  EventQueue,
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

/** Contact forces below this never damage parts (rolling, resting). */
export const CONTACT_FORCE_THRESHOLD = 50;
export const DAMAGE_PER_NEWTON = 0.05;
export const DRIVE_SPEED = 12;

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
}

export type MatchStatus =
  | { over: false }
  | { over: true; winner: 0 | 1 | null };

export interface MatchState {
  world: World;
  eventQueue: EventQueue;
  bots: [CombatBot, CombatBot];
  /** collider handle -> owning bot index and part instance. */
  colliderIndex: Map<number, { bot: 0 | 1; iid: string }>;
  tick: number;
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
  return { design, assembled, parts, disabled: false };
}

export function createMatch(
  world: World,
  designs: [BotDesign, BotDesign],
  catalog: Record<string, PartDef> = PART_CATALOG,
): MatchState {
  const a = makeCombatBot(world, designs[0], { x: 0, y: 0.5, z: -3 }, catalog);
  const b = makeCombatBot(world, designs[1], { x: 0, y: 0.5, z: 3 }, catalog);
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
}

/** The controller stub: full throttle toward the opponent's core. */
function runControllers(match: MatchState): void {
  const cores = match.bots.map(
    (bot) =>
      bot.assembled.bodies.get(bot.assembled.rootIid)?.translation() ?? {
        z: 0,
      },
  );
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

function processDeaths(match: MatchState): void {
  match.bots.forEach((bot, _index) => {
    // Design part order keeps death processing deterministic.
    for (const instance of bot.design.parts) {
      const state = bot.parts.get(instance.iid);
      if (!state || state.destroyed || state.health > 0) continue;
      state.destroyed = true;
      state.health = 0;
      if (instance.iid === bot.assembled.rootIid) {
        bot.disabled = true;
        continue;
      }
      const joint = bot.assembled.jointToParent.get(instance.iid);
      if (joint) {
        match.world.removeImpulseJoint(joint, true);
        bot.assembled.jointToParent.delete(instance.iid);
        const axleIndex = bot.assembled.axleJoints.indexOf(
          joint as (typeof bot.assembled.axleJoints)[number],
        );
        if (axleIndex >= 0) bot.assembled.axleJoints.splice(axleIndex, 1);
      }
    }

    // Immobilized without any working mobility part.
    const catalogOf = (iid: string) =>
      bot.design.parts.find((p) => p.iid === iid)?.partId ?? "";
    let mobilityAlive = false;
    for (const [iid, state] of bot.parts) {
      const partId = catalogOf(iid);
      if (PART_CATALOG[partId]?.category === "mobility" && !state.destroyed) {
        mobilityAlive = true;
        break;
      }
    }
    const hasMobility = bot.design.parts.some(
      (p) => PART_CATALOG[p.partId]?.category === "mobility",
    );
    if (hasMobility && !mobilityAlive) bot.disabled = true;
  });
}

function updateStatus(match: MatchState): void {
  const [a, b] = match.bots;
  if (!a.disabled && !b.disabled) return;
  if (a.disabled && b.disabled) match.status = { over: true, winner: null };
  else match.status = { over: true, winner: a.disabled ? 1 : 0 };
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
    for (const handle of [event.collider1(), event.collider2()]) {
      const owner = match.colliderIndex.get(handle);
      if (owner) damagePart(match, owner.bot, owner.iid, damage);
    }
  });

  processDeaths(match);
  updateStatus(match);
}

/** Stable serialization of combat state, for hashing alongside snapshots. */
export function combatStateString(match: MatchState): string {
  return match.bots
    .map((bot) =>
      bot.design.parts
        .map((p) => {
          const s = bot.parts.get(p.iid);
          return `${p.iid}=${s?.health.toFixed(4)}${s?.destroyed ? "x" : ""}`;
        })
        .join(","),
    )
    .join("|");
}
