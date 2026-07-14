import { describe, expect, it } from "vitest";
import type { BunkerFootprint } from "./bunker";
import {
  BUNKER_POCKET_DEPTH,
  BUNKER_POCKET_HEIGHT,
  BUNKER_POCKET_WIDTH,
  type BunkerBlock,
  bunkerCellBlock,
  bunkerCellMineRow,
  bunkerSpawnPocketCells,
  deriveBunkerBlockSeed,
  isBunkerPocketCell,
  withSpawnPocket,
} from "./bunker-blocks";

const FOOTPRINT: BunkerFootprint = { col: 100, row: 40, width: 7, height: 5 };

describe("deriveBunkerBlockSeed", () => {
  it("is deterministic and an unsigned 32-bit integer", () => {
    const a = deriveBunkerBlockSeed(12345, FOOTPRINT);
    const b = deriveBunkerBlockSeed(12345, FOOTPRINT);
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });

  it("varies with the mine seed and the footprint position", () => {
    const base = deriveBunkerBlockSeed(12345, FOOTPRINT);
    expect(deriveBunkerBlockSeed(12346, FOOTPRINT)).not.toBe(base);
    expect(deriveBunkerBlockSeed(12345, { ...FOOTPRINT, col: 101 })).not.toBe(
      base,
    );
    expect(deriveBunkerBlockSeed(12345, { ...FOOTPRINT, row: 41 })).not.toBe(
      base,
    );
  });
});

describe("bunkerCellMineRow", () => {
  it("puts the floor (y 0) at the deepest row and the top at the shallowest", () => {
    // rows span footprint.row .. footprint.row + height - 1 (40..44).
    expect(bunkerCellMineRow(FOOTPRINT, 0)).toBe(44);
    expect(bunkerCellMineRow(FOOTPRINT, 4)).toBe(40);
  });
});

describe("bunkerCellBlock", () => {
  const seed = deriveBunkerBlockSeed(777, FOOTPRINT);

  it("is deterministic for the same cell", () => {
    const a = bunkerCellBlock(seed, FOOTPRINT, 2, 1, 1);
    const b = bunkerCellBlock(seed, FOOTPRINT, 2, 1, 1);
    expect(a).toEqual(b);
  });

  it("only ever yields dirt, rock, or ore across the whole volume", () => {
    const kinds = new Set<BunkerBlock["kind"]>();
    for (let z = 0; z < 5; z++) {
      for (let y = 0; y < FOOTPRINT.height; y++) {
        for (let x = 0; x < FOOTPRINT.width; x++) {
          const block = bunkerCellBlock(seed, FOOTPRINT, x, y, z);
          expect(["dirt", "rock", "ore"]).toContain(block.kind);
          kinds.add(block.kind);
          if (block.kind === "ore") expect(block.ore).toBeTruthy();
          if (block.kind === "rock") {
            expect(typeof block.rockTier).toBe("number");
          }
        }
      }
    }
    // A row-40+ volume is deep enough to carry ore, not just dirt.
    expect(kinds.has("ore")).toBe(true);
  });

  it("gives distinct depth layers (z 0 differs from z 1)", () => {
    let differences = 0;
    for (let y = 0; y < FOOTPRINT.height; y++) {
      for (let x = 0; x < FOOTPRINT.width; x++) {
        const front = bunkerCellBlock(seed, FOOTPRINT, x, y, 0);
        const back = bunkerCellBlock(seed, FOOTPRINT, x, y, 1);
        if (JSON.stringify(front) !== JSON.stringify(back)) differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });
});

describe("isBunkerPocketCell", () => {
  const spawnX = 3;

  it("covers exactly a 3x3x3 block centered on the spawn column", () => {
    let count = 0;
    for (let z = 0; z < 5; z++) {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 7; x++) {
          if (isBunkerPocketCell(spawnX, x, y, z)) count++;
        }
      }
    }
    expect(count).toBe(
      BUNKER_POCKET_WIDTH * BUNKER_POCKET_HEIGHT * BUNKER_POCKET_DEPTH,
    );
  });

  it("includes the spawn cell and excludes rock beyond the pocket", () => {
    expect(isBunkerPocketCell(spawnX, spawnX, 0, 0)).toBe(true);
    expect(isBunkerPocketCell(spawnX, spawnX + 1, 2, 2)).toBe(true);
    // Outside width, height, or depth.
    expect(isBunkerPocketCell(spawnX, spawnX + 2, 0, 0)).toBe(false);
    expect(isBunkerPocketCell(spawnX, spawnX, 3, 0)).toBe(false);
    expect(isBunkerPocketCell(spawnX, spawnX, 0, 3)).toBe(false);
  });
});

describe("withSpawnPocket", () => {
  const pocketSize =
    BUNKER_POCKET_WIDTH * BUNKER_POCKET_HEIGHT * BUNKER_POCKET_DEPTH;

  it("adds the whole spawn pocket to an empty dug set", () => {
    const merged = withSpawnPocket(FOOTPRINT, []);
    expect(merged).toHaveLength(pocketSize);
    expect(merged).toEqual(
      expect.arrayContaining(bunkerSpawnPocketCells(FOOTPRINT)),
    );
  });

  it("keeps existing dug cells and does not duplicate the pocket", () => {
    // A legacy dug cell outside the pocket plus one already inside it.
    const legacy = [
      { col: FOOTPRINT.col, row: FOOTPRINT.row, depth: 3 },
      bunkerSpawnPocketCells(FOOTPRINT)[0],
    ];
    const merged = withSpawnPocket(FOOTPRINT, legacy);
    // pocket size + the one out-of-pocket legacy cell (the in-pocket one
    // is already counted).
    expect(merged).toHaveLength(pocketSize + 1);
    expect(merged).toContainEqual({
      col: FOOTPRINT.col,
      row: FOOTPRINT.row,
      depth: 3,
    });
  });

  it("does not mutate the input dug array", () => {
    const legacy = [{ col: FOOTPRINT.col, row: FOOTPRINT.row, depth: 2 }];
    withSpawnPocket(FOOTPRINT, legacy);
    expect(legacy).toHaveLength(1);
  });
});
