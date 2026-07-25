import { describe, expect, it } from "vitest";
import {
  createFpFaceGrid,
  createFpSolidGrid,
  FP_DEPTH,
  FP_DOOR_OWNED,
  FP_FACE_WALL_PX,
  FP_FLOOR_SLAB,
  FP_ROCK_UNDUG,
  FP_SLAB_HEIGHT,
  FP_SOLID_PART,
  FP_SPIKES,
  FP_STAIR_NX,
  FP_STAIR_NZ,
  FP_STAIR_PX,
  FP_STAIR_PZ,
  type FpSolidGrid,
  fpCellIndex,
} from "./bunker-fp-grid";
import {
  FP_CAPSULE_HEIGHT,
  FP_CAPSULE_RADIUS,
  type FpMoveInput,
  type FpMoveState,
  fpSlotIntersectsCapsule,
  stepFpMovement,
} from "./bunker-fp-movement";

/** An all-open room over rock: z 0 open, depths 1-4 undug. */
function corridorGrid(): FpSolidGrid {
  const grid = createFpSolidGrid();
  for (let z = 1; z < FP_DEPTH; z++) {
    for (let i = 0; i < 35; i++) grid[z * 35 + i] = FP_ROCK_UNDUG;
  }
  return grid;
}

function state(overrides: Partial<FpMoveState> = {}): FpMoveState {
  return {
    px: 3,
    py: -0.5,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    ...overrides,
  };
}

function input(overrides: Partial<FpMoveInput> = {}): FpMoveInput {
  return {
    forward: 0,
    strafe: 0,
    jump: false,
    autoJump: false,
    yaw: 0,
    ...overrides,
  };
}

function stepMany(
  s: FpMoveState,
  i: FpMoveInput,
  grid: FpSolidGrid,
  steps: number,
  dt = 1 / 60,
): void {
  for (let n = 0; n < steps; n++) stepFpMovement(s, i, grid, dt);
}

