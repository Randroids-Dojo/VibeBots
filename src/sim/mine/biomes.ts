/** The village warp pad's column. */
export const WARP_PAD_COL = 6;

export type MineBiomeId = "default" | "winter" | "highTech";

export interface BiomeBand {
  id: Exclude<MineBiomeId, "default">;
  name: string;
  minCol: number;
  maxCol: number;
}

export const BIOME_BANDS: readonly BiomeBand[] = [
  { id: "winter", name: "Winter Expanse", minCol: -100, maxCol: -50 },
  { id: "highTech", name: "Circuit Sprawl", minCol: 100, maxCol: 150 },
];

export function biomeAt(col: number): MineBiomeId {
  for (const band of BIOME_BANDS) {
    if (col >= band.minCol && col <= band.maxCol) return band.id;
  }
  return "default";
}

export type PortalBeaconId = "winter" | "highTech";
export type PortalTargetId = PortalBeaconId | "base";

export interface BiomePortalDef {
  id: PortalBeaconId;
  biome: Exclude<MineBiomeId, "default">;
  name: string;
  col: number;
  row: 0;
  color: string;
  blurb: string;
}

export const BIOME_PORTALS: readonly BiomePortalDef[] = [
  {
    id: "winter",
    biome: "winter",
    name: "Winter Beacon",
    col: -75,
    row: 0,
    color: "#9ee7ff",
    blurb: "snowfield gate",
  },
  {
    id: "highTech",
    biome: "highTech",
    name: "High-Tech Beacon",
    col: 125,
    row: 0,
    color: "#65ffb8",
    blurb: "high-tech gate",
  },
] as const;

export function portalDef(id: PortalBeaconId): BiomePortalDef {
  const def = BIOME_PORTALS.find((portal) => portal.id === id);
  if (!def) throw new Error(`unknown portal: ${id}`);
  return def;
}

export function authoredPortalAt(
  col: number,
  row: number,
): BiomePortalDef | null {
  return (
    BIOME_PORTALS.find((portal) => portal.col === col && portal.row === row) ??
    null
  );
}
