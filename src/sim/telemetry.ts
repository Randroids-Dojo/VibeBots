import type { PartCategory } from "./parts";

/**
 * Match telemetry: the observation layer over combat. Recording is pure
 * bookkeeping (it never feeds back into the sim), so a recorded match and
 * an unrecorded one produce identical hashes. Nothing here imports rapier,
 * so the teardown can be rebuilt from stored data without a live world.
 *
 * This exists because the fight was previously a black box: a banner said
 * who won and nothing said why. Every number below answers a "why did it
 * lose" question a builder can act on.
 */

export interface ImpactEvent {
  tick: number;
  /** Bot index that owns the striking part. */
  attackerBot: 0 | 1;
  attackerIid: string;
  /** Bot index that owns the part that took the hit. */
  victimBot: 0 | 1;
  victimIid: string;
  /** Raw rapier contact force magnitude in newtons. */
  force: number;
  /** Health actually removed (overkill is not counted). */
  damage: number;
  /** The striking part was a weapon, so the weapon multiplier applied. */
  weapon: boolean;
}

export interface DestructionEvent {
  tick: number;
  bot: 0 | 1;
  iid: string;
}

/**
 * Impacts are capped so a long grinding match cannot grow an unbounded
 * array on the server. 4096 covers a full 60-second fight with room to
 * spare; past the cap counters keep accruing and `truncated` says so.
 */
export const MAX_TELEMETRY_IMPACTS = 4096;

/** Running damage totals for one part, complete even if the log truncates. */
export interface PartTally {
  damageDealt: number;
  damageTaken: number;
  hitsDealt: number;
  hitsTaken: number;
  /** Attacker instance id -> damage that attacker took off this part. */
  takenFrom: Map<string, number>;
}

function emptyTally(): PartTally {
  return {
    damageDealt: 0,
    damageTaken: 0,
    hitsDealt: 0,
    hitsTaken: 0,
    takenFrom: new Map(),
  };
}

export interface MatchTelemetry {
  /**
   * The detail log, bounded by MAX_TELEMETRY_IMPACTS. Slots are reused: a
   * recorded impact writes into an existing object rather than allocating,
   * because stepMatch runs inside the arena's useFrame and the frame-loop
   * rule forbids steady-state garbage there. `logged` is the live length.
   */
  impacts: ImpactEvent[];
  /** How many slots of `impacts` hold a real event. */
  logged: number;
  destructions: DestructionEvent[];
  /** True once impacts hit the cap: the totals stay exact, the log does not. */
  truncated: boolean;
  /** Impacts observed, including any that did not fit the log. */
  impactCount: number;
  /**
   * Per-bot, per-part running totals. These are accumulated on every impact
   * regardless of the log cap, so a truncated match still reports exact
   * damage. Deriving the totals from the log instead would silently
   * under-report a long fight.
   */
  tallies: [Map<string, PartTally>, Map<string, PartTally>];
}

export function createTelemetry(): MatchTelemetry {
  return {
    impacts: [],
    logged: 0,
    destructions: [],
    truncated: false,
    impactCount: 0,
    tallies: [new Map(), new Map()],
  };
}

function tallyFor(
  telemetry: MatchTelemetry,
  bot: 0 | 1,
  iid: string,
): PartTally {
  const perBot = telemetry.tallies[bot];
  const existing = perBot.get(iid);
  if (existing) return existing;
  const created = emptyTally();
  perBot.set(iid, created);
  return created;
}

/**
 * Records one impact. Takes primitives rather than an event object so the
 * caller never builds a literal on the frame path; the log slot is reused.
 */
export function recordImpact(
  telemetry: MatchTelemetry,
  tick: number,
  attackerBot: 0 | 1,
  attackerIid: string,
  victimBot: 0 | 1,
  victimIid: string,
  force: number,
  damage: number,
  weapon: boolean,
): void {
  telemetry.impactCount += 1;

  const attacker = tallyFor(telemetry, attackerBot, attackerIid);
  attacker.damageDealt += damage;
  attacker.hitsDealt += 1;
  const victim = tallyFor(telemetry, victimBot, victimIid);
  victim.damageTaken += damage;
  victim.hitsTaken += 1;
  victim.takenFrom.set(
    attackerIid,
    (victim.takenFrom.get(attackerIid) ?? 0) + damage,
  );

  if (telemetry.logged >= MAX_TELEMETRY_IMPACTS) {
    telemetry.truncated = true;
    return;
  }
  const slot = telemetry.impacts[telemetry.logged];
  if (slot) {
    slot.tick = tick;
    slot.attackerBot = attackerBot;
    slot.attackerIid = attackerIid;
    slot.victimBot = victimBot;
    slot.victimIid = victimIid;
    slot.force = force;
    slot.damage = damage;
    slot.weapon = weapon;
  } else {
    telemetry.impacts.push({
      tick,
      attackerBot,
      attackerIid,
      victimBot,
      victimIid,
      force,
      damage,
      weapon,
    });
  }
  telemetry.logged += 1;
}

/** The impacts actually held in the log, without the unused pool tail. */
export function loggedImpacts(telemetry: MatchTelemetry): ImpactEvent[] {
  return telemetry.impacts.slice(0, telemetry.logged);
}

/**
 * Records a part destruction. Bounded by the design's part count, so this
 * one keeps its plain push: a match can only ever fire a few dozen.
 */
export function recordDestruction(
  telemetry: MatchTelemetry,
  tick: number,
  bot: 0 | 1,
  iid: string,
): void {
  telemetry.destructions.push({ tick, bot, iid });
}

