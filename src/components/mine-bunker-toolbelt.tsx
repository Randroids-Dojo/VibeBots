"use client";

import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BasePartInventory,
  type PlacedBasePart,
} from "@/sim/bunker";
import type { MineCoord } from "@/sim/mine";

export type BunkerToolSelection = BasePartId | "pry" | null;
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

function PryIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9 3h5v18c0 3 2 5 5 5h4v4h-5c-6 0-9-4-9-9V3Zm5 0h11v4H14V3Z" />
    </svg>
  );
}

export function BunkerToolbelt({
  inventory,
  selection,
  carried,
  constructionLabel,
  onSelect,
  onStowCarried,
  onCancelCarried,
  onEnterFp,
}: {
  inventory: BasePartInventory;
  selection: BunkerToolSelection;
  carried: CarriedBunkerPart | null;
  constructionLabel: string | null;
  onSelect: (selection: BunkerToolSelection) => void;
  onStowCarried: () => void;
  onCancelCarried: () => void;
  /** Enters the first-person bunker view; the button renders only when
   * the panel provides the callback (same gate as the toolbelt). */
  onEnterFp?: () => void;
}) {
  return (
    <section className="bunker-toolbelt" aria-label="Bunker build tool">
      <div className="bunker-toolbelt-topline">
        <div className="bunker-toolbelt-instruction">
          <HammerIcon />
          <span>
            {constructionLabel ??
              (selection
                ? "Point or swipe where it goes"
                : "Choose a part. Direction moves normally when none is selected.")}
          </span>
        </div>
        {onEnterFp && (
          <button
            type="button"
            className="bunker-toolbelt-enter-fp"
            data-testid="bunker-fp-enter"
            aria-label="Enter bunker"
            onClick={onEnterFp}
          >
            Enter bunker
          </button>
        )}
        {selection && (
          <button
            type="button"
            className="bunker-toolbelt-close"
            onClick={() => onSelect(null)}
          >
            Deselect
          </button>
        )}
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
            const active = selection === partId;
            const count = inventory[partId];
            return (
              <button
                key={partId}
                type="button"
                aria-label={`${BASE_PART_CATALOG[partId].name} x${count}`}
                aria-pressed={active}
                disabled={count <= 0}
                onClick={() => onSelect(active ? null : partId)}
              >
                <span className="bunker-part-shortcut">{index + 1}</span>
                <strong>{BASE_PART_CATALOG[partId].name}</strong>
                <small>x{count}</small>
              </button>
            );
          })}
          <button
            type="button"
            className="bunker-pry-tool"
            aria-label="Pry"
            aria-pressed={selection === "pry"}
            onClick={() => onSelect(selection === "pry" ? null : "pry")}
          >
            <PryIcon />
            <strong>Pry</strong>
            <small>Lift</small>
          </button>
        </fieldset>
      )}
    </section>
  );
}
