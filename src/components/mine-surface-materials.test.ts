import { describe, expect, it } from "vitest";
import { BUNKER_SKIN_CATALOG, type BunkerSkinId } from "@/sim/bunker";
import {
  BASE_PART_EMISSIVES,
  BUNKER_SKIN_PALETTES,
  bunkerPartMaterial,
  collectBunkerPartMaterials,
} from "./mine-surface-materials";

const SKINS = Object.keys(BUNKER_SKIN_PALETTES) as BunkerSkinId[];

describe("bunker skin palettes", () => {
  it("covers every catalog skin with a full hex palette", () => {
    expect(SKINS.sort()).toEqual(Object.keys(BUNKER_SKIN_CATALOG).sort());
    for (const skin of SKINS) {
      const palette = BUNKER_SKIN_PALETTES[skin];
      for (const hex of [palette.shell, palette.frame, palette.accent]) {
        expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("gives each skin a distinct shell color", () => {
    const shells = SKINS.map((skin) =>
      BUNKER_SKIN_PALETTES[skin].shell.toLowerCase(),
    );
    expect(new Set(shells).size).toBe(SKINS.length);
  });

  it("paints the shell and accent materials from the skin palette", () => {
    // The tint lives in a TSL color uniform (colorNode), not material.color.
    const tintHex = (material: { colorNode: unknown }) => {
      const node = material.colorNode as {
        value: { getHexString: () => string };
      };
      return `#${node.value.getHexString()}`;
    };
    for (const skin of SKINS) {
      const palette = BUNKER_SKIN_PALETTES[skin];
      const shell = bunkerPartMaterial("shell", "", false, skin);
      const accent = bunkerPartMaterial("accent", "", false, skin);
      expect(tintHex(shell)).toBe(palette.shell.toLowerCase());
      expect(tintHex(accent)).toBe(palette.accent.toLowerCase());
    }
    // Same skin and role reuse the cached instance; skins never share one.
    expect(bunkerPartMaterial("shell", "", false, "gilded")).toBe(
      bunkerPartMaterial("shell", "", false, "gilded"),
    );
    expect(bunkerPartMaterial("shell", "", false, "gilded")).not.toBe(
      bunkerPartMaterial("shell", "", false, "verdant"),
    );
  });

  it("warms shell, frame, and accent variants for every skin", () => {
    const materials = collectBunkerPartMaterials(false);
    const emissiveCount = new Set(Object.values(BASE_PART_EMISSIVES)).size;
    // Three skinned roles per skin, one shared composite, one per emissive.
    expect(materials.length).toBe(SKINS.length * 3 + 1 + emissiveCount);
    expect(new Set(materials).size).toBe(materials.length);
  });
});
