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
  type FpMoveInput,
  type FpMoveState,
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
});
