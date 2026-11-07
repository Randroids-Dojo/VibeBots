/**
 * Fight debrief (G9): what the test fight decided and what to change.
 *
 * The teardown sheet (F-225) is an inspection full of numbers; this module
 * turns the same numbers into a headline and at most two lessons, each with
 * a fix-it action, so build, test, learn, tweak closes as one loop. The
 * lessons are rules in a fixed order over the teardown, not a model, so
 * the same fight always says the same thing.
 */
import type { MatchEndReason, MatchScore } from "@/sim/combat";
import {
  type BotBehavior,
  type BotDesign,
  type BotRule,
  NEUTRAL_BEHAVIOR,
  type Pitch,
} from "@/sim/design";
import { FIGHT_LADDER } from "@/sim/opponents";
import { PART_CATALOG, type PartDef } from "@/sim/parts";
import type { MatchTeardown, TeardownPart } from "@/sim/telemetry";
import {
  currentCoreId,
  subtreeIids,
  validSlotsFor,
} from "@/state/workshop-store";
import { describeRule, sameRule, WEAPON_DOWN_RULE } from "./bot-rules";
import { placementBlocker } from "./workshop-budget";

export type DebriefAction =
  | { kind: "browse"; partId: string }
  /**
   * The suggested part has no open mount on this bot: select the part
   * holding the mount it needs (its inspector offers Remove, which Undo
   * reverses) and show the suggestion in the carousel. Changes nothing.
   */
  | { kind: "make-room"; partId: string; iid: string }
  | { kind: "select"; iid: string }
  | { kind: "tune" }
  /** Apply a temperament change and open Tune so the slider is seen moving (H1). */
  | { kind: "behavior"; patch: Partial<BotBehavior> }
  /** Add a bench rule and open Tune on it (F-247). */
  | { kind: "rule"; rule: BotRule }
  /** Tilt a weapon's mount to a preset angle and show it on the bench (second lever). */
  | { kind: "pitch"; iid: string; pitch: Pitch };

export type DebriefLessonId =
  | "pitch"
  | "counter"
  | "no-hits"
  | "rule"
  | "first-loss"
  | "decision"
  | "resets"
  | "soak"
  | "weakest"
  | "clean";

export interface DebriefLesson {
  id: DebriefLessonId;
  text: string;
  action: DebriefAction | null;
  actionLabel: string | null;
}

export interface FightDebrief {
  headline: string;
  lessons: DebriefLesson[];
}

export interface DebriefInput {
  teardown: MatchTeardown;
  winner: 0 | 1 | null;
  reason: MatchEndReason;
  /** The judges' scores, present when the fight went to time. */
  scores: readonly [MatchScore, MatchScore] | null;
  /** Which side of the teardown is the player's bot. */
  me: 0 | 1;
  design: BotDesign;
  /** Part ids the player owns at least one of; undefined means unknown. */
  ownedPartIds?: readonly string[];
  /** The ladder rung the opponent was, when it was one; a rival has none. */
  rungId?: string;
}

/** A weapon down this long before the end earns the rule lesson (F-247). */
export const RULE_LESSON_MIN_TICKS = 300;

/** How many lessons a debrief shows at most: short enough to act on. */
export const DEBRIEF_MAX_LESSONS = 2;
/** A part that took this share of the bot's damage is the soak lesson. */
export const SOAK_SHARE = 0.5;
/** A surviving part under this health fraction is the weakest-survivor lesson. */
export const WEAK_SURVIVOR_FRACTION = 0.5;
/** Weapons in the order the no-hits lesson suggests them (longest reach first). */
export const WEAPON_SUGGESTIONS: readonly string[] = [
  "lance",
  "saw-blade",
  "ripsaw",
  "heavy-bar",
  "spinner-bar",
  "cleaver",
  "great-cleaver",
  "tempered-spike",
  "ram-spike",
];
/** The plate the soak and core lessons send the player to. */
export const PLATE_SUGGESTION = "frame-plate";
/** How far a lever lesson moves its slider (H1); undoable like any edit. */
export const AGGRESSION_STEP = 0.2;
export const PATIENCE_STEP = 0.25;
/** A knockout taken while giving less than this share of what it took stayed in the pocket. */
export const POCKET_RATIO = 0.5;

