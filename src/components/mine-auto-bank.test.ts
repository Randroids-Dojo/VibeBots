import { describe, expect, it } from "vitest";
import { type AutoBankInputs, autoBankDecision } from "./mine-auto-bank";

const CARVED_ARRIVAL: AutoBankInputs = {
  previousRow: 24,
  minerRow: 0,
  tripReportOpen: false,
  cashOutPending: false,
  worldLoaded: true,
  elevatorBoarded: false,
  movesLength: 40,
  bankedCredits: 0,
  bankedPartsCount: 0,
  pendingBunkerActive: false,
  carvedThisTrip: true,
};

describe("auto bank decision", () => {
  it("banks a carved trip that walked back to the surface", () => {
    expect(autoBankDecision(CARVED_ARRIVAL)).toBe("bank");
  });

  it("banks a surfaced haul even when the trip carved nothing", () => {
    expect(
      autoBankDecision({
        ...CARVED_ARRIVAL,
        carvedThisTrip: false,
        bankedCredits: 12,
      }),
    ).toBe("bank");
  });

  it("banks a restored trip sitting boarded at the surface", () => {
    expect(
      autoBankDecision({
        ...CARVED_ARRIVAL,
        previousRow: 0,
        elevatorBoarded: true,
      }),
    ).toBe("bank");
  });

  it("skips a restored elevator state with no recorded moves", () => {
    expect(
      autoBankDecision({
        ...CARVED_ARRIVAL,
        previousRow: 0,
        elevatorBoarded: true,
        movesLength: 0,
      }),
    ).toBe("skip");
  });

  it("skips a restored elevator state before the world has loaded", () => {
    expect(
      autoBankDecision({
        ...CARVED_ARRIVAL,
        previousRow: 0,
        elevatorBoarded: true,
        worldLoaded: false,
      }),
    ).toBe("skip");
  });

  it("banks a surfaced pending bunker even with nothing to sell", () => {
    expect(
      autoBankDecision({
        ...CARVED_ARRIVAL,
        carvedThisTrip: false,
        pendingBunkerActive: true,
      }),
    ).toBe("bank");
  });

  it("skips a trip that changed nothing and carries nothing", () => {
    expect(autoBankDecision({ ...CARVED_ARRIVAL, carvedThisTrip: false })).toBe(
      "skip",
    );
  });

  it("skips while a bank request is already in flight", () => {
    expect(autoBankDecision({ ...CARVED_ARRIVAL, cashOutPending: true })).toBe(
      "skip",
    );
  });

  it("skips while the miner is still underground", () => {
    expect(autoBankDecision({ ...CARVED_ARRIVAL, minerRow: 12 })).toBe("skip");
  });

  // The death teleport: the sim puts the miner at the surface the instant
  // the fall turns fatal, while the canvas still has seconds of fall to
  // play. Banking there resets the trip mid-playback and the bot gets
  // pulled back up out of its own fall, so the arrival must be HELD, not
  // consumed, and must still bank once the report is dismissed.
  it("holds the arrival while a trip report is on screen", () => {
    expect(autoBankDecision({ ...CARVED_ARRIVAL, tripReportOpen: true })).toBe(
      "hold",
    );
  });

  it("holds a death arrival even with nothing left to sell", () => {
    expect(
      autoBankDecision({
        ...CARVED_ARRIVAL,
        tripReportOpen: true,
        bankedCredits: 0,
        bankedPartsCount: 0,
      }),
    ).toBe("hold");
  });

  it("banks the held arrival once the report is dismissed", () => {
    // The caller keeps previousRow at the pre-death row across the hold,
    // so dismissing the report still reads as an arrival at the surface.
    const held = { ...CARVED_ARRIVAL, tripReportOpen: true };
    expect(autoBankDecision(held)).toBe("hold");
    expect(autoBankDecision({ ...held, tripReportOpen: false })).toBe("bank");
  });

  it("holds the report ahead of an in-flight bank", () => {
    // Ordering matters: a hold must not be downgraded to a consuming skip
    // by any later gate, or the arrival is lost and the trip never banks.
    expect(
      autoBankDecision({
        ...CARVED_ARRIVAL,
        tripReportOpen: true,
        cashOutPending: true,
      }),
    ).toBe("hold");
  });
});
