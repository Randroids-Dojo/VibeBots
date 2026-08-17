import { describe, expect, it } from "vitest";
import {
  ELEVATOR_CALL_SECONDS,
  elevatorCallSeconds,
  elevatorCallStartY,
  elevatorStageLabel,
  initialElevatorPresentation,
} from "./mine-elevator-presentation";

describe("mine elevator presentation", () => {
  it("starts idle with the car at the supplied row", () => {
    expect(initialElevatorPresentation(14)).toEqual({
      sequence: 0,
      stage: "idle",
      carRow: 14,
      entryDirection: null,
    });
  });

  it("labels every visible interaction stage", () => {
    expect(elevatorStageLabel("idle", null)).toBeNull();
    expect(elevatorStageLabel("calling", null)).toBe("Elevator coming");
    expect(elevatorStageLabel("boarding", null)).toBe("Boarding elevator");
    expect(elevatorStageLabel("choosing", null)).toBe("Choose top or bottom");
    expect(elevatorStageLabel("riding", "ride-up")).toBe(
      "Going to the surface",
    );
    expect(elevatorStageLabel("riding", "ride-down")).toBe(
      "Going to the bottom",
    );
    expect(elevatorStageLabel("riding", null)).toBe("Elevator moving");
  });

  it("starts a call from wherever the car rests", () => {
    // Car parked three rows below the boarding row: it rises from there.
    expect(elevatorCallStartY(-3, 0, 8, 10)).toBe(-3);
    // Car above a deep boarding row: it descends from there.
    expect(elevatorCallStartY(-2, -6, 8, 10)).toBe(-2);
  });

  it("clamps a far-off car to the visible window edge", () => {
    // Parked 40 rows below with 10 visible rows below: start 9 under.
    expect(elevatorCallStartY(-40, 0, 8, 10)).toBe(-9);
    // Parked at the surface with the player 40 deep and 8 visible rows
    // above: start 7 over.
    expect(elevatorCallStartY(0, -40, 8, 10)).toBe(-33);
    // Degenerate window still leaves one row of approach.
    expect(elevatorCallStartY(-40, 0, 8, 1)).toBe(-1);
  });

  it("skips the travel when the car is already at the boarding row", () => {
    expect(elevatorCallSeconds(0, 0, ELEVATOR_CALL_SECONDS)).toBe(0);
    expect(elevatorCallSeconds(-6.05, -6, ELEVATOR_CALL_SECONDS)).toBe(0);
    expect(elevatorCallSeconds(-3, 0, ELEVATOR_CALL_SECONDS)).toBe(
      ELEVATOR_CALL_SECONDS,
    );
  });
});
