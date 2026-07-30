/**
 * Depth as a place, not a sentence.
 *
 * "Depth 12 Clay Beds | Base -2" packed four values into one chip and
 * rendered the stratum name, the actual progression signal, at 65%
 * opacity as an aside. Position data belongs on a map
 * (docs/research/mine-hud-redesign-2026-07.html section 4.2), so the
 * chip becomes a left-edge ribbon: one band per stratum, with the miner
 * and everything worth walking back to marked on it.
 *
 * The scale is deliberately NOT linear in rows. The strata run 0 to 1000
 * with wildly uneven spans (Topsoil is 12 rows, Sunken Circuit is 200),
 * so a linear scale would compress the entire early game into a hairline.
 * Each stratum instead gets an equal share of the ribbon and rows
 * interpolate inside their own band, which keeps "how far into this
 * stratum am I" readable at every depth.
 *
 * Pure: no react, no three, no store.
 */

export type RibbonStratum = {
  name: string;
  startRow: number;
};

export type RibbonBand = {
  name: string;
  startRow: number;
  /** First row of the next stratum, or the mine floor for the last one. */
  endRow: number;
  /** 0..1 from the surface, the band's top edge. */
  start: number;
  /** 0..1 from the surface, the band's bottom edge. */
  end: number;
};

export type RibbonMarkerKind =
  | "miner"
  | "base"
  | "beacon"
  | "elevator"
  | "cargo"
  | "deepest";

export type RibbonMarker = {
  kind: RibbonMarkerKind;
  row: number;
  /** 0..1 position along the ribbon. */
  offset: number;
};

/** Band tints, surface to core. Warm topsoil down to hot mantle. */
export const RIBBON_BAND_COLORS: readonly string[] = [
  "#6f8f4a",
  "#9a6b3f",
  "#7d7f88",
  "#3f8f86",
  "#a44a2f",
  "#6b5b52",
  "#2f3340",
  "#54407a",
  "#8a4f8f",
  "#3f7fa8",
  "#9a8040",
  "#c0562f",
  "#3f9a72",
  "#c9a227",
];

export function buildRibbonBands(
  strata: readonly RibbonStratum[],
  bottomRow: number,
): RibbonBand[] {
  const share = 1 / strata.length;
  return strata.map((stratum, index) => {
    const next = strata[index + 1];
    return {
      name: stratum.name,
      startRow: stratum.startRow,
      endRow: next ? next.startRow : bottomRow,
      start: index * share,
      end: (index + 1) * share,
    };
  });
}

/**
 * Row to a 0..1 offset down the ribbon. Rows above the surface clamp to
 * the top, rows past the floor clamp to the bottom.
 */
export function rowToOffset(bands: readonly RibbonBand[], row: number): number {
  if (bands.length === 0) return 0;
  if (row <= 0) return 0;
  const last = bands[bands.length - 1];
  if (row >= last.endRow) return 1;
  for (const band of bands) {
    if (row < band.endRow) {
      const span = band.endRow - band.startRow;
      const within = span <= 0 ? 0 : (row - band.startRow) / span;
      return band.start + within * (band.end - band.start);
    }
  }
  return 1;
}

export function bandAtRow(
  bands: readonly RibbonBand[],
  row: number,
): RibbonBand | null {
  if (bands.length === 0) return null;
  let current = bands[0];
  for (const band of bands) {
    if (row >= band.startRow) current = band;
  }
  return current;
}

export type RibbonMarkerInput = {
  minerRow: number;
  deepestRow: number;
  beaconRows: readonly number[];
  elevatorBottomRow: number;
  cargoRow: number | null;
};

/**
 * Every "somewhere worth walking back to" on one ribbon. This is what
 * retires the separate base-direction tab and the pulsing lost-cargo
 * chip: they were bespoke locators for the same class of information.
 */
export function buildRibbonMarkers(
  bands: readonly RibbonBand[],
  input: RibbonMarkerInput,
): RibbonMarker[] {
  const markers: RibbonMarker[] = [{ kind: "base", row: 0, offset: 0 }];
  if (input.elevatorBottomRow > 0) {
    markers.push({
      kind: "elevator",
      row: input.elevatorBottomRow,
      offset: rowToOffset(bands, input.elevatorBottomRow),
    });
  }
  for (const row of input.beaconRows) {
    markers.push({ kind: "beacon", row, offset: rowToOffset(bands, row) });
  }
  if (input.cargoRow !== null) {
    markers.push({
      kind: "cargo",
      row: input.cargoRow,
      offset: rowToOffset(bands, input.cargoRow),
    });
  }
  if (input.deepestRow > input.minerRow) {
    markers.push({
      kind: "deepest",
      row: input.deepestRow,
      offset: rowToOffset(bands, input.deepestRow),
    });
  }
  // The miner draws last so it sits on top of anything it shares a row with.
  markers.push({
    kind: "miner",
    row: input.minerRow,
    offset: rowToOffset(bands, input.minerRow),
  });
  return markers;
}
