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
