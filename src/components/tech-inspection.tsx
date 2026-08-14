"use client";

import { useMemo } from "react";
import type { BotDesign } from "@/sim/design";
import { inspectDesign } from "@/sim/inspection";
import { WEIGHT_CLASSES } from "@/sim/weight-classes";

/**
 * The pre-fight tech inspection. Validity used to be a paragraph of error
 * strings, which reads as a compiler complaining. A real event inspects a
 * machine rule by rule and tells you which one you failed, so this shows a
 * checklist: every rule with a pass or fail and one line of detail, which
 * localizes the fault instead of dumping everything at once.
 *
 * The class picker is the other half: it gives the mass budget something to
 * push against, so armour finally costs something.
 */

export function TechInspection({
  design,
  panelStyle,
  onSelectClass,
}: {
  design: BotDesign;
  panelStyle?: React.CSSProperties;
  onSelectClass: (classId: string | undefined) => void;
}) {
  const inspection = useMemo(() => inspectDesign(design), [design]);

  return (
    <section style={panelStyle} aria-label="Tech inspection">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: "0.95rem" }}>Tech inspection</h2>
        <span
          data-testid="inspection-verdict"
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: inspection.passed ? "#54e0c7" : "#ff6b6b",
          }}
        >
          {inspection.passed ? "Passed" : "Failed"}
        </span>
      </div>

      <ul style={{ margin: "0 0 10px", padding: 0, listStyle: "none" }}>
        {inspection.items.map((item) => (
          <li
            key={item.id}
            data-testid="inspection-item"
            data-item-id={item.id}
            data-passed={item.passed ? "true" : "false"}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "baseline",
              padding: "3px 0",
              fontSize: "0.75rem",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: item.passed ? "#54e0c7" : "#ff6b6b",
                fontWeight: 700,
                width: 12,
              }}
            >
              {item.passed ? "✓" : "✗"}
            </span>
            <span style={{ minWidth: 84 }}>{item.label}</span>
            <span style={{ opacity: 0.75, flex: 1 }}>
              {item.detail}
              {item.messages.length > 1
                ? ` (+${item.messages.length - 1} more)`
                : ""}
            </span>
          </li>
        ))}
      </ul>

      <fieldset
        style={{
          border: "1px solid #26304a",
          borderRadius: 8,
          padding: "6px 8px 8px",
          margin: 0,
        }}
      >
        <legend
          style={{ fontSize: "0.72rem", opacity: 0.75, padding: "0 4px" }}
        >
          Weight class
        </legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            data-testid="weight-class-option"
            aria-pressed={design.weightClass === undefined}
            onClick={() => onSelectClass(undefined)}
            style={{
              background:
                design.weightClass === undefined ? "#2f7d6b" : "#26304a",
              color: "#e6e8ee",
              border: "1px solid #344061",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: "0.72rem",
              cursor: "pointer",
            }}
          >
            Unclassed
          </button>
          {WEIGHT_CLASSES.map((entry) => {
            const selected = design.weightClass === entry.id;
            const wouldFit = inspection.mass <= entry.maxMass;
            return (
              <button
                key={entry.id}
                type="button"
                data-testid="weight-class-option"
                data-class-id={entry.id}
                aria-pressed={selected}
                title={entry.blurb}
                onClick={() => onSelectClass(entry.id)}
                style={{
                  background: selected ? "#2f7d6b" : "#26304a",
                  color: wouldFit ? "#e6e8ee" : "#9aa3b8",
                  border: `1px solid ${selected ? "#54e0c7" : "#344061"}`,
                  borderRadius: 8,
                  padding: "4px 10px",
                  fontSize: "0.72rem",
                  cursor: "pointer",
                }}
              >
                {entry.name}
                <span style={{ opacity: 0.6 }}>
                  {" "}
                  {entry.maxMass.toFixed(1)}
                </span>
              </button>
            );
          })}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: "0.7rem", opacity: 0.7 }}>
          {inspection.declaredClass
            ? inspection.declaredClass.blurb
            : inspection.fitsClass
              ? `Currently ${inspection.mass.toFixed(2)}. Declare a class to hold yourself to it.`
              : `Currently ${inspection.mass.toFixed(2)}, heavier than every class.`}
        </p>
      </fieldset>
    </section>
  );
}