/** Plain per-part end state, extracted from a match by combat.ts. */
export interface TeardownPartInput {
  iid: string;
  partId: string;
  name: string;
  category: PartCategory;
  health: number;
  maxHealth: number;
  destroyed: boolean;
}

export interface TeardownBotInput {
  name: string;
  parts: TeardownPartInput[];
}

export interface TeardownInput {
  telemetry: MatchTelemetry;
  bots: [TeardownBotInput, TeardownBotInput];
  /** Tick the match ended on, for "survived N seconds" style readouts. */
  ticks: number;
}

/** One row of the inspection sheet: what happened to a single part. */
export interface TeardownPart extends TeardownPartInput {
  /** Health removed from this part over the match. */
  damageTaken: number;
  /** Health this part removed from the opponent. */
  damageDealt: number;
  /** Impacts this part took. */
  hitsTaken: number;
  /** Impacts this part landed. */
  hitsDealt: number;
  /** Tick this part was destroyed, or null if it survived. */
  destroyedAtTick: number | null;
  /** Instance id of the enemy part that dealt it the most damage. */
  killedBy: string | null;
}

export interface TeardownBot extends TeardownBotInput {
  parts: TeardownPart[];
  damageDealt: number;
  damageTaken: number;
  /** Tick the first part was lost, or null if the bot came home whole. */
  firstLossTick: number | null;
  partsLost: number;
}

/** The hardest single impacts of the match, newest scoring first. */
export interface TeardownHighlight extends ImpactEvent {
  attackerPartName: string;
  victimPartName: string;
}

export interface MatchTeardown {
  bots: [TeardownBot, TeardownBot];
  ticks: number;
  totalImpacts: number;
  truncated: boolean;
  /** The five hardest hits of the match, by damage. */
  hardestHits: TeardownHighlight[];
}

export const TEARDOWN_HIGHLIGHT_COUNT = 5;

/**
 * Folds the raw impact log into the per-part inspection sheet. Pure and
 * order-stable: ties break on instance id so two runs of the same match
 * always produce the same sheet.
 */
export function buildTeardown(input: TeardownInput): MatchTeardown {
  const bots = input.bots.map((bot) => ({
    ...bot,
    parts: bot.parts.map(
      (part): TeardownPart => ({
        ...part,
        damageTaken: 0,
        damageDealt: 0,
        hitsTaken: 0,
        hitsDealt: 0,
        destroyedAtTick: null,
        killedBy: null,
      }),
    ),
    damageDealt: 0,
    damageTaken: 0,
    firstLossTick: null as number | null,
    partsLost: 0,
  })) as [TeardownBot, TeardownBot];

  const byIid = bots.map(
    (bot) => new Map(bot.parts.map((part) => [part.iid, part])),
  );

  // Totals come from the running tallies, never from the log. The log is
  // capped, so folding it would silently under-report a long fight while
  // still showing an impact count that says otherwise.
  for (const [index, bot] of bots.entries()) {
    for (const part of bot.parts) {
      const tally = input.telemetry.tallies[index].get(part.iid);
      if (!tally) continue;
      part.damageDealt = tally.damageDealt;
      part.damageTaken = tally.damageTaken;
      part.hitsDealt = tally.hitsDealt;
      part.hitsTaken = tally.hitsTaken;
      bot.damageDealt += tally.damageDealt;
      bot.damageTaken += tally.damageTaken;
    }
  }

  for (const event of input.telemetry.destructions) {
    const part = byIid[event.bot].get(event.iid);
    if (!part) continue;
    part.destroyedAtTick = event.tick;
    const bot = bots[event.bot];
    bot.partsLost += 1;
    if (bot.firstLossTick === null || event.tick < bot.firstLossTick) {
      bot.firstLossTick = event.tick;
    }
  }

  for (const [index, bot] of bots.entries()) {
    for (const part of bot.parts) {
      if (part.destroyedAtTick === null) continue;
      // Attribution also comes from the tally, so the killing blow is named
      // correctly even in a match whose log truncated.
      const sources = input.telemetry.tallies[index].get(part.iid)?.takenFrom;
      if (!sources) continue;
      let bestIid: string | null = null;
      let bestDamage = -1;
      // Sorted so an exact tie always names the same part.
      for (const [iid, damage] of [...sources].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      )) {
        if (damage > bestDamage) {
          bestDamage = damage;
          bestIid = iid;
        }
      }
      part.killedBy = bestIid;
    }
  }

  const nameOf = (bot: 0 | 1, iid: string) => byIid[bot].get(iid)?.name ?? iid;
  // Highlights can only come from the log, so they are a sample of a
  // truncated match. `truncated` on the report says when that is the case.
  const hardestHits = loggedImpacts(input.telemetry)
    .sort((a, b) => {
      const delta = b.damage - a.damage;
      if (delta !== 0) return delta;
      if (a.tick !== b.tick) return a.tick - b.tick;
      return a.victimIid < b.victimIid ? -1 : a.victimIid > b.victimIid ? 1 : 0;
    })
    .slice(0, TEARDOWN_HIGHLIGHT_COUNT)
    .map((impact) => ({
      ...impact,
      attackerPartName: nameOf(impact.attackerBot, impact.attackerIid),
      victimPartName: nameOf(impact.victimBot, impact.victimIid),
    }));

  return {
    bots,
    ticks: input.ticks,
    totalImpacts: input.telemetry.impactCount,
    truncated: input.telemetry.truncated,
    hardestHits,
  };
}
