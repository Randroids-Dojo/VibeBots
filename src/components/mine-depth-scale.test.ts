import { describe, expect, it } from "vitest";
import { STRATA } from "@/sim/mine";
import {
  buildRibbonBands,
  buildRibbonMarkers,
  RIBBON_BAND_COLORS,
  rowToOffset,
} from "./mine-depth-scale";

const BOTTOM = 1000;
const BANDS = buildRibbonBands(STRATA, BOTTOM);

describe("buildRibbonBands", () => {
  it("gives every stratum an equal share of the ribbon", () => {
    const share = 1 / STRATA.length;
    for (const band of BANDS) {
      expect(band.end - band.start).toBeCloseTo(share);
    }
    expect(BANDS[0].start).toBe(0);
    expect(BANDS[BANDS.length - 1].end).toBeCloseTo(1);
  });

  it("chains each band's end row to the next band's start row", () => {
    for (let i = 0; i < BANDS.length - 1; i += 1) {
      expect(BANDS[i].endRow).toBe(BANDS[i + 1].startRow);
    }
    expect(BANDS[BANDS.length - 1].endRow).toBe(BOTTOM);
  });

  it("ships exactly one colour per stratum", () => {
    // Exact, not "at least": the ribbon indexes directly, so a stratum
    // added without a colour must fail here rather than render undefined.
    expect(RIBBON_BAND_COLORS.length).toBe(STRATA.length);
  });
});

describe("rowToOffset", () => {
  it("puts the surface at the top and the mine floor at the bottom", () => {
    expect(rowToOffset(BANDS, 0)).toBe(0);
    expect(rowToOffset(BANDS, BOTTOM)).toBe(1);
  });

  it("clamps rows outside the mine instead of running off the ribbon", () => {
    expect(rowToOffset(BANDS, -20)).toBe(0);
    expect(rowToOffset(BANDS, BOTTOM + 500)).toBe(1);
  });

  it("increases monotonically with depth", () => {
    let previous = -1;
    for (let row = 0; row <= BOTTOM; row += 7) {
      const offset = rowToOffset(BANDS, row);
      expect(offset).toBeGreaterThanOrEqual(previous);
      previous = offset;
    }
  });

  it("keeps the shallow strata readable rather than a hairline", () => {
    // The whole point of the segmented scale: Topsoil is 12 of 1000 rows,
    // about 1.2% of a linear ribbon, but gets a full band here.
    const topsoilShare = rowToOffset(BANDS, 12) - rowToOffset(BANDS, 0);
    expect(topsoilShare).toBeCloseTo(1 / STRATA.length);
    expect(topsoilShare).toBeGreaterThan(0.05);
  });

  it("interpolates inside a band so progress through a stratum shows", () => {
    const clay = BANDS[1];
    const middleRow = (clay.startRow + clay.endRow) / 2;
    const offset = rowToOffset(BANDS, middleRow);
    expect(offset).toBeCloseTo((clay.start + clay.end) / 2);
  });
});

describe("buildRibbonMarkers", () => {
  const base = {
    minerRow: 30,
    deepestRow: 30,
    beaconRows: [] as number[],
    elevatorBottomRow: 0,
    cargoRow: null,
  };

  it("always marks base, and always draws the miner last", () => {
    const markers = buildRibbonMarkers(BANDS, base);
    expect(markers.some((m) => m.kind === "base")).toBe(true);
    expect(markers[markers.length - 1].kind).toBe("miner");
  });

  it("marks beacons, the elevator, and dropped cargo when they exist", () => {
    const markers = buildRibbonMarkers(BANDS, {
      ...base,
      beaconRows: [8, 44],
      elevatorBottomRow: 20,
      cargoRow: 51,
    });
    const kinds = markers.map((m) => m.kind);
    expect(kinds.filter((k) => k === "beacon")).toHaveLength(2);
    expect(kinds).toContain("elevator");
    expect(kinds).toContain("cargo");
  });

  it("omits the elevator and cargo markers when there are none", () => {
    const kinds = buildRibbonMarkers(BANDS, base).map((m) => m.kind);
    expect(kinds).not.toContain("elevator");
    expect(kinds).not.toContain("cargo");
  });

  it("only marks the deepest depth when it is below the miner", () => {
    expect(
      buildRibbonMarkers(BANDS, base).some((m) => m.kind === "deepest"),
    ).toBe(false);
    expect(
      buildRibbonMarkers(BANDS, { ...base, deepestRow: 90 }).some(
        (m) => m.kind === "deepest",
      ),
    ).toBe(true);
  });

  it("places every marker inside the ribbon", () => {
    const markers = buildRibbonMarkers(BANDS, {
      minerRow: 999,
      deepestRow: 1200,
      beaconRows: [0, 500],
      elevatorBottomRow: 3,
      cargoRow: 1000,
    });
    for (const marker of markers) {
      expect(marker.offset).toBeGreaterThanOrEqual(0);
      expect(marker.offset).toBeLessThanOrEqual(1);
    }
  });
});
