import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createMine, DEFAULT_GEAR, STARTING_CONSUMABLES } from "@/sim/mine";
import { StallMenu } from "./mine-stall-menu";
import { STALLS } from "./mine-stalls";

describe("StallMenu elevator purchases", () => {
  it("counts surfaced haul toward an affordable rail", () => {
    const gear = {
      ...DEFAULT_GEAR,
      elevator: 1,
      elevatorColumn: 7,
    };
    const mine = createMine(7125, gear, STARTING_CONSUMABLES);
    mine.miner.bankedCredits = 20;

    const markup = renderToStaticMarkup(
      createElement(StallMenu, {
        stall: STALLS[0],
        mine,
        gear,
        balance: 10,
        playerLevel: 1,
        deepestDepth: 0,
        beaconLimit: 1,
        shopNote: null,
        cashOutPending: false,
        elevatorPurchasePending: false,
        elevatorPlacementRequired: false,
        onBuyConsumable: vi.fn(),
        onBuyBasePart: vi.fn(),
        onBuyGear: vi.fn(),
        onBuyElevator: vi.fn(),
        onChooseElevatorShaft: vi.fn(),
        onRide: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="Buy one elevator rail for 25 vibes"');
    expect(markup).toContain(">Bank + 25 vibes</button>");
    expect(markup).not.toMatch(/disabled=""[^>]*>Bank \+ 25 vibes<\/button>/);
  });

  it("offers the compatibility placement for free at any owned depth", () => {
    const gear = {
      ...DEFAULT_GEAR,
      elevator: 999,
      elevatorColumn: -5,
    };
    const mine = createMine(7125, gear, STARTING_CONSUMABLES);

    const markup = renderToStaticMarkup(
      createElement(StallMenu, {
        stall: STALLS[0],
        mine,
        gear,
        balance: 0,
        playerLevel: 1,
        deepestDepth: 0,
        beaconLimit: 1,
        shopNote: null,
        cashOutPending: false,
        elevatorPurchasePending: false,
        elevatorPlacementRequired: true,
        onBuyConsumable: vi.fn(),
        onBuyBasePart: vi.fn(),
        onBuyGear: vi.fn(),
        onBuyElevator: vi.fn(),
        onChooseElevatorShaft: vi.fn(),
        onRide: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain(
      'aria-label="Choose free elevator shaft location"',
    );
    expect(markup).toContain("one free location choice; bought depth stays");
    expect(markup).toContain(">Choose spot</button>");
    expect(markup).not.toMatch(/disabled=""[^>]*>Choose spot<\/button>/);
  });
});
