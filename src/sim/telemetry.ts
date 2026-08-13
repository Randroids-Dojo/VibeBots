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

export interface MatchTelemetry {
  impacts: ImpactEvent[];
  destructions: DestructionEvent[];
  /** True once impacts hit the cap: totals stay honest, the log does not. */
  truncated: boolean;
  /** Impacts observed, including any dropped after the cap. */
  impactCount: number;
}

export function createTelemetry(): MatchTelemetry {
  return { impacts: [], destructions: [], truncated: false, impactCount: 0 };
}

export function recordImpact(
  telemetry: MatchTelemetry,
  event: ImpactEvent,
): void {
  telemetry.impactCount += 1;
  if (telemetry.impacts.length >= MAX_TELEMETRY_IMPACTS) {
    telemetry.truncated = true;
    return;
  }
  telemetry.impacts.push(event);
}

export function recordDestruction(
  telemetry: MatchTelemetry,
  event: DestructionEvent,
): void {
  telemetry.destructions.push(event);
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
  // Per victim part: which attacker part has taken the most off it.
  const attribution = bots.map(() => new Map<string, Map<string, number>>());

  for (const impact of input.telemetry.impacts) {
    const attacker = byIid[impact.attackerBot].get(impact.attackerIid);
    const victim = byIid[impact.victimBot].get(impact.victimIid);
    if (attacker) {
      attacker.damageDealt += impact.damage;
      attacker.hitsDealt += 1;
      bots[impact.attackerBot].damageDealt += impact.damage;
    }
    if (victim) {
      victim.damageTaken += impact.damage;
      victim.hitsTaken += 1;
      bots[impact.victimBot].damageTaken += impact.damage;
      const perVictim = attribution[impact.victimBot];
      const sources = perVictim.get(impact.victimIid) ?? new Map();
      sources.set(
        impact.attackerIid,
        (sources.get(impact.attackerIid) ?? 0) + impact.damage,
      );
      perVictim.set(impact.victimIid, sources);
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
      const sources = attribution[index].get(part.iid);
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
  const hardestHits = [...input.telemetry.impacts]
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
