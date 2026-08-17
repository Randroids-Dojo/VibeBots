import type { Direction } from "@/sim/mine";

export type ElevatorPresentationStage =
  | "idle"
  | "calling"
  | "boarding"
  | "choosing"
  | "riding";

export type ElevatorRideAction = "ride-down" | "ride-up";

export interface ElevatorPresentation {
  sequence: number;
  stage: ElevatorPresentationStage;
  carRow: number;
  entryDirection: Direction | null;
}

export const ELEVATOR_CALL_SECONDS = 0.9;
export const ELEVATOR_BOARD_SECONDS = 0.56;

/** Within this many rows of the boarding row, the car counts as already
 * there and a call plays no travel at all. */
export const ELEVATOR_CAR_AT_ROW_EPSILON = 0.12;

/**
 * Where the called car starts its approach. The car travels from wherever
 * it actually rests; a car parked beyond the visible render window starts
 * from just inside the window's edge so the approach stays on screen
 * instead of running for dozens of rows.
 */
export function elevatorCallStartY(
  carY: number,
  targetY: number,
  windowAbove: number,
  windowBelow: number,
): number {
  const visibleLimit = Math.max(
    1,
    (carY < targetY ? windowBelow : windowAbove) - 1,
  );
  if (targetY - carY > visibleLimit) return targetY - visibleLimit;
  if (carY - targetY > visibleLimit) return targetY + visibleLimit;
  return carY;
}

/**
 * How long the called car travels. A car already resting at the boarding
 * row arrives instantly: no fake one-row dip and rise (the pre-fix
 * behavior players read as the elevator leaving and coming back).
 */
export function elevatorCallSeconds(
  startY: number,
  targetY: number,
  travelSeconds: number,
): number {
  return Math.abs(startY - targetY) < ELEVATOR_CAR_AT_ROW_EPSILON
    ? 0
    : travelSeconds;
}

export function initialElevatorPresentation(
  carRow: number,
): ElevatorPresentation {
  return {
    sequence: 0,
    stage: "idle",
    carRow,
    entryDirection: null,
  };
}

export function elevatorStageLabel(
  stage: ElevatorPresentationStage,
  ride: ElevatorRideAction | null,
): string | null {
  if (stage === "calling") return "Elevator coming";
  if (stage === "boarding") return "Boarding elevator";
  if (stage === "choosing") return "Choose top or bottom";
  if (stage === "riding") {
    if (ride === "ride-up") return "Going to the surface";
    if (ride === "ride-down") return "Going to the bottom";
    return "Elevator moving";
  }
  return null;
}
