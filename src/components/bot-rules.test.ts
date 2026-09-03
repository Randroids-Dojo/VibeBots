import { describe, expect, it } from "vitest";
import { RULE_ACTIONS, RULE_CONDITIONS } from "@/sim/design";
import {
  describeRule,
  RULE_ACTION_COPY,
  RULE_CONDITION_COPY,
  suggestRule,
  WEAPON_DOWN_RULE,
} from "./bot-rules";

describe("bench rule copy (F-247)", () => {
  it("words every condition and action the sim knows", () => {
    for (const condition of RULE_CONDITIONS) {
      expect(RULE_CONDITION_COPY[condition]).toBeTruthy();
    }
    for (const action of RULE_ACTIONS) {
      expect(RULE_ACTION_COPY[action]).toBeTruthy();
    }
    expect(describeRule(WEAPON_DOWN_RULE)).toBe(
      "When my weapon is down, back off.",
    );
  });

  it("proposes a distinct condition per added rule", () => {
    const first = suggestRule([]);
    expect(first).toEqual({ when: "weapon-down", act: "disengage" });
    const second = suggestRule([first]);
    expect(second.when).toBe("enemy-weapon-down");
    const all = RULE_CONDITIONS.map((when) => ({
      when,
      act: "hold" as const,
    }));
    expect(suggestRule(all).when).toBe("weapon-down");
  });
});
