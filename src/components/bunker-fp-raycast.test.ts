import { describe, expect, it } from "vitest";
import {
  createFpSolidGrid,
  FP_DEPTH,
  FP_DOOR_OWNED,
  FP_ROCK_UNDUG,
  FP_SOLID_PART,
  FP_SPIKES,
  type FpSolidGrid,
  fpCellIndex,
} from "./bunker-fp-grid";
import {
  FP_CAPSULE_HEIGHT,
  FP_CAPSULE_RADIUS,
  fpCellIntersectsCapsule,
} from "./bunker-fp-movement";
import {
  createFpRayHit,
  FP_FACE_NEG_X,
  FP_FACE_NEG_Y,
  FP_FACE_NEG_Z,
  FP_FACE_POS_X,
  FP_FACE_POS_Y,
  FP_FACE_POS_Z,
  type FpRayHit,
  fpPlacementSlot,
  raycastFpGrid,
} from "./bunker-fp-raycast";

/** An all-open room over rock: z 0 open, depths 1-4 undug. */
function corridorGrid(): FpSolidGrid {
  const grid = createFpSolidGrid();
  for (let z = 1; z < FP_DEPTH; z++) {
    for (let i = 0; i < 35; i++) grid[z * 35 + i] = FP_ROCK_UNDUG;
  }
  return grid;
}

function cast(
  grid: FpSolidGrid,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  maxDist = 3.5,
): FpRayHit {
  const out = createFpRayHit();
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  raycastFpGrid(
    origin[0],
    origin[1],
    origin[2],
    dir[0] / len,
    dir[1] / len,
    dir[2] / len,
    grid,
    maxDist,
    out,
  );
  return out;
}

describe("fp crosshair raycast", () => {
  it("hits the interior rock straight ahead as diggable, entered face toward the ray", () => {
    const grid = corridorGrid();
    // Eye at the spawn cell, facing -z (into the rock).
    const hit = cast(grid, [3, 0.22, 0], [0, 0, -1]);
    expect(hit.hit).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([3, 0, 1]);
    expect(hit.kind).toBe("rock-diggable");
    expect(hit.face).toBe(FP_FACE_NEG_Z);
    expect(hit.distance).toBeCloseTo(0.5, 5);
    // The place cell is the open cell the ray crossed: the origin cell.
    expect([hit.placeX, hit.placeY, hit.placeZ]).toEqual([3, 0, 0]);
  });

  it("hits a placed part along +x with the -x face and the open cell before it", () => {
    const grid = corridorGrid();
    grid[fpCellIndex(5, 0, 0)] = FP_SOLID_PART;
    const hit = cast(grid, [2, 0.22, 0], [1, 0, 0]);
    expect(hit.hit).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([5, 0, 0]);
    expect(hit.kind).toBe("part");
    expect(hit.face).toBe(FP_FACE_NEG_X);
    expect(hit.distance).toBeCloseTo(2.5, 5);
    expect([hit.placeX, hit.placeY, hit.placeZ]).toEqual([4, 0, 0]);
  });

  it("reports a door and spikes by kind", () => {
    const grid = corridorGrid();
    grid[fpCellIndex(4, 0, 0)] = FP_DOOR_OWNED;
    expect(cast(grid, [2, 0.22, 0], [1, 0, 0]).kind).toBe("door");
    grid[fpCellIndex(4, 0, 0)] = FP_SPIKES;
    expect(cast(grid, [2, 0.22, 0], [1, 0, 0]).kind).toBe("spikes");
  });

  it("misses beyond the reach cutoff", () => {
    const grid = corridorGrid();
    grid[fpCellIndex(6, 0, 0)] = FP_SOLID_PART;
    // The part face sits 3.5 - 0.22... from x 2.2: 6 - 0.5 - 2.2 = 3.3 in
    // reach; from x 1.2 it is 4.3, out of reach.
    const near = cast(grid, [2.2, 0.22, 0], [1, 0, 0]);
    expect(near.hit).toBe(true);
    const far = cast(grid, [1.2, 0.22, 0], [1, 0, 0]);
    expect(far.hit).toBe(false);
    expect([far.x, far.y, far.z]).toEqual([-1, -1, -1]);
    expect([far.placeX, far.placeY, far.placeZ]).toEqual([-1, -1, -1]);
  });

  it("treats the boundary shell as un-diggable rock with the last open place cell", () => {
    const grid = corridorGrid();
    // Facing -x from near the west wall: the ray exits the volume at
    // x -1 and the wall face becomes a placement surface.
    const hit = cast(grid, [1, 0.22, 0], [-1, 0, 0]);
    expect(hit.hit).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([-1, 0, 0]);
    expect(hit.kind).toBe("rock");
    expect(hit.face).toBe(FP_FACE_POS_X);
    expect([hit.placeX, hit.placeY, hit.placeZ]).toEqual([0, 0, 0]);
  });

  it("hits the floor boundary on a downward diagonal with the traversed cell as place", () => {
    const grid = corridorGrid();
    // Down-left from the spawn eye: crosses into (2, 0, 0) first, then
    // out the floor beneath it.
    const hit = cast(grid, [3, 0.22, 0], [-0.765, -0.644, 0]);
    expect(hit.hit).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([2, -1, 0]);
    expect(hit.kind).toBe("rock");
    expect(hit.face).toBe(FP_FACE_POS_Y);
    expect([hit.placeX, hit.placeY, hit.placeZ]).toEqual([2, 0, 0]);
  });

  it("traverses diagonals in DDA order (nearest crossing first)", () => {
    const grid = corridorGrid();
    // A 45-degree ray in the x/z plane from the center of (2, 0, 0)
    // crosses x before z is meaningful when x is slightly steeper.
    grid[fpCellIndex(3, 0, 0)] = FP_SOLID_PART;
    grid[fpCellIndex(2, 0, 1)] = FP_SOLID_PART;
    // Marginally more +x than -z: the x wall is reached first.
    const hitX = cast(grid, [2, 0.22, 0], [1, 0, -0.98]);
    expect([hitX.x, hitX.y, hitX.z]).toEqual([3, 0, 0]);
    // Marginally more -z than +x: the deep cell is reached first.
    const hitZ = cast(grid, [2, 0.22, 0], [0.98, 0, -1]);
    expect([hitZ.x, hitZ.y, hitZ.z]).toEqual([2, 0, 1]);
  });

  it("never reports the origin cell as the hit", () => {
    const grid = corridorGrid();
    // Standing inside a spikes cell and looking at the far wall: the
    // ray skips the cell it starts in.
    grid[fpCellIndex(3, 0, 0)] = FP_SPIKES;
    grid[fpCellIndex(4, 0, 0)] = FP_SOLID_PART;
    const hit = cast(grid, [3, 0.22, 0], [1, 0, 0]);
    expect([hit.x, hit.y, hit.z]).toEqual([4, 0, 0]);
    expect(hit.kind).toBe("part");
    // A non-open origin cell seeds no place cell.
    expect([hit.placeX, hit.placeY, hit.placeZ]).toEqual([-1, -1, -1]);
  });
});

