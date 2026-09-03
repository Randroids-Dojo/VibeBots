"use client";

import type { CSSProperties } from "react";
import {
  type BotRule,
  MAX_DESIGN_RULES,
  RULE_ACTIONS,
  RULE_CONDITIONS,
  type RuleAction,
  type RuleCondition,
} from "@/sim/design";
import {
  RULE_ACTION_COPY,
  RULE_CONDITION_COPY,
  suggestRule,
} from "./bot-rules";

/**
 * Bench rules on the Tune tab (F-234, F-247): up to three "when X, then Y"
 * lines from fixed lists, no free text, checked in order every tick. The
 * first that holds decides the move; with none, the temperament drives.
 */
export function RulesPanel({
  rules,
  panelStyle,
  onChange,
}: {
  rules: readonly BotRule[];
  panelStyle: CSSProperties;
  onChange: (rules: readonly BotRule[]) => void;
}) {
  const selectStyle: CSSProperties = {
    fontSize: "0.78rem",
    padding: "4px 6px",
    borderRadius: 6,
    maxWidth: "100%",
  };
  return (
    <section style={panelStyle} aria-label="Rules">
      <h2 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>Rules</h2>
      <p style={{ margin: "0 0 8px", fontSize: "0.78rem", opacity: 0.7 }}>
        Up to three, checked in order every tick. The first that holds decides
        the move; with none, the temperament drives.
      </p>
      {rules.map((rule, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a rule has no identity beyond its slot (three lines at most), and re-mounting a row when one is removed is harmless
          key={`rule-${index}`}
          data-rule={index}
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 6,
            fontSize: "0.78rem",
          }}
        >
          <span>When</span>
          <select
            aria-label={`Rule ${index + 1} condition`}
            value={rule.when}
            style={selectStyle}
            onChange={(event) =>
              onChange(
                rules.map((r, i) =>
                  i === index
                    ? { ...r, when: event.target.value as RuleCondition }
                    : r,
                ),
              )
            }
          >
            {RULE_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {RULE_CONDITION_COPY[condition]}
              </option>
            ))}
          </select>
          <span>then</span>
          <select
            aria-label={`Rule ${index + 1} action`}
            value={rule.act}
            style={selectStyle}
            onChange={(event) =>
              onChange(
                rules.map((r, i) =>
                  i === index
                    ? { ...r, act: event.target.value as RuleAction }
                    : r,
                ),
              )
            }
          >
            {RULE_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {RULE_ACTION_COPY[action]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Remove rule ${index + 1}`}
            style={{ fontSize: "0.78rem" }}
            onClick={() => onChange(rules.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        style={{ fontSize: "0.78rem" }}
        disabled={rules.length >= MAX_DESIGN_RULES}
        onClick={() => onChange([...rules, suggestRule(rules)])}
      >
        {rules.length >= MAX_DESIGN_RULES
          ? "Three rules is the limit"
          : "Add rule"}
      </button>
    </section>
  );
}
