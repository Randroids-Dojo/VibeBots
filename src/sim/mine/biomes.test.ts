import { describe, expect, it } from "vitest";
import {
  authoredPortalAt,
  BIOME_BANDS,
  BIOME_PORTALS,
  biomeAt,
  portalDef,
} from "./biomes";

describe("mine biome helpers", () => {
  it("selects biome bands on inclusive column boundaries", () => {
    for (const band of BIOME_BANDS) {
      expect(biomeAt(band.minCol)).toBe(band.id);
      expect(biomeAt(band.maxCol)).toBe(band.id);
    }

    expect(biomeAt(BIOME_BANDS[0].minCol - 1)).toBe("default");
    expect(biomeAt(BIOME_BANDS[0].maxCol + 1)).toBe("default");
    expect(biomeAt(BIOME_BANDS[1].minCol - 1)).toBe("default");
    expect(biomeAt(BIOME_BANDS[1].maxCol + 1)).toBe("default");
  });

  it("looks up authored portal definitions and exact coordinates", () => {
    for (const portal of BIOME_PORTALS) {
      expect(portalDef(portal.id)).toBe(portal);
      expect(authoredPortalAt(portal.col, portal.row)).toBe(portal);
    }

    expect(authoredPortalAt(0, 0)).toBeNull();
    expect(authoredPortalAt(BIOME_PORTALS[0].col, 1)).toBeNull();
  });
});