describe("fp capsule placement guard", () => {
  it("rejects the cells the capsule overlaps and allows the rest", () => {
    // Feet at the floor of cell (3, 0, 0).
    const px = 3;
    const py = -0.5;
    const pz = 0;
    expect(fpCellIntersectsCapsule(3, 0, 0, px, py, pz)).toBe(true);
    // Standing on the floor, the sub-cell capsule stays inside the
    // feet cell; mid-jump it straddles the cell above too.
    expect(FP_CAPSULE_HEIGHT).toBeLessThan(1);
    expect(fpCellIntersectsCapsule(3, 1, 0, px, py, pz)).toBe(false);
    expect(fpCellIntersectsCapsule(3, 1, 0, px, 0, pz)).toBe(true);
    expect(fpCellIntersectsCapsule(3, 0, 0, px, 0, pz)).toBe(true);
    // Side cells clear once the gap beats the capsule radius.
    expect(fpCellIntersectsCapsule(4, 0, 0, px, py, pz)).toBe(false);
    expect(fpCellIntersectsCapsule(2, 0, 0, px, py, pz)).toBe(false);
    expect(fpCellIntersectsCapsule(3, 0, 1, px, py, pz)).toBe(false);
    // Straddling an edge blocks both cells.
    const edgeX = 3.5 + FP_CAPSULE_RADIUS - 0.05;
    expect(fpCellIntersectsCapsule(4, 0, 0, edgeX, py, pz)).toBe(true);
    expect(fpCellIntersectsCapsule(3, 0, 0, edgeX, py, pz)).toBe(true);
  });
});

describe("fpPlacementSlot (F-117)", () => {
  it("snaps a wall to the wall slot on the aimed face", () => {
    expect(fpPlacementSlot(FP_FACE_NEG_X, "wall-panel")).toEqual({
      slot: "wall-px",
      valid: true,
    });
    expect(fpPlacementSlot(FP_FACE_POS_X, "wall-panel")).toEqual({
      slot: "wall-nx",
      valid: true,
    });
    expect(fpPlacementSlot(FP_FACE_NEG_Z, "wall-panel")).toEqual({
      slot: "wall-pz",
      valid: true,
    });
    expect(fpPlacementSlot(FP_FACE_POS_Z, "wall-panel")).toEqual({
      slot: "wall-nz",
      valid: true,
    });
  });

  it("rejects a wall aimed at a horizontal face", () => {
    expect(fpPlacementSlot(FP_FACE_POS_Y, "wall-panel")).toEqual({
      slot: undefined,
      valid: false,
    });
    expect(fpPlacementSlot(FP_FACE_NEG_Y, "wall-panel")).toEqual({
      slot: undefined,
      valid: false,
    });
  });

  it("accepts a floor only on the floor face and a roof only on the roof face", () => {
    expect(fpPlacementSlot(FP_FACE_POS_Y, "floor-panel")).toEqual({
      slot: "floor",
      valid: true,
    });
    expect(fpPlacementSlot(FP_FACE_NEG_X, "floor-panel")).toEqual({
      slot: undefined,
      valid: false,
    });
    expect(fpPlacementSlot(FP_FACE_NEG_Y, "roof-panel")).toEqual({
      slot: "roof",
      valid: true,
    });
    expect(fpPlacementSlot(FP_FACE_POS_Y, "roof-panel")).toEqual({
      slot: undefined,
      valid: false,
    });
  });

  it("places a mount part whole-cell regardless of the aimed face", () => {
    expect(fpPlacementSlot(FP_FACE_NEG_X, "basic-turret")).toEqual({
      slot: undefined,
      valid: true,
    });
    expect(fpPlacementSlot(FP_FACE_POS_Y, "floor-spikes")).toEqual({
      slot: undefined,
      valid: true,
    });
  });

  it("treats a door like a wall", () => {
    expect(fpPlacementSlot(FP_FACE_NEG_Z, "door-panel")).toEqual({
      slot: "wall-pz",
      valid: true,
    });
    expect(fpPlacementSlot(FP_FACE_POS_Y, "door-panel")).toEqual({
      slot: undefined,
      valid: false,
    });
  });
});