describe("fp movement", () => {
  it("gravity settles the feet on the rock floor at -0.5", () => {
    const grid = corridorGrid();
    const s = state({ py: 2.5, grounded: false });
    stepMany(s, input(), grid, 120);
    expect(s.py).toBeCloseTo(-0.5, 5);
    expect(s.vy).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it("jump apex clears 1.1 cells and lands grounded again", () => {
    const grid = corridorGrid();
    const s = state();
    const jumpInput = input({ jump: true });
    stepFpMovement(s, jumpInput, grid, 1 / 60);
    expect(s.grounded).toBe(false);
    let apex = s.py;
    const idle = input();
    for (let n = 0; n < 240; n++) {
      stepFpMovement(s, idle, grid, 1 / 60);
      apex = Math.max(apex, s.py);
      if (s.grounded) break;
    }
    expect(apex - -0.5).toBeGreaterThan(1.1);
    expect(s.grounded).toBe(true);
    expect(s.py).toBeCloseTo(-0.5, 5);
  });

  it("jump only launches from the ground", () => {
    const grid = corridorGrid();
    const s = state({ py: 1.5, grounded: false, vy: 0 });
    stepFpMovement(s, input({ jump: true }), grid, 1 / 60);
    expect(s.vy).toBeLessThan(0);
  });

  it("a wall cell pushes the capsule out without tunneling at dt 0.05", () => {
    const grid = corridorGrid();
    grid[fpCellIndex(4, 0, 0)] = FP_SOLID_PART;
    grid[fpCellIndex(4, 1, 0)] = FP_SOLID_PART;
    // yaw -PI/2 walks +x (yaw 0 faces -z).
    const s = state();
    const walk = input({ forward: 1, yaw: -Math.PI / 2 });
    const limit = 4 - 0.5 - FP_CAPSULE_RADIUS;
    for (let n = 0; n < 80; n++) {
      stepFpMovement(s, walk, grid, 0.05);
      expect(s.px).toBeLessThanOrEqual(limit + 1e-6);
    }
    expect(s.px).toBeCloseTo(limit, 3);
  });

  it("a thin wall face blocks crossing without filling either cell", () => {
    const grid = corridorGrid();
    const walls = createFpFaceGrid();
    walls[fpCellIndex(3, 0, 0)] = FP_FACE_WALL_PX;
    const s = state();
    const walk = input({ forward: 1, yaw: -Math.PI / 2 });
    const limit = 3.5 - FP_CAPSULE_RADIUS;
    for (let n = 0; n < 80; n++) {
      stepFpMovement(s, walk, grid, 0.05, walls);
      expect(s.px).toBeLessThanOrEqual(limit + 1e-6);
    }
    expect(s.px).toBeCloseTo(limit, 3);
    expect(grid[fpCellIndex(3, 0, 0)]).toBe(0);
    expect(grid[fpCellIndex(4, 0, 0)]).toBe(0);
  });

  it("lets a centered player add faces around their cell", () => {
    const s = state();
    expect(fpSlotIntersectsCapsule("floor", 3, 0, 0, s.px, s.py, s.pz)).toBe(
      false,
    );
    for (const slot of ["wall-px", "wall-nx", "wall-pz", "wall-nz"] as const) {
      expect(fpSlotIntersectsCapsule(slot, 3, 0, 0, s.px, s.py, s.pz)).toBe(
        false,
      );
    }
    expect(fpSlotIntersectsCapsule("wall-px", 3, 0, 0, 3.25, s.py, s.pz)).toBe(
      true,
    );
  });

  it("undug rock blocks like a wall", () => {
    const grid = corridorGrid();
    grid[fpCellIndex(4, 0, 0)] = FP_ROCK_UNDUG;
    grid[fpCellIndex(4, 1, 0)] = FP_ROCK_UNDUG;
    const s = state();
    stepMany(s, input({ forward: 1, yaw: -Math.PI / 2 }), grid, 60, 0.05);
    expect(s.px).toBeCloseTo(4 - 0.5 - FP_CAPSULE_RADIUS, 3);
  });

  it("walking forward into the deep rock face stops at the z 1 wall", () => {
    const grid = corridorGrid();
    const s = state();
    stepMany(s, input({ forward: 1 }), grid, 60, 0.05);
    // Rock starts at grid z 1 (world z -1); its near face is -0.5.
    expect(s.pz).toBeCloseTo(-0.5 + FP_CAPSULE_RADIUS, 3);
  });

  it("door and spike cells pass", () => {
    for (const value of [FP_DOOR_OWNED, FP_SPIKES]) {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = value;
      grid[fpCellIndex(4, 1, 0)] = value;
      const s = state();
      stepMany(s, input({ forward: 1, yaw: -Math.PI / 2 }), grid, 80, 0.05);
      expect(s.px).toBeGreaterThan(4.5);
    }
  });

  it("falls and lands below when the support cell opens mid-air", () => {
    const grid = corridorGrid();
    grid[fpCellIndex(3, 0, 0)] = FP_SOLID_PART;
    // Standing on top of the block at cell (3, 0): feet at 0.5.
    const s = state({ py: 0.5 });
    stepMany(s, input(), grid, 10);
    expect(s.py).toBeCloseTo(0.5, 5);
    expect(s.grounded).toBe(true);
    // The block is pried away underfoot.
    grid[fpCellIndex(3, 0, 0)] = 0;
    stepMany(s, input(), grid, 120);
    expect(s.py).toBeCloseTo(-0.5, 5);
    expect(s.grounded).toBe(true);
  });

  it("clamps to the interior walls on every side", () => {
    const grid = corridorGrid();
    const left = state({ px: 1 });
    stepMany(left, input({ strafe: -1 }), grid, 60, 0.05);
    expect(left.px).toBeCloseTo(-0.5 + FP_CAPSULE_RADIUS, 3);
    const right = state({ px: 5 });
    stepMany(right, input({ strafe: 1 }), grid, 60, 0.05);
    expect(right.px).toBeCloseTo(6.5 - FP_CAPSULE_RADIUS, 3);
    const back = state();
    stepMany(back, input({ forward: -1 }), grid, 60, 0.05);
    expect(back.pz).toBeCloseTo(0.5 - FP_CAPSULE_RADIUS, 3);
    // Jumping in the open room caps at the ceiling.
    const up = state();
    const jumping = input({ jump: true });
    for (let n = 0; n < 300; n++) {
      stepFpMovement(up, jumping, grid, 0.05);
      expect(up.py).toBeLessThanOrEqual(4.5 - FP_CAPSULE_HEIGHT + 1e-6);
    }
  });

  describe("auto-jump (F-094)", () => {
    /** The touch input shape: joystick strafe toward +x, autoJump on
     * (the rig enables it for coarse-pointer sessions). */
    const touchWalkRight = () => input({ strafe: 1, autoJump: true, yaw: 0 });

    it("hops a one-block step while walking into it", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_SOLID_PART;
      const s = state();
      const walk = touchWalkRight();
      let apex = s.py;
      let landedOnTop = false;
      for (let n = 0; n < 300; n++) {
        stepFpMovement(s, walk, grid, 1 / 60);
        apex = Math.max(apex, s.py);
        if (s.grounded && s.py > 0.4) {
          landedOnTop = true;
          break;
        }
      }
      // Feet climb from -0.5 to the block top at 0.5 with no jump
      // input, and the mover keeps walking on top of the step.
      expect(landedOnTop).toBe(true);
      expect(s.py).toBeCloseTo(0.5, 5);
      expect(apex).toBeGreaterThan(0.5);
      expect(s.px).toBeGreaterThan(3.5);
    });

    it("does not hop a two-block wall", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_SOLID_PART;
      grid[fpCellIndex(4, 1, 0)] = FP_SOLID_PART;
      const s = state();
      const walk = touchWalkRight();
      for (let n = 0; n < 300; n++) {
        stepFpMovement(s, walk, grid, 1 / 60);
        expect(s.py).toBeCloseTo(-0.5, 5);
      }
      expect(s.px).toBeCloseTo(4 - 0.5 - FP_CAPSULE_RADIUS, 3);
    });

    it("does not trigger with a ceiling directly above (bonk guard)", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_SOLID_PART;
      // A roof over the mover's own column: the hop arc would bonk.
      grid[fpCellIndex(3, 1, 0)] = FP_SOLID_PART;
      const s = state();
      const walk = touchWalkRight();
      for (let n = 0; n < 300; n++) {
        stepFpMovement(s, walk, grid, 1 / 60);
        expect(s.py).toBeCloseTo(-0.5, 5);
      }
      expect(s.px).toBeCloseTo(4 - 0.5 - FP_CAPSULE_RADIUS, 3);
    });

    it("never triggers when autoJump is false", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_SOLID_PART;
      const s = state();
      const walk = input({ strafe: 1, yaw: 0 });
      for (let n = 0; n < 300; n++) {
        stepFpMovement(s, walk, grid, 1 / 60);
        expect(s.py).toBeCloseTo(-0.5, 5);
      }
      expect(s.px).toBeCloseTo(4 - 0.5 - FP_CAPSULE_RADIUS, 3);
    });

    it("keeps the desktop Space jump unchanged with autoJump off", () => {
      const grid = corridorGrid();
      const s = state();
      stepFpMovement(s, input({ jump: true }), grid, 1 / 60);
      expect(s.grounded).toBe(false);
      let apex = s.py;
      const idle = input();
      for (let n = 0; n < 240; n++) {
        stepFpMovement(s, idle, grid, 1 / 60);
        apex = Math.max(apex, s.py);
        if (s.grounded) break;
      }
      expect(apex - -0.5).toBeGreaterThan(1.1);
      expect(s.grounded).toBe(true);
    });
  });

  it("clamps oversized dt to the step ceiling", () => {
    const grid = corridorGrid();
    const s = state({ py: 4.5 - FP_CAPSULE_HEIGHT, grounded: false });
    stepFpMovement(s, input(), grid, 5);
    // One clamped step falls at most g * 0.05^2 plus float slack; an
    // unclamped 5s step would smash through the floor bound instantly.
    expect(s.py).toBeGreaterThan(4.5 - FP_CAPSULE_HEIGHT - 0.1);
    expect(Math.abs(s.vy)).toBeLessThanOrEqual(22 * 0.05 + 1e-9);
  });

  describe("staircase ramp (F-117)", () => {
    // yaw 0 faces -z, so a -90 deg yaw faces +x and +90 deg faces -x.
    const walkPX = () => input({ forward: 1, yaw: -Math.PI / 2 });
    const walkNX = () => input({ forward: 1, yaw: Math.PI / 2 });

    it("climbs one layer walking up the ramp in its facing direction", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_STAIR_PX; // ascend +x across cell 4
      // The upper landing: solid blocks whose tops (0.5) form the next floor.
      grid[fpCellIndex(5, 0, 0)] = FP_SOLID_PART;
      grid[fpCellIndex(6, 0, 0)] = FP_SOLID_PART;
      const s = state({ px: 3.2 });
      stepMany(s, walkPX(), grid, 240, 1 / 60);
      // Rose ~one cell from the floor at -0.5 to the landing top at 0.5.
      expect(s.py).toBeGreaterThan(0.4);
      expect(s.grounded).toBe(true);
      expect(s.px).toBeGreaterThan(4.5);
    });

    it("lifts the feet to the slope height on the ramp incline", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_STAIR_PX;
      // px 3.8 is t 0.3 of the cell; with a 0.6 run that is halfway up.
      const s = state({ px: 3.8, py: -0.5 });
      stepFpMovement(s, input(), grid, 1 / 60);
      expect(s.py).toBeCloseTo(0, 2);
      expect(s.grounded).toBe(true);
    });

    it("walks back down the ramp to the lower layer", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_STAIR_PX;
      const s = state({ px: 4.3, py: 0.3 });
      stepMany(s, walkNX(), grid, 240, 1 / 60);
      expect(s.py).toBeCloseTo(-0.5, 3);
      expect(s.grounded).toBe(true);
      expect(s.px).toBeLessThan(3.5);
    });

    it("blocks the climb under a solid ceiling without clipping through", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_STAIR_PX;
      grid[fpCellIndex(4, 1, 0)] = FP_SOLID_PART; // no headroom over the stair
      const s = state({ px: 3.2 });
      for (let n = 0; n < 240; n++) {
        stepFpMovement(s, walkPX(), grid, 1 / 60);
        // The head never penetrates the ceiling cell (its floor is y 0.5).
        expect(s.py + FP_CAPSULE_HEIGHT).toBeLessThanOrEqual(0.5 + 1e-6);
      }
      expect(s.py).toBeLessThan(0); // capped well short of a full-layer climb
    });

    it("reverses the slope when the orientation flips", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_STAIR_NX; // ascends toward -x now
      const s = state({ px: 4.8, py: -0.5 });
      let apex = s.py;
      for (let n = 0; n < 120; n++) {
        stepFpMovement(s, walkNX(), grid, 1 / 60);
        apex = Math.max(apex, s.py);
      }
      // Walking -x rides the reversed ramp up; a +x ramp here would not lift.
      expect(apex).toBeGreaterThan(0.4);
    });

    it("climbs along the z axis for a +z-facing stair", () => {
      // Grid depth +z is world -z, so yaw 0 (facing -z) ascends this stair.
      const grid = createFpSolidGrid(); // all open
      grid[fpCellIndex(3, 0, 1)] = FP_STAIR_PZ;
      grid[fpCellIndex(3, 0, 2)] = FP_SOLID_PART; // deep-side landing
      grid[fpCellIndex(3, 0, 3)] = FP_SOLID_PART;
      grid[fpCellIndex(3, 0, 4)] = FP_SOLID_PART;
      const s = state({ px: 3, pz: 0 });
      stepMany(s, input({ forward: 1, yaw: 0 }), grid, 240, 1 / 60);
      expect(s.py).toBeGreaterThan(0.4);
      expect(s.grounded).toBe(true);
      expect(-s.pz).toBeGreaterThan(1.5); // advanced deep past the stair
    });

    it("climbs along the z axis for a -z-facing stair", () => {
      const grid = createFpSolidGrid();
      grid[fpCellIndex(3, 0, 2)] = FP_STAIR_NZ; // ascends toward the shallow side
      grid[fpCellIndex(3, 0, 1)] = FP_SOLID_PART;
      grid[fpCellIndex(3, 0, 0)] = FP_SOLID_PART;
      const s = state({ px: 3, pz: -3 });
      // yaw PI faces +z (shallower), the -z stair's ascent direction.
      stepMany(s, input({ forward: 1, yaw: Math.PI }), grid, 240, 1 / 60);
      expect(s.py).toBeGreaterThan(0.4);
      expect(s.grounded).toBe(true);
      expect(-s.pz).toBeLessThan(1.5); // moved shallow past the stair
    });

    it("caps the head under a ceiling in an adjacent column, not just center", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_STAIR_PX;
      // A ceiling one column past the stair center; the climbing capsule's
      // body reaches into it (its floor is y 0.5) before its center leaves
      // column 4, so a center-only cap would let the head clip through.
      grid[fpCellIndex(5, 1, 0)] = FP_SOLID_PART;
      const s = state({ px: 3.2 });
      for (let n = 0; n < 240; n++) {
        stepFpMovement(s, walkPX(), grid, 1 / 60);
        // The capsule box never overlaps cell (5,1,0): if it reaches into
        // column 5 in x, the head stays at or below that cell's floor.
        const reachesColumn5 = s.px + FP_CAPSULE_RADIUS > 4.5;
        const headAboveCeilingFloor = s.py + FP_CAPSULE_HEIGHT > 0.5 + 1e-6;
        expect(reachesColumn5 && headAboveCeilingFloor).toBe(false);
      }
    });

    it("leaves a plain open floor unaffected", () => {
      const grid = corridorGrid();
      const s = state();
      stepMany(s, walkPX(), grid, 120, 1 / 60);
      expect(s.py).toBeCloseTo(-0.5, 5); // no stair, no lift
    });
  });

  describe("floor slab decks", () => {
    const walkPX = () => input({ forward: 1, yaw: -Math.PI / 2 });
    // A slab in cell y=1 spans [0.5, 0.58]; its walkable top:
    const upperTop = 1 - 0.5 + FP_SLAB_HEIGHT;
    // A slab in a ground cell (y=0) tops out just above the rock floor:
    const groundTop = 0 - 0.5 + FP_SLAB_HEIGHT;

    it("walks from a stair top onto a deck slab at the same level", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_STAIR_PX; // ascend +x across cell 4
      // The deck: slabs at the stair-top level, NOT solid blocks. The mover
      // must cross onto them instead of hitting an invisible cell wall.
      grid[fpCellIndex(5, 1, 0)] = FP_FLOOR_SLAB;
      grid[fpCellIndex(6, 1, 0)] = FP_FLOOR_SLAB;
      const s = state({ px: 3.2 });
      stepMany(s, walkPX(), grid, 300, 1 / 60);
      // Crossed the stair AND the first deck cell, feet on the slab top.
      expect(s.px).toBeGreaterThan(5);
      expect(s.py).toBeCloseTo(upperTop, 3);
      expect(s.grounded).toBe(true);
    });

    it("steps the small lip onto a ground slab and stands on its top", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 0, 0)] = FP_FLOOR_SLAB;
      const s = state();
      // 30 sixtieths carries the walk into the slab's column (px ~4.3)
      // without crossing its far edge.
      stepMany(s, walkPX(), grid, 30, 1 / 60);
      expect(s.px).toBeGreaterThan(3.9);
      expect(s.px).toBeLessThan(4.5);
      expect(s.py).toBeCloseTo(groundTop, 3);
      expect(s.grounded).toBe(true);
    });

    it("lands on a deck from a fast fall without tunneling through", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(3, 1, 0)] = FP_FLOOR_SLAB;
      const s = state({ py: 3.4, grounded: false });
      stepMany(s, input(), grid, 60, 0.05); // dt-clamped fast fall
      expect(s.py).toBeCloseTo(upperTop, 5);
      expect(s.grounded).toBe(true);
    });

    it("passes a deck from below on the way up and lands on top (one-way)", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(3, 1, 0)] = FP_FLOOR_SLAB;
      const s = state();
      stepFpMovement(s, input({ jump: true }), grid, 1 / 60);
      let apex = s.py;
      const idle = input();
      for (let n = 0; n < 240; n++) {
        stepFpMovement(s, idle, grid, 1 / 60);
        apex = Math.max(apex, s.py);
        if (s.grounded) break;
      }
      // Rose through the slab, then settled on its top instead of the floor.
      expect(apex).toBeGreaterThan(upperTop);
      expect(s.grounded).toBe(true);
      expect(s.py).toBeCloseTo(upperTop, 5);
    });

    it("walks beneath a deck a level up without snagging on it", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(4, 1, 0)] = FP_FLOOR_SLAB;
      const s = state();
      stepMany(s, walkPX(), grid, 120, 1 / 60);
      expect(s.px).toBeGreaterThan(4.5); // crossed under it
      expect(s.py).toBeCloseTo(-0.5, 5); // never lifted onto it
    });

    it("falls off the deck edge instead of floating past it", () => {
      const grid = corridorGrid();
      grid[fpCellIndex(3, 1, 0)] = FP_FLOOR_SLAB;
      const s = state({ py: upperTop });
      stepMany(s, walkPX(), grid, 180, 1 / 60);
      expect(s.px).toBeGreaterThan(4);
      expect(s.py).toBeCloseTo(-0.5, 5); // back on the room floor
    });
  });
});
