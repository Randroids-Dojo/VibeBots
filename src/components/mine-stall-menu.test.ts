import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createMine, DEFAULT_GEAR, STARTING_CONSUMABLES } from "@/sim/mine";
import { StallMenu } from "./mine-stall-menu";
import { STALLS } from "./mine-stalls";

type StallMenuProps = ComponentProps<typeof StallMenu>;

/** Shared happy-path props; each test overrides only what it exercises. */
function elevatorStallProps(
  overrides: Partial<StallMenuProps> = {},
): StallMenuProps {
  const gear = {
    ...DEFAULT_GEAR,
    elevator: 1,
    elevatorColumn: 7,
    ...(overrides.gear ?? {}),
  };
  return {
    stall: STALLS[0],
    mine: createMine(7125, gear, STARTING_CONSUMABLES),
    gear,
    balance: 10,
    playerLevel: 1,
    deepestDepth: 0,
    beaconLimit: 1,
    shopNote: null,
    cashOutPending: false,
    elevatorPurchasePending: false,
    elevatorPlacementRequired: false,
    railResyncFailed: false,
    railRetryPending: false,
    onRetryRailResync: vi.fn(),
    onBuyConsumable: vi.fn(),
    onBuyBasePart: vi.fn(),
    onBuyGear: vi.fn(),
    onBuyElevator: vi.fn(),
    onChooseElevatorShaft: vi.fn(),
    onRide: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("StallMenu elevator purchases", () => {
  it("counts surfaced haul toward an affordable rail", () => {
    const props = elevatorStallProps({ balance: 10 });
    props.mine.miner.bankedCredits = 20;

    const markup = renderToStaticMarkup(createElement(StallMenu, props));

    expect(markup).toContain('aria-label="Buy one elevator rail for 25 vibes"');
    expect(markup).toContain(">Bank + 25 vibes</button>");
    expect(markup).not.toMatch(/disabled=""[^>]*>Bank \+ 25 vibes<\/button>/);
  });

  it("offers the compatibility placement for free at any owned depth", () => {
    const props = elevatorStallProps({
      gear: { ...DEFAULT_GEAR, elevator: 999, elevatorColumn: -5 },
      balance: 0,
      elevatorPlacementRequired: true,
    });

    const markup = renderToStaticMarkup(createElement(StallMenu, props));

    expect(markup).toContain(
      'aria-label="Choose free elevator shaft location"',
    );
    expect(markup).toContain("one free location choice; bought depth stays");
    expect(markup).toContain(">Choose spot</button>");
    expect(markup).not.toMatch(/disabled=""[^>]*>Choose spot<\/button>/);
  });

  it("blocks the rail buy and offers a retry when a resync failed", () => {
    const props = elevatorStallProps({ railResyncFailed: true });

    const markup = renderToStaticMarkup(createElement(StallMenu, props));

    // The recovery affordance renders with an enabled retry control.
    expect(markup).toContain('data-testid="rail-resync-recovery"');
    expect(markup).toContain('aria-label="Retry refreshing the rail"');
    expect(markup).toContain(">Retry refresh</button>");
    // The buy control is disabled even though the haul would otherwise afford it
    // (aria-label renders before the boolean disabled attribute).
    expect(markup).toMatch(
      /aria-label="Buy one elevator rail for 25 vibes"[^>]*disabled=""/,
    );
  });

  it("keeps the rail buy live and hides the recovery box in the normal state", () => {
    const props = elevatorStallProps({ railResyncFailed: false });

    const markup = renderToStaticMarkup(createElement(StallMenu, props));

    expect(markup).not.toContain('data-testid="rail-resync-recovery"');
  });
});