const TICKS_PER_SECOND = 60;

/** "m:ss" from a tick count at 60 ticks a second. */
export function clockFromTicks(ticks: number): string {
  const total = Math.max(0, Math.floor(ticks / TICKS_PER_SECOND));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

function reasonWord(reason: MatchEndReason): string {
  return reason === "disable" ? "knockout" : "decision";
}

/** The weapon to suggest: an owned one that is not the current one, else the reach leader. */
export function suggestWeapon(
  ownedPartIds: readonly string[] | undefined,
  exclude: string | null,
): string {
  if (ownedPartIds) {
    for (const id of WEAPON_SUGGESTIONS) {
      if (id !== exclude && ownedPartIds.includes(id)) return id;
    }
  }
  for (const id of WEAPON_SUGGESTIONS) {
    if (id !== exclude) return id;
  }
  return WEAPON_SUGGESTIONS[0];
}

/** Whether the current design has a place for a part, and what is in the way. */
export type MountRoom =
  | { kind: "open" }
  /** No catalog entry, or a power or weight limit: the carousel says why. */
  | { kind: "unknown" }
  /** Removing this one part (and what hangs off it) frees a legal slot. */
  | { kind: "occupied"; iid: string; name: string; carried: string[] }
  /** Every mount it takes is in use and no single removal frees one. */
  | { kind: "full" };

/**
 * Where a suggested part could go on this design. When nothing is open
 * for lack of a mount, find the part whose removal frees one: a weapon
 * suggestion looks at the core's front first (the nose every ladder
 * counter was measured on), then a part of the same family, then any
 * other. A candidate only counts when removing its subtree really leaves
 * a legal slot for the part, the same test the drag ghosts use.
 */
export function mountRoom(
  design: BotDesign,
  partId: string,
  catalog: Record<string, PartDef> = PART_CATALOG,
): MountRoom {
  const def = catalog[partId];
  if (!def) return { kind: "unknown" };
  const blocker = placementBlocker(design, def, catalog);
  if (!blocker) return { kind: "open" };
  if (blocker.kind !== "mount") return { kind: "unknown" };
  const coreIid = currentCoreId(design);
  const kinds = new Set(def.connectors.map((c) => c.kind));
  const rank = (childIid: string, parentIid: string, connector: string) => {
    const child = design.parts.find((p) => p.iid === childIid);
    const childDef = child ? catalog[child.partId] : undefined;
    if (!childDef) return -1;
    if (
      def.category === "weapon" &&
      parentIid === coreIid &&
      connector === "front"
    ) {
      return 0;
    }
    if (childDef.category === def.category) return 1;
    // Never point a non-weapon suggestion at the bot's weapon.
    if (def.category !== "weapon" && childDef.category === "weapon") return -1;
    return 2;
  };
  const candidates = design.connections
    .filter((conn) => {
      const parent = design.parts.find((p) => p.iid === conn.parentIid);
      const parentConn = parent
        ? catalog[parent.partId]?.connectors.find(
            (c) => c.id === conn.parentConnector,
          )
        : undefined;
      return parentConn !== undefined && kinds.has(parentConn.kind);
    })
    .map((conn) => ({
      iid: conn.childIid,
      rank: rank(conn.childIid, conn.parentIid, conn.parentConnector),
    }))
    .filter((c) => c.rank >= 0)
    .sort((a, b) => a.rank - b.rank);
  for (const { iid } of candidates) {
    const removed = subtreeIids(design, iid);
    const after: BotDesign = {
      ...design,
      parts: design.parts.filter((p) => !removed.has(p.iid)),
      connections: design.connections.filter(
        (c) => !removed.has(c.childIid) && !removed.has(c.parentIid),
      ),
    };
    if (validSlotsFor(after, def, catalog).length === 0) continue;
    const nameOf = (id: string) => {
      const inst = design.parts.find((p) => p.iid === id);
      return (inst && catalog[inst.partId]?.name) ?? id;
    };
    return {
      kind: "occupied",
      iid,
      name: nameOf(iid),
      carried: design.parts
        .filter((p) => p.iid !== iid && removed.has(p.iid))
        .map((p) => nameOf(p.iid)),
    };
  }
  return { kind: "full" };
}

/**
 * A lesson that suggests a part: browse to it when the bot has room,
 * otherwise say what holds the mount and hand the player to that part.
 * Nothing is removed for them; the inspector's Remove and Undo stay
 * their choice.
 */
function suggestPart(
  design: BotDesign,
  partId: string,
  text: string,
  actionLabel: string,
): Pick<DebriefLesson, "text" | "action" | "actionLabel"> {
  const room = mountRoom(design, partId);
  if (room.kind === "occupied") {
    const what =
      room.carried.length === 0
        ? `Your ${room.name} holds`
        : `Your ${room.name} and the ${room.carried.join(" and ")} on it hold`;
    const them = room.carried.length === 0 ? "it" : "them";
    return {
      text: `${text} ${what} the mount it needs: remove ${them} to make room (Undo puts ${them} back).`,
      action: { kind: "make-room", partId, iid: room.iid },
      actionLabel: `Show the ${room.name}`,
    };
  }
  if (room.kind === "full") {
    return {
      text: `${text} No mount is open for it now: remove a part to make room.`,
      action: { kind: "browse", partId },
      actionLabel,
    };
  }
  return { text, action: { kind: "browse", partId }, actionLabel };
}

function pct(fraction: number): number {
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
}

export function buildDebrief(input: DebriefInput): FightDebrief {
  const { teardown, winner, reason, scores, me, design } = input;
  const mine = teardown.bots[me];
  const theirs = teardown.bots[me === 0 ? 1 : 0];
  const clock = clockFromTicks(teardown.ticks);
  const won = winner === me;
  const drew = winner === null;

  const headline = drew
    ? `Draw by ${reasonWord(reason)} at ${clock}`
    : won
      ? `You won by ${reasonWord(reason)} at ${clock}`
      : `You lost by ${reasonWord(reason)} at ${clock}`;
  const behavior: BotBehavior = { ...NEUTRAL_BEHAVIOR, ...design.behavior };

  const lessons: DebriefLesson[] = [];
  const weapon = design.parts
    .map((part) => PART_CATALOG[part.partId])
    .find((def) => def?.category === "weapon");
  // 0. A loss (or a draw) to a ladder rung names the counter the ladder
  // test proves beats it (F-250), unless the bot already carries that
  // part: then the lessons below say why it still lost.
  const rung = input.rungId
    ? FIGHT_LADDER.find((candidate) => candidate.id === input.rungId)
    : undefined;
  const counter =
    rung &&
    !won &&
    !design.parts.some((part) => part.partId === rung.counter.partId)
      ? rung.counter
      : null;
  const counterDef = counter ? PART_CATALOG[counter.partId] : undefined;
  // 0a. The free counter first: the weapon already on the bot, tilted one
  // notch, measured to flip this rung (second lever, 2026-09-04).
  const pitchCounter = rung && !won ? rung.pitchCounter : undefined;
  const pitchTarget = pitchCounter
    ? design.parts.find((part) => part.partId === pitchCounter.partId)
    : undefined;
  const pitchConn = pitchTarget
    ? design.connections.find((c) => c.childIid === pitchTarget.iid)
    : undefined;
  if (
    pitchCounter &&
    pitchTarget &&
    pitchConn &&
    (pitchConn.pitch ?? 0) !== pitchCounter.pitch
  ) {
    lessons.push({
      id: "pitch",
      text: pitchCounter.text,
      action: {
        kind: "pitch",
        iid: pitchTarget.iid,
        pitch: pitchCounter.pitch,
      },
      actionLabel: `Tilt it ${pitchCounter.pitch > 0 ? "up" : "down"} ${Math.abs(pitchCounter.pitch)}`,
    });
  }
  // 0b. The free rule: one bench line measured to flip this rung, offered
  // when the design does not already carry it (second rule vocabulary).
  const ruleCounter = rung && !won ? rung.ruleCounter : undefined;
  if (
    ruleCounter &&
    !(design.rules ?? []).some((rule) => sameRule(rule, ruleCounter.rule))
  ) {
    lessons.push({
      id: "rule",
      text: `${ruleCounter.text} ${describeRule(ruleCounter.rule)}`,
      action: { kind: "rule", rule: ruleCounter.rule },
      actionLabel: "Add the rule",
    });
  }
  // What the weapons themselves landed: hull contact also deals damage,
  // and a bot that only bumped still has a weapon that never connected.
  let weaponDamage = 0;
  for (const part of mine.parts) {
    if (part.category === "weapon") weaponDamage += part.damageDealt;
  }

  // 1. No weapon, or a weapon that never landed: the bot cannot win a
  // fight it never touches. A weaponless bot gets this lesson whatever
  // its hull happened to bump, because the bump is not a plan.
  if (!weapon) {
    // The weapon lesson stays first for a weaponless bot; when the loss
    // was to a rung, the rung's counter is the weapon it points at.
    const counterIsWeapon = counterDef?.category === "weapon";
    lessons.push({
      id: "no-hits",
      ...suggestPart(
        design,
        counter && counterIsWeapon
          ? counter.partId
          : suggestWeapon(input.ownedPartIds, null),
        counter
          ? `This bot has no weapon, so it can only bump. ${counter.text}`
          : "This bot has no weapon, so it can only bump. Mount one on the front.",
        "Pick a weapon",
      ),
    });
  } else if (counter) {
    lessons.push({
      id: "counter",
      ...suggestPart(
        design,
        counter.partId,
        counter.text,
        `Browse the ${counterDef?.name ?? counter.partId}`,
      ),
    });
  }
  if (weapon && weaponDamage <= 0) {
    lessons.push({
      id: "no-hits",
      ...suggestPart(
        design,
        suggestWeapon(input.ownedPartIds, weapon.id),
        `Your ${weapon.name} never connected. A longer reach or a spinner can land hits that the ${weapon.name} cannot.`,
        "Try another weapon",
      ),
    });
  }

  // 1b. A weapon that went down while the fight went on: the bot kept
  // fighting without it, and a bench rule is the lever for that (F-247).
  if (!won && weapon) {
    let weaponLossTick: number | null = null;
    for (const part of mine.parts) {
      if (part.category !== "weapon" || part.destroyedAtTick === null) continue;
      if (weaponLossTick === null || part.destroyedAtTick < weaponLossTick) {
        weaponLossTick = part.destroyedAtTick;
      }
    }
    const hasRule =
      design.rules?.some((rule) => rule.when === WEAPON_DOWN_RULE.when) ??
      false;
    if (
      weaponLossTick !== null &&
      !hasRule &&
      teardown.ticks - weaponLossTick >= RULE_LESSON_MIN_TICKS
    ) {
      lessons.push({
        id: "rule",
        text: `Your ${weapon.name} went down at ${clockFromTicks(weaponLossTick)} and the bot fought on without it for ${clockFromTicks(teardown.ticks - weaponLossTick)}. A rule changes that: ${describeRule(WEAPON_DOWN_RULE)}`,
        action: { kind: "rule", rule: WEAPON_DOWN_RULE },
        actionLabel: "Add the rule",
      });
    }
  }

  // 2. The first part to go, and what took it.
  let firstLoss: TeardownPart | null = null;
  let firstLossTick = Number.POSITIVE_INFINITY;
  for (const part of mine.parts) {
    if (part.destroyedAtTick === null) continue;
    if (part.destroyedAtTick < firstLossTick) {
      firstLossTick = part.destroyedAtTick;
      firstLoss = part;
    }
  }
  if (firstLoss) {
    const taker = firstLoss.killedByName ?? "the opponent";
    const at = clockFromTicks(firstLossTick);
    if (firstLoss.category === "core") {
      lessons.push({
        id: "first-loss",
        ...suggestPart(
          design,
          PLATE_SUGGESTION,
          `Your core went down at ${at}, taken by ${taker}: nothing else was there to take the hits. Armour it.`,
          "Browse plates",
        ),
      });
    } else {
      lessons.push({
        id: "first-loss",
        text: `${firstLoss.name} went first at ${at}, taken by ${taker}. A plate on that side can shield it.`,
        action: { kind: "select", iid: firstLoss.iid },
        actionLabel: "Show that part",
      });
    }
  }

  // 3. Lost (or drew) on the judges' card: on a decision the card is the
  // verdict, so this comes before the soak detail. Spending less of the
  // fight on the front foot than the opponent is the throttle lever.
  if (reason === "timeout" && !won && scores) {
    const ours = Math.round(scores[me].total);
    const others = Math.round(scores[me === 0 ? 1 : 0].total);
    const ticks = Math.max(1, teardown.ticks);
    const myFoot = scores[me].pressureTicks / ticks;
    const theirFoot = scores[me === 0 ? 1 : 0].pressureTicks / ticks;
    if (myFoot < theirFoot && behavior.aggression < 1) {
      lessons.push({
        id: "decision",
        text: `${drew ? `The judges had it level, ${ours} to ${others}` : `The judges scored it ${others} to ${ours}`}. You were on the front foot ${pct(myFoot)}% of the fight to their ${pct(theirFoot)}%: raise Aggression to close faster.`,
        action: {
          kind: "behavior",
          patch: {
            aggression: Math.min(1, behavior.aggression + AGGRESSION_STEP),
          },
        },
        actionLabel: "Raise aggression",
      });
    } else {
      lessons.push({
        id: "decision",
        text: drew
          ? `The judges had it level, ${ours} to ${others}. More drive power closes the distance and lands the extra hit.`
          : `The judges scored it ${others} to ${ours}: fewer hits landed. More drive power closes the distance; see Tune.`,
        action: { kind: "tune" },
        actionLabel: "Open Tune",
      });
    }
  }

  // 4. Knocked out while giving far less than it took: the bot stayed in
  // the pocket. Patience is the reset lever.
  if (
    reason === "disable" &&
    !won &&
    !drew &&
    mine.damageTaken > 0 &&
    mine.damageDealt < mine.damageTaken * POCKET_RATIO &&
    behavior.patience < 1
  ) {
    lessons.push({
      id: "resets",
      text: `You gave ${Math.round(mine.damageDealt)} and took ${Math.round(mine.damageTaken)}: the bot stayed in the pocket. Raise Patience so it resets after a hit.`,
      action: {
        kind: "behavior",
        patch: { patience: Math.min(1, behavior.patience + PATIENCE_STEP) },
      },
      actionLabel: "Raise patience",
    });
  }

  // 5. One part soaked the damage: spread the load.
  if (mine.damageTaken > 0) {
    let soak: TeardownPart | null = null;
    for (const part of mine.parts) {
      if (soak === null || part.damageTaken > soak.damageTaken) soak = part;
    }
    if (soak && soak !== firstLoss) {
      const share = soak.damageTaken / mine.damageTaken;
      if (share >= SOAK_SHARE) {
        lessons.push({
          id: "soak",
          ...suggestPart(
            design,
            PLATE_SUGGESTION,
            `${soak.name} took ${pct(share)}% of the damage. A plate beside it spreads the load.`,
            "Browse plates",
          ),
        });
      }
    }
  }

  // 6. Won: name the survivor that nearly did not.
  if (won) {
    let weakest: TeardownPart | null = null;
    let weakestFraction = 1;
    for (const part of mine.parts) {
      if (part.destroyed || part.maxHealth <= 0) continue;
      const fraction = part.health / part.maxHealth;
      if (fraction < weakestFraction) {
        weakestFraction = fraction;
        weakest = part;
      }
    }
    if (weakest && weakestFraction < WEAK_SURVIVOR_FRACTION) {
      lessons.push({
        id: "weakest",
        text: `${weakest.name} came home at ${pct(weakestFraction)}%, the closest call of the parts that survived. A plate on that side can shield it.`,
        action: { kind: "select", iid: weakest.iid },
        actionLabel: "Show that part",
      });
    }
  }

  if (lessons.length === 0) {
    lessons.push({
      id: "clean",
      text: `Clean fight: nothing gave and ${theirs.name} could not answer. Try a harder opponent.`,
      action: null,
      actionLabel: null,
    });
  }

  return { headline, lessons: lessons.slice(0, DEBRIEF_MAX_LESSONS) };
}
