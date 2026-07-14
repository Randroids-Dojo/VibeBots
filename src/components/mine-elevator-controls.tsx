"use client";

import { useEffect, useRef } from "react";
import {
  type ElevatorPresentationStage,
  type ElevatorRideAction,
  elevatorStageLabel,
} from "./mine-elevator-presentation";

export function MineElevatorControls({
  stage,
  ride,
  row,
  bottomRow,
  onRide,
}: {
  stage: ElevatorPresentationStage;
  ride: ElevatorRideAction | null;
  row: number;
  bottomRow: number;
  onRide: (ride: ElevatorRideAction) => void;
}) {
  const upRef = useRef<HTMLButtonElement | null>(null);
  const downRef = useRef<HTMLButtonElement | null>(null);
  const canGoUp = row > 0;
  const canGoDown = row < bottomRow;

  useEffect(() => {
    if (stage !== "choosing") return;
    const frame = requestAnimationFrame(() => {
      if (canGoUp) upRef.current?.focus();
      else if (canGoDown) downRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [canGoDown, canGoUp, stage]);

  if (stage === "idle") return null;
  const label = elevatorStageLabel(stage, ride);

  return (
    <div
      className="mine-elevator-controls"
      data-testid="elevator-controls"
      data-stage={stage}
    >
      <div className="mine-elevator-status" role="status" aria-live="polite">
        {label}
      </div>
      {stage === "choosing" && (
        <fieldset aria-label="Choose elevator destination">
          <legend>Choose destination</legend>
          {canGoUp && (
            <button
              ref={upRef}
              type="button"
              aria-label="Go to top"
              onClick={() => onRide("ride-up")}
            >
              <span aria-hidden="true">&#9650;</span>
              <span>Top</span>
            </button>
          )}
          {canGoDown && (
            <button
              ref={downRef}
              type="button"
              aria-label="Go to bottom"
              onClick={() => onRide("ride-down")}
            >
              <span aria-hidden="true">&#9660;</span>
              <span>Bottom {bottomRow}</span>
            </button>
          )}
        </fieldset>
      )}
    </div>
  );
}
