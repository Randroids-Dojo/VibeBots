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
import type { BotDesign } from "@/sim/design";
import { PART_CATALOG } from "@/sim/parts";
import type { MatchTeardown, TeardownPart } from "@/sim/telemetry";

export type DebriefAction =
  | { kind: "browse"; partId: string }
  | { kind: "select"; iid: string }
  | { kind: "tune" };

export type DebriefLessonId =
  | "no-hits"
  | "first-loss"
  | "soak"
  | "decision"
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
}

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
  "spinner-bar",
  "cleaver",
  "ram-spike",
];
/** The plate the soak and core lessons send the player to. */
export const PLATE_SUGGESTION = "frame-plate";

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

  const lessons: DebriefLesson[] = [];
  const weapon = design.parts
    .map((part) => PART_CATALOG[part.partId])
    .find((def) => def?.category === "weapon");

  // 1. No weapon, or a weapon that never landed: the bot cannot win a
  // fight it never touches. A weaponless bot gets this lesson whatever
  // its hull happened to bump, because the bump is not a plan.
  if (!weapon) {
    lessons.push({
      id: "no-hits",
      text: "This bot has no weapon, so it can only bump. Mount one on the front.",
      action: {
        kind: "browse",
        partId: suggestWeapon(input.ownedPartIds, null),
      },
      actionLabel: "Pick a weapon",
    });
  } else if (mine.damageDealt <= 0) {
    lessons.push({
      id: "no-hits",
      text: `Your ${weapon.name} never connected. A longer reach or a spinner lands hits the ${weapon.name} cannot.`,
      action: {
        kind: "browse",
        partId: suggestWeapon(input.ownedPartIds, weapon.id),
      },
      actionLabel: "Try another weapon",
    });
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
        text: `Your core went down at ${at}, taken by ${taker}: nothing else was there to take the hits. Armour it.`,
        action: { kind: "browse", partId: PLATE_SUGGESTION },
        actionLabel: "Browse plates",
      });
    } else {
      lessons.push({
        id: "first-loss",
        text: `${firstLoss.name} went first at ${at}, taken by ${taker}. Merge it up a level or armour that side.`,
        action: { kind: "select", iid: firstLoss.iid },
        actionLabel: "Show that part",
      });
    }
  }

  // 3. One part soaked the damage: spread the load.
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
          text: `${soak.name} took ${pct(share)}% of the damage. A plate beside it spreads the load.`,
          action: { kind: "browse", partId: PLATE_SUGGESTION },
          actionLabel: "Browse plates",
        });
      }
    }
  }

  // 4. Lost (or drew) on the judges' card: close the distance.
  if (reason === "timeout" && !won && scores) {
    const ours = Math.round(scores[me].total);
    const others = Math.round(scores[me === 0 ? 1 : 0].total);
    lessons.push({
      id: "decision",
      text: drew
        ? `The judges had it level, ${ours} to ${others}. More drive power closes the distance and lands the extra hit.`
        : `The judges scored it ${others} to ${ours}: fewer hits landed. More drive power closes the distance; see Tune.`,
      action: { kind: "tune" },
      actionLabel: "Open Tune",
    });
  }

  // 5. Won: name the survivor that nearly did not.
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
        text: `${weakest.name} came home at ${pct(weakestFraction)}%: it goes first next time. Merge it up or armour that side.`,
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
