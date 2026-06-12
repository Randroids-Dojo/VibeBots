/**
 * The surface village (REQ-021): shop stalls on the walk row. Standing
 * on a stall's column with the miner on the surface opens its menu in
 * the panel; the canvas draws the buildings at the same columns.
 */
export interface StallDef {
  id: "assay" | "supply" | "outfitter";
  col: number;
  name: string;
  /** Sign/trim color, shared by the canvas building and the menu. */
  color: string;
  blurb: string;
}

export const STALLS: readonly StallDef[] = [
  {
    id: "assay",
    col: 1,
    name: "Assay Office",
    color: "#f5c542",
    blurb: "sells your banked haul to the vault",
  },
  {
    id: "supply",
    col: 6,
    name: "Supply Depot",
    color: "#ff9f43",
    blurb: "dynamite, rope, and ladder bundles",
  },
  {
    id: "outfitter",
    col: 8,
    name: "Outfitter",
    color: "#54e0c7",
    blurb: "persistent gear upgrades",
  },
] as const;

export function stallAt(col: number): StallDef | null {
  return STALLS.find((stall) => stall.col === col) ?? null;
}
