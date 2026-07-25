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
  buildFpFaceGrids,
  buildFpSolidGrid,
  createFpFaceGrid,
  createFpSolidGrid,
  FP_CELL_COUNT,
  FP_COLS,
  FP_DEPTH,
  FP_DOOR_OWNED,
  FP_FACE_FLOOR,
  FP_FACE_MOUNT,
  FP_FACE_ROOF,
  FP_FACE_WALL_NX,
  FP_FACE_WALL_NZ,
  FP_FACE_WALL_PX,
  FP_FACE_WALL_PZ,
  FP_FLOOR_SLAB,
  FP_OPEN,
  FP_ROCK_UNDUG,
  FP_ROWS,
  FP_SOLID_PART,
  FP_SPIKES,
  FP_STAIR_NX,
  FP_STAIR_NZ,
  FP_STAIR_PX,
  FP_STAIR_PZ,
  fpCellBlocks,
  fpCellBoxedIn,
  fpCellIndex,
  fpCellIsStair,
  fpGridCellFromLocal,
  fpLocalFromGrid,
  fpSlotOccupied,
  fpSlotPlaceable,
  fpSlotRenderTransform,
  fpSpawnCell,
  fpStairValue,
} from "./bunker-fp-grid";

const MINER_COL = 24;
const MINER_ROW = 9;
const footprint = proposedBunkerFootprint(MINER_COL, MINER_ROW);

function corridorBunker(): BunkerState {
  return createBunker(footprint);
}

function solidOf(bunker: BunkerState) {
  const grid = createFpSolidGrid();
  buildFpSolidGrid(bunker, grid);
  return grid;
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

  it("spawns on the floor at the miner's cell when it is open", () => {
    // The proposed footprint centers the miner (local x 3), inside the
    // pre-mined spawn pocket, so the spawn is exactly there on the floor.
    expect(
      fpSpawnCell(solidOf(corridorBunker()), footprint, MINER_COL),
    ).toEqual({ x: 3, y: 0, z: 0 });
  });

  it("never spawns inside undug rock when the miner entered off-center", () => {
    const solid = solidOf(corridorBunker());
    // A fresh claim opens only the 3-wide spawn pocket (local x 2..4) on
    // the floor. Entering at either edge column would land in solid rock;
    // the spawn snaps to the nearest open pocket cell instead.
    expect(fpSpawnCell(solid, footprint, footprint.col)).toEqual({
      x: 2,
      y: 0,
      z: 0,
    });
    expect(fpSpawnCell(solid, footprint, footprint.col + 6)).toEqual({
      x: 4,
      y: 0,
      z: 0,
    });
    // Defensive clamp: a miner outside the claim still spawns in the pocket.
    expect(fpSpawnCell(solid, footprint, footprint.col - 10)).toEqual({
      x: 2,
      y: 0,
      z: 0,
    });
  });

  it("snaps off a part-occupied floor cell on a normal entry", () => {
    // A placed part is a blocker even on a dug-open cell. Entering onto a
    // walled center column must snap to the nearest standable pocket cell,
    // not spawn the player inside the part (the review's normal-entry gap).
    const bottomRow = footprint.row + footprint.height - 1;
    const placed = placeBasePart(
      corridorBunker(),
      STARTER_BASE_PART_INVENTORY,
      "wall-panel",
      footprint.col + 3,
      bottomRow,
      0,
    );
    if (!placed.ok) throw new Error(`place: ${placed.reason}`);
    expect(fpSpawnCell(solidOf(placed.bunker), footprint, MINER_COL)).toEqual({
      x: 2,
      y: 0,
      z: 0,
    });
  });

  it("falls back to any standable cell when the whole front floor is walled off", () => {
    // Wall every open cell on the floor-front row (the 3 pocket cells x2..4;
    // x0,x1,x5,x6 are undug rock). With no standable floor-front cell, the
    // spawn must still find an open cell (one row deep in the pocket) rather
    // than trusting a centre that is itself blocked.
    let bunker = corridorBunker();
    let inventory = { ...STARTER_BASE_PART_INVENTORY, "wall-panel": 5 };
    const bottomRow = footprint.row + footprint.height - 1;
    for (const x of [2, 3, 4]) {
      const result = placeBasePart(
        bunker,
        inventory,
        "wall-panel",
        footprint.col + x,
        bottomRow,
        0,
      );
      if (!result.ok) throw new Error(`place: ${result.reason}`);
      bunker = result.bunker;
      inventory = result.inventory;
    }
    const solid = solidOf(bunker);
    for (let x = 0; x < FP_COLS; x++) {
      expect(fpCellBlocks(solid[fpCellIndex(x, 0, 0)])).toBe(true);
    }
    const spawn = fpSpawnCell(solid, footprint, MINER_COL);
    expect(fpCellBlocks(solid[fpCellIndex(spawn.x, spawn.y, spawn.z)])).toBe(
      false,
    );
    expect(spawn).toEqual({ x: 3, y: 0, z: 1 });
  });

  it("spawns at the exact entry column once that floor cell is dug open", () => {
    let bunker = corridorBunker();
    const bottomRow = footprint.row + footprint.height - 1;
    // The pocket already opens local x 2..4 on the floor; dig the two
    // remaining floor-front cells out to the right edge (each adjacent to
    // the last opened one).
    for (let x = 5; x <= 6; x++) {
      const result = excavateBunkerCell(
        bunker,
        footprint.col + x,
        bottomRow,
        0,
      );
      expect(result.ok).toBe(true);
      if (result.ok) bunker = result.bunker;
    }
    expect(fpSpawnCell(solidOf(bunker), footprint, footprint.col + 6)).toEqual({
      x: 6,
      y: 0,
      z: 0,
    });
  });
});

