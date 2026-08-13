import { DT } from "@/sim/constants";

/**
 * Shared chrome for the workshop panels.
 *
 * The bench, teardown, inspection, balance, and gearing panels each grew
 * their own copy of the same pill button and the same status palette, and
 * they had already drifted apart on padding and on whether a selected pill
 * changes its border. One definition means a palette change is one edit and
 * the controls stay siblings.
 */

export const panelStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.92)",
  border: "1px solid #26304a",
  borderRadius: 10,
  padding: 14,
};

/** Good, bad, and needs-attention. Used for text and for meter fills. */
export const STATUS = {
  good: "#54e0c7",
  bad: "#ff6b6b",
  warn: "#ffd166",
} as const;

export interface PillOptions {
  /** Renders as chosen: filled, with a bright border. */
  selected?: boolean;
  /** Not actionable right now. */
  disabled?: boolean;
  /** Roomier, for standalone actions rather than a row of choices. */
  large?: boolean;
  /** Positive-action fill (the bench Run button). */
  primary?: boolean;
}

/** The one pill button the workshop panels share. */
export function pillStyle({
  selected = false,
  disabled = false,
  large = false,
  primary = false,
}: PillOptions = {}): React.CSSProperties {
  return {
    background: selected || primary ? "#2f7d6b" : "#26304a",
    color: "#e6e8ee",
    border: `1px solid ${selected ? STATUS.good : "#344061"}`,
    borderRadius: 8,
    padding: large ? "8px 16px" : "4px 10px",
    fontSize: large ? "0.8rem" : "0.72rem",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

/** Sim ticks as display seconds. One tick-to-time contract for every panel. */
export function secondsFromTicks(ticks: number): string {
  return `${(ticks * DT).toFixed(1)}s`;
}
