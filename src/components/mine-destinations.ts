/**
 * Village destinations (REQ-021 extension): physical buildings on the
 * surface walk row that, instead of opening a bottom-sheet menu like a
 * stall, send the player to another screen. Standing on the column shows
 * an "Enter" prompt; tapping it routes the app there. This is how the
 * mine surface acts as the overworld hub now that the top nav is gone.
 */
export interface DestinationDef {
  id: "workshop" | "battles";
  col: number;
  name: string;
  /** Sign/trim color, shared by the canvas building and the prompt. */
  color: string;
  /** App route the Enter prompt navigates to. */
  href: string;
  icon: string;
  blurb: string;
}

export const DESTINATIONS: readonly DestinationDef[] = [
  {
    id: "workshop",
    col: -7,
    name: "Workshop",
    color: "#9ad0ff",
    href: "/workshop",
    icon: "\u{1F527}",
    blurb: "build your bot and buy parts",
  },
  {
    id: "battles",
    col: 8,
    name: "Battles",
    color: "#ff8f6b",
    href: "/arena",
    icon: "\u{2694}\u{FE0F}",
    blurb: "watch bots fight",
  },
] as const;

export function destinationAt(col: number): DestinationDef | null {
  return DESTINATIONS.find((dest) => dest.col === col) ?? null;
}
