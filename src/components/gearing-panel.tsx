"use client";

import { useMemo } from "react";
import {
  type BotDesign,
  DEFAULT_GEAR_RATIO,
  GEAR_RATIO_PRESETS,
  gearPowerDraw,
  isGearableConnection,
  validateDesign,
} from "@/sim/design";
import { useWorkshopStore } from "@/state/workshop-store";
import { pillStyle } from "./workshop-ui";

/**
 * Drive gearing (F-229). A part's whole electrical story used to be one
 * powerDraw number, which is a videogame stat rather than an engineering
 * one. A reduction ratio is a trade a mechanic already understands: slower
 * shaft, more torque, and it costs power off the core budget, so torque
 * competes with the weapon instead of being free.
 */

/**
 * Display copy for each buildable ratio. The ratios themselves are balance
 * data and live in the sim (GEAR_RATIO_PRESETS); this only names them.
 */
const GEAR_COPY: Record<string, { label: string; note: string }> = {
  "0.7": { label: "Speed", note: "Faster shaft, less bite" },
  "1": { label: "Stock", note: "Direct drive" },
  "1.6": { label: "Torque", note: "Slower, shoves harder" },
  "2.2": { label: "Crawler", note: "Maximum push, costly" },
};

/**
 * The ratio currently on the drive axles, or null when they disagree or
 * there are none. Asks the sim which connections are gearable rather than
 * re-deriving it, so the readout can never disagree with what the setter
 * writes or what validation accepts.
 */
function currentRatio(design: BotDesign): number | null {
  const ratios: number[] = [];
  for (const conn of design.connections) {
    if (!isGearableConnection(design, conn)) continue;
    ratios.push(conn.gearRatio ?? DEFAULT_GEAR_RATIO);
  }
  if (ratios.length === 0) return null;
  return ratios.every((ratio) => ratio === ratios[0]) ? ratios[0] : null;
}

export function GearingPanel({
  design,
  panelStyle,
}: {
  design: BotDesign;
  panelStyle: React.CSSProperties;
}) {
  const setGearRatio = useWorkshopStore((s) => s.setGearRatio);
  const active = useMemo(() => currentRatio(design), [design]);
  const validation = useMemo(() => validateDesign(design), [design]);
  const supply = validation.ok ? validation.stats.powerSupply : null;
  const draw = validation.ok ? validation.stats.powerDraw : null;
  const hasDrive = active !== null || design.connections.length > 0;

  return (
    <section style={panelStyle} aria-label="Drive gearing">
      <h2 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>Drive gearing</h2>
      <p style={{ margin: "0 0 8px", fontSize: "0.72rem", opacity: 0.8 }}>
        Gears every drive axle at once.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {GEAR_RATIO_PRESETS.map((ratio) => {
          const option = { ratio, ...GEAR_COPY[String(ratio)] };
          const selected = active === option.ratio;
          const cost = gearPowerDraw(option.ratio);
          return (
            <button
              key={option.ratio}
              type="button"
              data-testid="gear-option"
              data-ratio={String(option.ratio)}
              aria-pressed={selected}
              title={option.note}
              disabled={!hasDrive}
              onClick={() => setGearRatio(option.ratio)}
              style={pillStyle({ selected, disabled: !hasDrive })}
            >
              {option.label}
              <span style={{ opacity: 0.6 }}>
                {" "}
                {option.ratio.toFixed(1)}
                {cost > 0 ? ` +${cost}W` : ""}
              </span>
            </button>
          );
        })}
      </div>

      <p
        data-testid="gearing-summary"
        style={{ margin: "8px 0 0", fontSize: "0.72rem", opacity: 0.8 }}
      >
        {active === null
          ? design.connections.length === 0
            ? "Add drive wheels to gear them."
            : "Axles are geared differently. Pick one to make them match."
          : `Ratio ${active.toFixed(1)}${
              draw !== null && supply !== null
                ? `, power ${draw}/${supply}`
                : ""
            }.`}
      </p>
    </section>
  );
}
