import { describe, expect, it } from "vitest";
import {
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
});
