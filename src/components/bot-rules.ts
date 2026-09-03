import {
  type BotRule,
  RULE_ACTIONS,
  RULE_CONDITIONS,
  type RuleAction,
  type RuleCondition,
} from "@/sim/design";

/** How the bench and the debrief word each condition and action (F-247). */
export const RULE_CONDITION_COPY: Record<RuleCondition, string> = {
  "weapon-down": "my weapon is down",
  "enemy-weapon-down": "their weapon is down",
  "enemy-immobile": "they cannot drive",
  "core-hurt": "my core is under 40%",
  "clock-late": "the clock is in its last third",
};

export const RULE_ACTION_COPY: Record<RuleAction, string> = {
  disengage: "back off",
  charge: "charge without resets",
  hold: "hold still",
};

/** The rule the debrief offers after a weapon went down (F-247). */
export const WEAPON_DOWN_RULE: BotRule = {
  when: "weapon-down",
  act: "disengage",
};

/** One sentence per rule, the way the bench and the debrief say it. */
export function describeRule(rule: BotRule): string {
  return `When ${RULE_CONDITION_COPY[rule.when]}, ${RULE_ACTION_COPY[rule.act]}.`;
}

export function sameRule(a: BotRule, b: BotRule): boolean {
  return a.when === b.when && a.act === b.act;
}

/**
 * The rule the Add button proposes: the first condition the list does
 * not use yet, with the first action, so every tap adds a distinct line.
 */
export function suggestRule(rules: readonly BotRule[]): BotRule {
  const used = new Set(rules.map((rule) => rule.when));
  const when = RULE_CONDITIONS.find((condition) => !used.has(condition));
  return { when: when ?? RULE_CONDITIONS[0], act: RULE_ACTIONS[0] };
}
