"use client";

import { useMemo } from "react";
import { isTippy, tipOverDegrees } from "@/lib/bot-balance";
import { computeBalance } from "@/sim/balance";
import type { BotDesign } from "@/sim/design";
import { useWorkshopStore } from "@/state/workshop-store";
import { pillStyle, STATUS } from "./workshop-ui";

/**
 * The balance numbers a builder actually decides on: where the mass sits,
 * what carries it, and how far it can lean before it goes over. DOM text so
 * the exact figures are readable (Rule 10 keeps numbers out of the canvas);
 * the matching marker and footprint outline live on the bench behind the
 * same toggle.
 */

/** Off-centre by more than this reads as a real bias, not float noise. */
const OFFSET_EPSILON = 0.02;

function centimetres(metres: number): string {
  return `${Math.round(metres * 100)}cm`;
}

export function BalanceReadout({
  design,
  panelStyle,
}: {
  design: BotDesign;
  panelStyle: React.CSSProperties;
}) {
  const balanceVisible = useWorkshopStore((s) => s.balanceVisible);
  const toggleBalance = useWorkshopStore((s) => s.toggleBalance);
  const balance = useMemo(() => computeBalance(design), [design]);

  const lean = Math.round(tipOverDegrees(balance));
  const tippy = isTippy(balance);
  const forward = -balance.centerOfMass.z;
  const sideways = balance.centerOfMass.x;

  return (
    <section style={panelStyle} aria-label="Balance">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <h2 style={{ margin: 0, fontSize: "0.95rem" }}>Balance</h2>
        <button
          type="button"
          data-testid="toggle-balance"
          aria-pressed={balanceVisible}
          onClick={toggleBalance}
          style={pillStyle({ selected: balanceVisible })}
        >
          {balanceVisible ? "Hide on bench" : "Show on bench"}
        </button>
      </div>

      <p
        data-testid="balance-tipover"
        style={{
          margin: 0,
          fontSize: "0.8rem",
          color: balance.balanced
            ? tippy
              ? STATUS.warn
              : STATUS.good
            : STATUS.bad,
        }}
      >
        {balance.balanced
          ? `Leans ${lean} degrees before it goes over`
          : "Mass sits outside the footprint: this bot falls over"}
      </p>

      <p style={{ margin: "4px 0 0", fontSize: "0.75rem", opacity: 0.85 }}>
        Mass {balance.totalMass.toFixed(2)}, centre{" "}
        {centimetres(balance.centerOfMassHeight)} up
        {Math.abs(forward) > OFFSET_EPSILON
          ? `, ${centimetres(Math.abs(forward))} ${forward > 0 ? "forward" : "back"}`
          : ", centred fore and aft"}
        {Math.abs(sideways) > OFFSET_EPSILON
          ? `, ${centimetres(Math.abs(sideways))} to the ${sideways > 0 ? "right" : "left"}`
          : ""}
        .
      </p>

      <p style={{ margin: "4px 0 0", fontSize: "0.72rem", opacity: 0.7 }}>
        {balance.supportingIids.length > 0
          ? `Standing on ${balance.supportingIids.length} part${balance.supportingIids.length === 1 ? "" : "s"}, margin ${centimetres(Math.abs(balance.stabilityMargin))}${balance.balanced ? "" : " outside"}.`
          : "Nothing reaches the floor."}
      </p>

      {tippy && balance.balanced && (
        <p
          style={{ margin: "4px 0 0", fontSize: "0.72rem", color: STATUS.warn }}
        >
          Top-heavy. Move mass down or widen what touches the floor.
        </p>
      )}
    </section>
  );
}
