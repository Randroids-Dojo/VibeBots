"use client";

import { useEffect, useState } from "react";
import {
  HOLODECK_SCENARIOS,
  type HolodeckSettings,
  holodeckScenario,
} from "@/sim/holodeck";
import { DEFAULT_GEAR } from "@/sim/mine";
import { useHolodeckStore } from "@/state/holodeck-store";
import { BackToMine } from "./back-to-mine";
import { HolodeckStage } from "./holodeck-stage";
import { actionRepeatMs } from "./mine-pacing";

const PANEL_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  zIndex: 10,
  width: 240,
  maxWidth: "calc(100vw - 28px)",
  padding: "14px 16px",
  borderRadius: 16,
  border: "1px solid rgba(84, 224, 199, 0.4)",
  background: "rgba(13, 17, 27, 0.92)",
  color: "#e7ecf5",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: "0.8rem",
  fontWeight: 600,
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid rgba(84, 224, 199, 0.35)",
  background: "rgba(38, 48, 74, 0.5)",
  color: "#e7ecf5",
  fontSize: "0.85rem",
};

export function HolodeckPanel() {
  const scenarioId = useHolodeckStore((s) => s.scenarioId);
  const settings = useHolodeckStore((s) => s.settings);
  const selectScenario = useHolodeckStore((s) => s.selectScenario);
  const updateSetting = useHolodeckStore((s) => s.updateSetting);
  const reset = useHolodeckStore((s) => s.reset);
  const driveStep = useHolodeckStore((s) => s.driveStep);

  const [paused, setPaused] = useState(false);
  const scenario = holodeckScenario(scenarioId);
  const intervalMs = actionRepeatMs({
    ...DEFAULT_GEAR,
    pickaxe: settings.pickaxe,
    battery: 10,
    lantern: 8,
  });

  // Auto-driver: step the loop on the mine action cadence. Re-armed when the
  // cadence (pickaxe) or pause state changes; cleared on unmount.
  useEffect(() => {
    if (paused) return;
    const id = setInterval(driveStep, intervalMs);
    return () => clearInterval(id);
  }, [driveStep, intervalMs, paused]);

  const apply = (key: keyof HolodeckSettings, value: number | string) =>
    updateSetting(key as never, value as never);

  return (
    <main style={{ position: "relative", width: "100vw", height: "100dvh" }}>
      <BackToMine />
      <HolodeckStage />
      <section style={PANEL_STYLE} aria-label="Holodeck controls">
        <header style={{ fontSize: "0.95rem", fontWeight: 700 }}>
          🛸 Holodeck
        </header>

        <label style={labelStyle}>
          Scenario
          <select
            aria-label="Scenario"
            value={scenarioId}
            onChange={(e) => selectScenario(e.target.value)}
            style={fieldStyle}
          >
            {HOLODECK_SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {s.name}
              </option>
            ))}
          </select>
        </label>

        <p style={{ margin: 0, fontSize: "0.74rem", opacity: 0.7 }}>
          {scenario.description}
        </p>

        {scenario.controls.map((control) => {
          const current = settings[control.key];
          if (control.kind === "range") {
            return (
              <label key={control.key} style={labelStyle}>
                {control.label}: {String(current)}
                <input
                  type="range"
                  aria-label={control.label}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={Number(current)}
                  onChange={(e) => apply(control.key, Number(e.target.value))}
                />
              </label>
            );
          }
          return (
            <label key={control.key} style={labelStyle}>
              {control.label}
              <select
                aria-label={control.label}
                value={String(current)}
                onChange={(e) => apply(control.key, e.target.value)}
                style={fieldStyle}
              >
                {control.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
            style={{ ...fieldStyle, cursor: "pointer", fontWeight: 700 }}
          >
            {paused ? "▶ Play" : "⏸ Pause"}
          </button>
          <button
            type="button"
            onClick={reset}
            style={{ ...fieldStyle, cursor: "pointer", fontWeight: 700 }}
          >
            ↻ Reset
          </button>
        </div>
      </section>
    </main>
  );
}
