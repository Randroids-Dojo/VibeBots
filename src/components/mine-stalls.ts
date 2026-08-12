/**
 * The surface village (REQ-021): shop stalls on the walk row. Standing
 * on a stall's column with the miner on the surface opens its menu in
 * the panel; the canvas draws the buildings at the same columns.
 */
export interface StallDef {
  id: "buyer" | "supply" | "upgrades" | "elevator" | "warp";
  col: number;
  name: string;
  /** Sign/trim color, shared by the canvas building and the menu. */
  color: string;
  blurb: string;
}

export const STALLS: readonly StallDef[] = [
  {
    id: "elevator",
    col: -5,
    name: "Elevator",
    color: "#9aa7ff",
    blurb: "premium rail shaft; free rides",
  },
  {
    id: "buyer",
    col: -3,
    name: "Hardware Store",
    color: "#f5c542",
    blurb: "base parts, traps, and turret stock",
  },
  {
    id: "supply",
    col: 2,
    name: "Supply Depot",
    color: "#ff9f43",
    blurb: "supplies for digging deeper",
  },
  {
    id: "upgrades",
    col: 4,
    name: "Upgrades",
    color: "#54e0c7",
    blurb: "permanent gear upgrades",
  },
  {
    id: "warp",
    col: 6,
    name: "Warp Pad",
    color: "#e08aff",
    blurb: "jumps to your beacon, range by warpcoil",
  },
] as const;

export function stallAt(col: number): StallDef | null {
  return STALLS.find((stall) => stall.col === col) ?? null;
}
