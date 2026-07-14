import { describe, expect, it } from "vitest";
import {
  type BunkerState,
  createBunker,
  excavateBunkerCell,
  placeBasePart,
  proposedBunkerFootprint,
  removeBasePart,
  STARTER_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import {
  buildFpSolidGrid,
  createFpSolidGrid,
  FP_CELL_COUNT,
  FP_COLS,
  FP_CORE,
  FP_DEPTH,
  FP_DOOR_OWNED,
  FP_OPEN,
  FP_ROCK_UNDUG,
  FP_ROWS,
  FP_SOLID_PART,
  FP_SPIKES,
  fpCellBlocks,
  fpCellBoxedIn,
  fpCellIndex,
  fpGridCellFromLocal,
  fpLocalFromGrid,
  fpSpawnCell,
} from "./bunker-fp-grid";

const MINER_COL = 24;
const MINER_ROW = 9;
const footprint = proposedBunkerFootprint(MINER_COL, MINER_ROW);

function corridorBunker(): BunkerState {
  return createBunker(footprint);
}

describe("fp grid mapping", () => {
  it("covers the 7x5x5 volume", () => {
    expect(FP_COLS).toBe(7);
    expect(FP_ROWS).toBe(5);
    expect(FP_DEPTH).toBe(5);
    expect(FP_CELL_COUNT).toBe(175);
    expect(fpCellIndex(6, 4, 4)).toBe(FP_CELL_COUNT - 1);
    expect(fpCellIndex(1, 2, 3)).toBe(1 + 2 * 7 + 3 * 35);
  });

  it("maps the footprint's BOTTOM row to y 0 and the top row to y 4", () => {
    const out = { x: 0, y: 0, z: 0 };
    const bottomRow = footprint.row + footprint.height - 1;
    fpLocalFromGrid(footprint, footprint.col, bottomRow, 0, out);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
    fpLocalFromGrid(footprint, footprint.col + 6, footprint.row, 4, out);
    expect(out).toEqual({ x: 6, y: 4, z: 4 });
    // The proposed footprint puts the miner on its bottom-center cell.
    fpLocalFromGrid(footprint, MINER_COL, MINER_ROW, 0, out);
    expect(out).toEqual({ x: 3, y: 0, z: 0 });
  });

  it("round-trips every cell of the footprint", () => {
    const out = { x: 0, y: 0, z: 0 };
    for (let col = footprint.col; col < footprint.col + 7; col++) {
      for (let row = footprint.row; row < footprint.row + 5; row++) {
        for (let depth = 0; depth < 5; depth++) {
          fpLocalFromGrid(footprint, col, row, depth, out);
          expect(out.x).toBe(col - footprint.col);
          expect(out.y).toBe(footprint.row + footprint.height - 1 - row);
          expect(out.z).toBe(depth);
          // Inverse: grid coordinates recover the mine cell.
          expect(footprint.col + out.x).toBe(col);
          expect(footprint.row + footprint.height - 1 - out.y).toBe(row);
        }
      }
    }
  });

  it("spawns at the miner's cell on the tunnel plane", () => {
    expect(fpSpawnCell(footprint, MINER_COL, MINER_ROW)).toEqual({
      x: 3,
      y: 0,
      z: 0,
    });
    // Defensive clamp: a miner outside the claim still spawns inside.
    expect(
      fpSpawnCell(footprint, footprint.col - 10, footprint.row - 10),
    ).toEqual({ x: 0, y: 4, z: 0 });
  });
});

describe("fp solidity", () => {
  it("blocks parts, the core, and rock; passes air, spikes, and doors", () => {
    expect(fpCellBlocks(FP_OPEN)).toBe(false);
    expect(fpCellBlocks(FP_SPIKES)).toBe(false);
    expect(fpCellBlocks(FP_DOOR_OWNED)).toBe(false);
    expect(fpCellBlocks(FP_SOLID_PART)).toBe(true);
    expect(fpCellBlocks(FP_CORE)).toBe(true);
    expect(fpCellBlocks(FP_ROCK_UNDUG)).toBe(true);
  });

  it("fills the initial corridor: z 0 open, deeper rock, core solid", () => {
    const bunker = corridorBunker();
    const grid = createFpSolidGrid();
    buildFpSolidGrid(bunker, grid);
    const coreX = bunker.core.col - footprint.col;
    const coreY = footprint.row + footprint.height - 1 - bunker.core.row;
    for (let x = 0; x < FP_COLS; x++) {
      for (let y = 0; y < FP_ROWS; y++) {
        const expected = x === coreX && y === coreY ? FP_CORE : FP_OPEN;
        expect(grid[fpCellIndex(x, y, 0)]).toBe(expected);
        for (let z = 1; z < FP_DEPTH; z++) {
          expect(grid[fpCellIndex(x, y, z)]).toBe(FP_ROCK_UNDUG);
        }
      }
    }
  });

  it("marks part kinds and opens dug cells", () => {
    let bunker = corridorBunker();
    let inventory = { ...STARTER_BASE_PART_INVENTORY, "floor-spikes": 2 };
    const bottomRow = footprint.row + footprint.height - 1;
    const place = (
      partId: Parameters<typeof placeBasePart>[2],
      col: number,
      row: number,
      depth = 0,
    ) => {
      const result = placeBasePart(bunker, inventory, partId, col, row, depth);
      if (!result.ok) throw new Error(`place ${partId}: ${result.reason}`);
      bunker = result.bunker;
      inventory = result.inventory;
    };
    place("wall-panel", footprint.col, bottomRow);
    place("door-panel", footprint.col + 1, bottomRow);
    place("floor-spikes", footprint.col + 2, bottomRow);
    const dig = (col: number, row: number, depth: number) => {
      const result = excavateBunkerCell(bunker, col, row, depth);
      if (!result.ok) throw new Error(`dig: ${result.reason}`);
      bunker = result.bunker;
    };
    dig(footprint.col + 5, bottomRow, 1);
    dig(footprint.col + 5, bottomRow, 2);
    place("roof-panel", footprint.col + 5, bottomRow, 2);

    const grid = createFpSolidGrid();
    buildFpSolidGrid(bunker, grid);
    expect(grid[fpCellIndex(0, 0, 0)]).toBe(FP_SOLID_PART);
    expect(grid[fpCellIndex(1, 0, 0)]).toBe(FP_DOOR_OWNED);
    expect(grid[fpCellIndex(2, 0, 0)]).toBe(FP_SPIKES);
    expect(grid[fpCellIndex(5, 0, 1)]).toBe(FP_OPEN);
    expect(grid[fpCellIndex(5, 0, 2)]).toBe(FP_SOLID_PART);
    expect(grid[fpCellIndex(5, 0, 3)]).toBe(FP_ROCK_UNDUG);
    expect(grid[fpCellIndex(3, 2, 0)]).toBe(FP_CORE);
  });

  it("normalizes legacy wire shapes (parts without depth, no dug list)", () => {
    const legacy = {
      footprint,
      core: { col: MINER_COL, row: MINER_ROW - 2, durability: 160 },
      parts: [
        {
          partId: "wall-panel",
          col: footprint.col,
          row: MINER_ROW,
          durability: 90,
        },
      ],
    } as unknown as BunkerState;
    const grid = createFpSolidGrid();
    buildFpSolidGrid(legacy, grid);
    expect(grid[fpCellIndex(0, 0, 0)]).toBe(FP_SOLID_PART);
    expect(grid[fpCellIndex(3, 2, 0)]).toBe(FP_CORE);
    for (let z = 1; z < FP_DEPTH; z++) {
      expect(grid[fpCellIndex(3, 0, z)]).toBe(FP_ROCK_UNDUG);
    }
  });

  it("ignores parts stamped outside the volume", () => {
    const bunker = corridorBunker();
    const rogue: BunkerState = {
      ...bunker,
      parts: [
        {
          partId: "wall-panel",
          col: footprint.col - 2,
          row: MINER_ROW,
          depth: 0,
          durability: 90,
        },
      ],
    };
    const grid = createFpSolidGrid();
    buildFpSolidGrid(rogue, grid);
    for (let i = 0; i < FP_CELL_COUNT; i++) {
      expect(grid[i]).not.toBe(FP_SOLID_PART);
    }
  });
});

describe("fpCellBoxedIn", () => {
  it("is open on a fresh claim (rock ahead, tunnel row beside)", () => {
    const grid = createFpSolidGrid();
    buildFpSolidGrid(corridorBunker(), grid);
    // Spawn cell (3,0,0): +z is undug rock and -z is the boundary, but
    // both x neighbors are open tunnel plane.
    expect(fpCellBoxedIn(grid, 3, 0, 0)).toBe(false);
  });

  it("boxes in a spawn walled on both open sides", () => {
    const bunker = corridorBunker();
    const inventory = { ...STARTER_BASE_PART_INVENTORY };
    const left = placeBasePart(
      bunker,
      inventory,
      "wall-panel",
      MINER_COL - 1,
      MINER_ROW,
    );
    if (!left.ok) throw new Error("left wall failed");
    const right = placeBasePart(
      left.bunker,
      left.inventory,
      "wall-panel",
      MINER_COL + 1,
      MINER_ROW,
    );
    if (!right.ok) throw new Error("right wall failed");
    const grid = createFpSolidGrid();
    buildFpSolidGrid(right.bunker, grid);
    // (3,0,0): -z boundary, +z undug rock, both x neighbors walls.
    expect(fpCellBoxedIn(grid, 3, 0, 0)).toBe(true);
    // The cell above the walls is not boxed (open row beside it).
    expect(fpCellBoxedIn(grid, 3, 1, 0)).toBe(false);
  });

  it("treats doors and spikes as passable neighbors", () => {
    const bunker = corridorBunker();
    const inventory = { ...STARTER_BASE_PART_INVENTORY };
    const left = placeBasePart(
      bunker,
      inventory,
      "wall-panel",
      MINER_COL - 1,
      MINER_ROW,
    );
    if (!left.ok) throw new Error("left wall failed");
    const door = placeBasePart(
      left.bunker,
      left.inventory,
      "door-panel",
      MINER_COL + 1,
      MINER_ROW,
    );
    if (!door.ok) throw new Error("door failed");
    const grid = createFpSolidGrid();
    buildFpSolidGrid(door.bunker, grid);
    expect(fpCellBoxedIn(grid, 3, 0, 0)).toBe(false);
  });

  it("counts a dug deep cell surrounded by rock as boxed in", () => {
    const bunker = corridorBunker();
    const dug = excavateBunkerCell(bunker, MINER_COL, MINER_ROW, 1);
    if (!dug.ok) throw new Error("excavate failed");
    const grid = createFpSolidGrid();
    buildFpSolidGrid(dug.bunker, grid);
    // (3,0,1): -z neighbor is the open tunnel plane, so not boxed.
    expect(fpCellBoxedIn(grid, 3, 0, 1)).toBe(false);
    // Seal the tunnel-plane mouth with a wall: now every lateral
    // neighbor of the dug cell is rock or that wall.
    const inventory = { ...STARTER_BASE_PART_INVENTORY };
    const sealed = placeBasePart(
      dug.bunker,
      inventory,
      "wall-panel",
      MINER_COL,
      MINER_ROW,
    );
    if (!sealed.ok) throw new Error("seal failed");
    buildFpSolidGrid(sealed.bunker, grid);
    expect(fpCellBoxedIn(grid, 3, 0, 1)).toBe(true);
    // Prying the sealing wall refunds it and reopens the mouth (F-099),
    // so the rebuilt grid stands the hint down.
    const pried = removeBasePart(
      sealed.bunker,
      sealed.inventory,
      MINER_COL,
      MINER_ROW,
      0,
    );
    if (!pried.ok) throw new Error("pry failed");
    buildFpSolidGrid(pried.bunker, grid);
    expect(fpCellBoxedIn(grid, 3, 0, 1)).toBe(false);
  });
});

describe("fpGridCellFromLocal", () => {
  it("inverts fpLocalFromGrid across the volume", () => {
    const footprint = proposedBunkerFootprint(4, 8);
    const local = { x: 0, y: 0, z: 0 };
    for (const [x, y, z] of [
      [0, 0, 0],
      [6, 4, 4],
      [3, 0, 2],
      [2, 4, 1],
    ] as const) {
      const cell = fpGridCellFromLocal(footprint, x, y, z);
      fpLocalFromGrid(footprint, cell.col, cell.row, cell.depth, local);
      expect([local.x, local.y, local.z]).toEqual([x, y, z]);
    }
    // The footprint's bottom row is local y 0 on the tunnel plane.
    const bottom = fpGridCellFromLocal(footprint, 3, 0, 0);
    expect(bottom).toEqual({
      col: footprint.col + 3,
      row: footprint.row + footprint.height - 1,
      depth: 0,
    });
  });
});