describe("fp solidity", () => {
  it("blocks parts and rock; passes air, spikes, doors, and slab cells", () => {
    expect(fpCellBlocks(FP_OPEN)).toBe(false);
    expect(fpCellBlocks(FP_SPIKES)).toBe(false);
    expect(fpCellBlocks(FP_DOOR_OWNED)).toBe(false);
    expect(fpCellBlocks(FP_SOLID_PART)).toBe(true);
    expect(fpCellBlocks(FP_ROCK_UNDUG)).toBe(true);
    // A thin deck's cell body is passable; the movement resolver rides the
    // slab surface itself instead of blocking the whole cell.
    expect(fpCellBlocks(FP_FLOOR_SLAB)).toBe(false);
  });

  it("stamps a slotted floor as a thin slab and a legacy floor as a block", () => {
    const base = corridorBunker();
    const bottomRow = footprint.row + footprint.height - 1;
    const bunker: BunkerState = {
      ...base,
      parts: [
        {
          partId: "floor-panel",
          col: footprint.col + 2,
          row: bottomRow,
          depth: 0,
          durability: 70,
          slot: "floor",
        },
        // A pre-retirement whole-cell floor (no slot) was built as a block
        // and stays one.
        {
          partId: "floor-panel",
          col: footprint.col + 4,
          row: bottomRow,
          depth: 0,
          durability: 70,
        },
      ],
    };
    const grid = createFpSolidGrid();
    buildFpSolidGrid(bunker, grid);
    expect(grid[fpCellIndex(2, 0, 0)]).toBe(FP_FLOOR_SLAB);
    expect(grid[fpCellIndex(4, 0, 0)]).toBe(FP_SOLID_PART);
  });

  it("does not stamp destroyed parts into the solid grid", () => {
    const base = corridorBunker();
    const bottomRow = footprint.row + footprint.height - 1;
    const bunker: BunkerState = {
      ...base,
      parts: [
        {
          partId: "floor-panel",
          col: footprint.col + 3,
          row: bottomRow,
          depth: 0,
          durability: 0,
          slot: "floor",
        },
        {
          partId: "stair-panel",
          col: footprint.col + 3,
          row: bottomRow,
          depth: 1,
          durability: 0,
          slot: "mount",
        },
      ],
    };
    const grid = createFpSolidGrid();
    buildFpSolidGrid(bunker, grid);
    expect(grid[fpCellIndex(3, 0, 0)]).toBe(FP_OPEN);
    expect(grid[fpCellIndex(3, 0, 1)]).toBe(FP_OPEN);
  });

  it("stamps a staircase as a walkable ramp keyed to its orientation", () => {
    // The four stair values map 1:1 to BunkerOrientation.
    expect(fpStairValue(0)).toBe(FP_STAIR_PX);
    expect(fpStairValue(1)).toBe(FP_STAIR_PZ);
    expect(fpStairValue(2)).toBe(FP_STAIR_NX);
    expect(fpStairValue(3)).toBe(FP_STAIR_NZ);
    for (const v of [FP_STAIR_PX, FP_STAIR_PZ, FP_STAIR_NX, FP_STAIR_NZ]) {
      expect(fpCellIsStair(v)).toBe(true);
      expect(fpCellBlocks(v)).toBe(false); // a ramp is walkable
    }
    expect(fpCellIsStair(FP_SOLID_PART)).toBe(false);

    const bottomRow = footprint.row + footprint.height - 1;
    const withStair: BunkerState = {
      ...corridorBunker(),
      parts: [
        {
          partId: "stair-panel",
          col: footprint.col + 2,
          row: bottomRow,
          depth: 0,
          durability: 70,
          slot: "mount",
          orientation: 2,
        },
        // A legacy stair with no orientation defaults to +x.
        {
          partId: "stair-panel",
          col: footprint.col + 3,
          row: bottomRow,
          depth: 0,
          durability: 70,
        },
      ],
    };
    const grid = solidOf(withStair);
    expect(grid[fpCellIndex(2, 0, 0)]).toBe(FP_STAIR_NX);
    expect(grid[fpCellIndex(3, 0, 0)]).toBe(FP_STAIR_PX);
  });

  it("opens the spawn pocket on a fresh claim, rock elsewhere", () => {
    const bunker = corridorBunker();
    const grid = createFpSolidGrid();
    buildFpSolidGrid(bunker, grid);
    // Openness is exactly the sim's pre-mined pocket (F-115), so derive
    // it from the claim's own dug set rather than a hard-coded plane.
    const open = new Set(
      bunker.dug.map((cell) => {
        const x = cell.col - footprint.col;
        const y = footprint.row + footprint.height - 1 - cell.row;
        return fpCellIndex(x, y, cell.depth);
      }),
    );
    // The pocket is a genuine room, not just a single tunnel cell.
    expect(open.size).toBeGreaterThan(1);
    for (let x = 0; x < FP_COLS; x++) {
      for (let y = 0; y < FP_ROWS; y++) {
        for (let z = 0; z < FP_DEPTH; z++) {
          const idx = fpCellIndex(x, y, z);
          const expected = open.has(idx) ? FP_OPEN : FP_ROCK_UNDUG;
          expect(grid[idx]).toBe(expected);
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
    // Parts sit on open pocket floor cells (local x 2-4); the door lands
    // on the spawn cell itself.
    place("wall-panel", footprint.col + 2, bottomRow);
    place("door-panel", footprint.col + 3, bottomRow);
    place("floor-spikes", footprint.col + 4, bottomRow);
    const dig = (col: number, row: number, depth: number) => {
      const result = excavateBunkerCell(bunker, col, row, depth);
      if (!result.ok) throw new Error(`dig: ${result.reason}`);
      bunker = result.bunker;
    };
    // Chain a tunnel out of the pocket edge (4,0,1) into the deep rock.
    dig(footprint.col + 5, bottomRow, 1);
    dig(footprint.col + 5, bottomRow, 2);
    place("roof-panel", footprint.col + 5, bottomRow, 2);

    const grid = createFpSolidGrid();
    buildFpSolidGrid(bunker, grid);
    expect(grid[fpCellIndex(2, 0, 0)]).toBe(FP_SOLID_PART);
    expect(grid[fpCellIndex(3, 0, 0)]).toBe(FP_DOOR_OWNED);
    expect(grid[fpCellIndex(4, 0, 0)]).toBe(FP_SPIKES);
    expect(grid[fpCellIndex(5, 0, 1)]).toBe(FP_OPEN);
    expect(grid[fpCellIndex(5, 0, 2)]).toBe(FP_SOLID_PART);
    expect(grid[fpCellIndex(5, 0, 3)]).toBe(FP_ROCK_UNDUG);
    // The former core cell (F-118) is ordinary open pocket floor now.
    expect(grid[fpCellIndex(3, 2, 0)]).toBe(FP_OPEN);
  });

  it("keeps a floor and four walls as independent faces in one cell", () => {
    const bottomRow = footprint.row + footprint.height - 1;
    const bunker: BunkerState = {
      ...corridorBunker(),
      parts: [
        {
          partId: "floor-panel",
          col: footprint.col + 3,
          row: bottomRow,
          depth: 0,
          durability: 110,
          slot: "floor",
        },
        ...(["wall-px", "wall-nx", "wall-pz", "wall-nz"] as const).map(
          (slot) => ({
            partId: "wall-panel" as const,
            col: footprint.col + 3,
            row: bottomRow,
            depth: 0,
            durability: 90,
            slot,
          }),
        ),
      ],
    };
    const solid = createFpSolidGrid();
    const faces = createFpFaceGrid();
    const walls = createFpFaceGrid();
    buildFpSolidGrid(bunker, solid);
    buildFpFaceGrids(bunker, faces, walls);
    const index = fpCellIndex(3, 0, 0);
    expect(solid[index]).toBe(FP_FLOOR_SLAB);
    expect(faces[index]).toBe(
      FP_FACE_FLOOR |
        FP_FACE_WALL_PX |
        FP_FACE_WALL_NX |
        FP_FACE_WALL_PZ |
        FP_FACE_WALL_NZ,
    );
    expect(walls[index]).toBe(
      FP_FACE_WALL_PX | FP_FACE_WALL_NX | FP_FACE_WALL_PZ | FP_FACE_WALL_NZ,
    );
    for (const slot of [
      "floor",
      "wall-px",
      "wall-nx",
      "wall-pz",
      "wall-nz",
    ] as const) {
      expect(fpSlotOccupied(faces, 3, 0, 0, slot)).toBe(true);
    }
  });

  it("adds an intact roof to the movement barrier grid", () => {
    const bottomRow = footprint.row + footprint.height - 1;
    const bunker: BunkerState = {
      ...corridorBunker(),
      parts: [
        {
          partId: "roof-panel",
          col: footprint.col + 3,
          row: bottomRow - 1,
          depth: 0,
          durability: 70,
          slot: "roof",
        },
        {
          partId: "stair-panel",
          col: footprint.col + 4,
          row: bottomRow,
          depth: 0,
          durability: 70,
          slot: "mount",
        },
      ],
    };
    const faces = createFpFaceGrid();
    const barriers = createFpFaceGrid();
    buildFpFaceGrids(bunker, faces, barriers);
    const index = fpCellIndex(3, 1, 0);
    expect(faces[index] & FP_FACE_ROOF).toBe(FP_FACE_ROOF);
    expect(barriers[index] & FP_FACE_ROOF).toBe(FP_FACE_ROOF);
    expect(faces[fpCellIndex(4, 0, 0)] & FP_FACE_MOUNT).toBe(FP_FACE_MOUNT);
    expect(barriers[fpCellIndex(4, 0, 0)] & FP_FACE_MOUNT).toBe(0);
  });

  it("places mounts and thin faces into their independent slots", () => {
    const solid = createFpSolidGrid();
    const faces = createFpFaceGrid();
    const index = fpCellIndex(3, 0, 0);
    solid[index] = FP_FLOOR_SLAB;
    faces[index] =
      FP_FACE_FLOOR |
      FP_FACE_WALL_PX |
      FP_FACE_WALL_NX |
      FP_FACE_WALL_PZ |
      FP_FACE_WALL_NZ;
    expect(fpSlotPlaceable(solid, faces, 3, 0, 0, undefined)).toBe(true);

    faces[index] |= FP_FACE_MOUNT;
    solid[index] = FP_SOLID_PART;
    expect(fpSlotPlaceable(solid, faces, 3, 0, 0, undefined)).toBe(false);
    expect(fpSlotPlaceable(solid, faces, 3, 0, 0, "roof")).toBe(true);
    expect(fpSlotPlaceable(solid, faces, 3, 0, 0, "floor")).toBe(false);
  });

  it("normalizes legacy wire shapes (parts without depth, no dug list)", () => {
    const legacy = {
      footprint,
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
    // No dug list on a legacy wire shape, so the interior (including the
    // former core cell, F-118) reads as unexcavated rock.
    expect(grid[fpCellIndex(3, 2, 0)]).toBe(FP_ROCK_UNDUG);
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
  it("is open on a fresh claim (spawn pocket walls off nothing)", () => {
    const grid = createFpSolidGrid();
    buildFpSolidGrid(corridorBunker(), grid);
    // Spawn cell (3,0,0) sits inside the pre-mined pocket: its +x, -x,
    // and +z neighbors are all open pocket cells.
    expect(fpCellBoxedIn(grid, 3, 0, 0)).toBe(false);
  });

  it("boxes in a dug cell once its open mouth is walled", () => {
    // Dig a depth-3 cell reachable only through the pocket edge (4,0,2),
    // then wall that pocket cell: every lateral neighbor is now rock or
    // wall.
    const bunker = corridorBunker();
    const cellCol = footprint.col + 4;
    const cellRow = footprint.row + footprint.height - 1;
    const dug = excavateBunkerCell(bunker, cellCol, cellRow, 3);
    if (!dug.ok) throw new Error(`excavate: ${dug.reason}`);
    const grid = createFpSolidGrid();
    buildFpSolidGrid(dug.bunker, grid);
    // (4,0,3): its -z neighbor (4,0,2) is still open pocket, so not boxed.
    expect(fpCellBoxedIn(grid, 4, 0, 3)).toBe(false);
    const sealed = placeBasePart(
      dug.bunker,
      { ...STARTER_BASE_PART_INVENTORY },
      "wall-panel",
      cellCol,
      cellRow,
      2,
    );
    if (!sealed.ok) throw new Error(`seal: ${sealed.reason}`);
    buildFpSolidGrid(sealed.bunker, grid);
    expect(fpCellBoxedIn(grid, 4, 0, 3)).toBe(true);
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

  it("stands the boxed-in hint down when the sealing wall is pried", () => {
    const bunker = corridorBunker();
    const cellCol = footprint.col + 4;
    const cellRow = footprint.row + footprint.height - 1;
    const dug = excavateBunkerCell(bunker, cellCol, cellRow, 3);
    if (!dug.ok) throw new Error(`excavate: ${dug.reason}`);
    const inventory = { ...STARTER_BASE_PART_INVENTORY };
    const sealed = placeBasePart(
      dug.bunker,
      inventory,
      "wall-panel",
      cellCol,
      cellRow,
      2,
    );
    if (!sealed.ok) throw new Error(`seal: ${sealed.reason}`);
    const grid = createFpSolidGrid();
    buildFpSolidGrid(sealed.bunker, grid);
    expect(fpCellBoxedIn(grid, 4, 0, 3)).toBe(true);
    // Prying the sealing wall refunds it and reopens the mouth (F-099),
    // so the rebuilt grid stands the hint down.
    const pried = removeBasePart(
      sealed.bunker,
      sealed.inventory,
      cellCol,
      cellRow,
      2,
    );
    if (!pried.ok) throw new Error(`pry: ${pried.reason}`);
    buildFpSolidGrid(pried.bunker, grid);
    expect(fpCellBoxedIn(grid, 4, 0, 3)).toBe(false);
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

describe("fpSlotRenderTransform (F-117)", () => {
  const O = 0.46;

  it("offsets a wall to its face and rotates x-walls onto the x axis", () => {
    expect(fpSlotRenderTransform("wall-px")).toEqual({
      x: O,
      y: 0,
      z: 0,
      rotY: Math.PI / 2,
    });
    expect(fpSlotRenderTransform("wall-nx")).toEqual({
      x: -O,
      y: 0,
      z: 0,
      rotY: Math.PI / 2,
    });
    // Grid depth grows into world -z, so a +depth wall sits at negative
    // local z and a -depth wall at positive local z.
    expect(fpSlotRenderTransform("wall-pz")).toEqual({
      x: 0,
      y: 0,
      z: -O,
      rotY: 0,
    });
    expect(fpSlotRenderTransform("wall-nz")).toEqual({
      x: 0,
      y: 0,
      z: O,
      rotY: 0,
    });
  });

  it("decks a floor at the bottom and a roof at the top, unrotated", () => {
    expect(fpSlotRenderTransform("floor")).toEqual({
      x: 0,
      y: -O,
      z: 0,
      rotY: 0,
    });
    expect(fpSlotRenderTransform("roof")).toEqual({
      x: 0,
      y: O,
      z: 0,
      rotY: 0,
    });
  });

  it("centers a mount and a legacy whole-cell part", () => {
    expect(fpSlotRenderTransform("mount")).toEqual({
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
    });
    expect(fpSlotRenderTransform(undefined)).toEqual({
      x: 0,
      y: 0,
      z: 0,
      rotY: 0,
    });
  });
});
