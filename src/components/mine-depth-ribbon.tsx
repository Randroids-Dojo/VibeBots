"use client";

import { useState } from "react";
import { MINE_BOTTOM_ROW, STRATA } from "@/sim/mine";
import {
  bandAtRow,
  buildRibbonBands,
  buildRibbonMarkers,
  RIBBON_BAND_COLORS,
  type RibbonMarkerKind,
} from "./mine-depth-scale";
import {
  HUD_ACCENT,
  HUD_BORDER,
  HUD_GOLD,
  HUD_RADIUS_PILL,
  HUD_SURFACE_SOLID,
  HUD_TEXT,
} from "./mine-hud-tokens";

const BANDS = buildRibbonBands(STRATA, MINE_BOTTOM_ROW);

const MARKER_STYLES: Record<
  RibbonMarkerKind,
  { color: string; size: number; z: number }
> = {
  base: { color: HUD_TEXT, size: 8, z: 1 },
  elevator: { color: "#9aa7ff", size: 7, z: 2 },
  beacon: { color: "#7dd3fc", size: 7, z: 3 },
  deepest: { color: "rgba(230, 232, 238, 0.5)", size: 6, z: 2 },
  cargo: { color: HUD_GOLD, size: 9, z: 4 },
  miner: { color: HUD_ACCENT, size: 12, z: 5 },
};

const MARKER_LABELS: Record<RibbonMarkerKind, string> = {
  base: "Base",
  elevator: "Elevator bottom",
  beacon: "Beacon",
  deepest: "Deepest so far",
  cargo: "Dropped cargo",
  miner: "You",
};

/**
 * Left-edge depth gauge. Replaces the depth chip, the base-direction tab,
 * and the lost-cargo locator with one spatial widget: strata as stacked
 * bands, and every place worth walking back to as a marker on the same
 * scale.
 *
 * Per the 2026-07-30 design call the exact row is NOT drawn permanently.
 * Tapping the ribbon reveals it, so the persistent read is the band and
 * the position, and the number stays one tap away.
 */
export function MineDepthRibbon({
  minerRow,
  deepestRow,
  beaconRows,
  elevatorBottomRow,
  cargoRow,
}: {
  minerRow: number;
  deepestRow: number;
  beaconRows: readonly number[];
  elevatorBottomRow: number;
  cargoRow: number | null;
}) {
  const [open, setOpen] = useState(false);
  const markers = buildRibbonMarkers(BANDS, {
    minerRow,
    deepestRow,
    beaconRows,
    elevatorBottomRow,
    cargoRow,
  });
  const band = bandAtRow(BANDS, minerRow);

  return (
    <div
      data-depth-ribbon="true"
      data-depth-row={minerRow}
      data-depth-stratum={band?.name ?? ""}
      data-depth-open={open ? "true" : "false"}
      style={{
        position: "absolute",
        left: 12,
        top: "26%",
        height: "48%",
        display: "flex",
        alignItems: "stretch",
        gap: 8,
        zIndex: 6,
        pointerEvents: "none",
      }}
    >
      <button
        type="button"
        aria-label={
          band
            ? `Depth ${minerRow}, ${band.name}. Tap for the exact depth.`
            : `Depth ${minerRow}`
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          position: "relative",
          width: 12,
          height: "100%",
          padding: 0,
          borderRadius: HUD_RADIUS_PILL,
          border: `1px solid ${HUD_BORDER}`,
          background: HUD_SURFACE_SOLID,
          overflow: "hidden",
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        {BANDS.map((entry, index) => (
          <span
            key={entry.name}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${entry.start * 100}%`,
              height: `${(entry.end - entry.start) * 100}%`,
              background: RIBBON_BAND_COLORS[index % RIBBON_BAND_COLORS.length],
              opacity: minerRow >= entry.startRow ? 0.92 : 0.3,
            }}
          />
        ))}
      </button>

      {/* Markers ride outside the track so they stay legible at 12px. */}
      <div
        aria-hidden="true"
        style={{ position: "relative", width: 0, height: "100%" }}
      >
        {markers.map((marker) => {
          const style = MARKER_STYLES[marker.kind];
          return (
            <span
              key={`${marker.kind}-${marker.row}`}
              data-ribbon-marker={marker.kind}
              title={`${MARKER_LABELS[marker.kind]}: depth ${marker.row}`}
              style={{
                position: "absolute",
                left: -18,
                top: `${marker.offset * 100}%`,
                width: style.size,
                height: style.size,
                marginTop: -style.size / 2,
                borderRadius: marker.kind === "miner" ? HUD_RADIUS_PILL : 2,
                background: style.color,
                zIndex: style.z,
                boxShadow:
                  marker.kind === "miner"
                    ? "0 0 10px rgba(84, 224, 199, 0.65)"
                    : undefined,
              }}
            />
          );
        })}
      </div>

      {open && (
        <div
          role="status"
          data-depth-readout="true"
          style={{
            alignSelf: "flex-start",
            marginTop: `calc(${markers[markers.length - 1].offset * 100}% - 14px)`,
            padding: "4px 10px",
            borderRadius: HUD_RADIUS_PILL,
            border: `1px solid ${HUD_BORDER}`,
            background: HUD_SURFACE_SOLID,
            color: HUD_TEXT,
            fontSize: "0.8rem",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          Depth {minerRow}
          {band ? ` · ${band.name}` : ""}
        </div>
      )}
    </div>
  );
}
