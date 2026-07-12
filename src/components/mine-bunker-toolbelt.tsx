"use client";

import { useRef } from "react";
import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BasePartInventory,
  type PlacedBasePart,
} from "@/sim/bunker";
import type { Direction, MineCoord } from "@/sim/mine";

export type BunkerToolAction = "build" | "pry";

export interface CarriedBunkerPart {
  source: MineCoord;
  part: PlacedBasePart;
}

function HammerIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 6h15l6 6-4 4-4-4-3 3 10 10-4 4L11 19l-6 6-3-3 10-10-2-2H5z" />
    </svg>
  );
}

function directionFromSwipe(dx: number, dy: number): Direction | null {
  if (Math.hypot(dx, dy) < 16) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export function BunkerToolbelt({
  equipped,
  inventory,
  selectedPart,
  action,
  facing,
  carried,
  onToggle,
  onSelectPart,
  onActionChange,
  onSwing,
  onStowCarried,
  onCancelCarried,
}: {
  equipped: boolean;
  inventory: BasePartInventory;
  selectedPart: BasePartId;
  action: BunkerToolAction;
  facing: Direction;
  carried: CarriedBunkerPart | null;
  onToggle: () => void;
  onSelectPart: (partId: BasePartId) => void;
  onActionChange: (action: BunkerToolAction) => void;
  onSwing: (direction: Direction) => void;
  onStowCarried: () => void;
  onCancelCarried: () => void;
}) {
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeDirection = useRef<Direction | null>(null);
  const swiped = useRef(false);

  if (!equipped) {
    return (
      <button
        type="button"
        className="bunker-hammer-equip"
        aria-label="Equip bunker hammer"
        onClick={onToggle}
      >
        <HammerIcon />
        <span>Build</span>
      </button>
    );
  }

  return (
    <section className="bunker-toolbelt" aria-label="Bunker build tool">
      <div className="bunker-toolbelt-topline">
        <fieldset className="bunker-tool-actions" aria-label="Hammer action">
          {(["build", "pry"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={action === item}
              disabled={Boolean(carried) && item === "pry"}
              onClick={() => onActionChange(item)}
            >
              {item === "build" ? "Build" : "Pry"}
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          className="bunker-toolbelt-close"
          onClick={onToggle}
        >
          Stow hammer
        </button>
      </div>

      {carried ? (
        <div className="bunker-carried-part" role="status">
          <div>
            <span>Carrying</span>
            <strong>{BASE_PART_CATALOG[carried.part.partId].name}</strong>
            <small>
              Durability {carried.part.durability}/
              {BASE_PART_CATALOG[carried.part.partId].durability}
            </small>
          </div>
          <button type="button" onClick={onStowCarried}>
            Stow part
          </button>
          <button type="button" onClick={onCancelCarried}>
            Put back
          </button>
        </div>
      ) : (
        <fieldset className="bunker-part-belt" aria-label="Base parts">
          {BASE_PART_IDS.map((partId, index) => {
            const active = action === "build" && selectedPart === partId;
            const count = inventory[partId];
            return (
              <button
                key={partId}
                type="button"
                aria-label={`${BASE_PART_CATALOG[partId].name} x${count}`}
                aria-pressed={active}
                disabled={count <= 0}
                onClick={() => {
                  onActionChange("build");
                  onSelectPart(partId);
                }}
              >
                <span className="bunker-part-shortcut">{index + 1}</span>
                <strong>{BASE_PART_CATALOG[partId].name}</strong>
                <small>x{count}</small>
              </button>
            );
          })}
        </fieldset>
      )}

      <button
        type="button"
        className="bunker-hammer-swing"
        aria-label={`Swing hammer ${facing}`}
        onClick={() => {
          if (swiped.current) {
            swiped.current = false;
            return;
          }
          onSwing(facing);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          swipeStart.current = { x: event.clientX, y: event.clientY };
          swipeDirection.current = null;
          swiped.current = false;
        }}
        onPointerMove={(event) => {
          const start = swipeStart.current;
          if (!start) return;
          swipeDirection.current = directionFromSwipe(
            event.clientX - start.x,
            event.clientY - start.y,
          );
        }}
        onPointerUp={(event) => {
          const direction = swipeDirection.current;
          swipeStart.current = null;
          swipeDirection.current = null;
          if (!direction) return;
          swiped.current = true;
          event.preventDefault();
          onSwing(direction);
        }}
      >
        <HammerIcon />
        <span>Tap or swipe</span>
      </button>
    </section>
  );
}
