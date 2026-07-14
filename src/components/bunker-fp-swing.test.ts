import { describe, expect, it } from "vitest";
import {
  advanceFpSwing,
  createFpSwingState,
  FP_SWING_IMPACT,
  FP_SWING_SECONDS,
  fpSwingThrow,
  startFpSwing,
} from "./bunker-fp-swing";

/** Advance in small steps, returning how many strikes landed. */
function run(
  state: ReturnType<typeof createFpSwingState>,
  seconds: number,
  held: boolean,
  step = 1 / 60,
): number {
  let strikes = 0;
  for (let t = 0; t < seconds; t += step) {
    if (advanceFpSwing(state, step, held)) strikes++;
  }
  return strikes;
}

describe("startFpSwing", () => {
  it("begins a fresh swing", () => {
    const s = createFpSwingState();
    startFpSwing(s);
    expect(s.active).toBe(true);
    expect(s.t).toBe(0);
    expect(s.struck).toBe(false);
  });

  it("does not restart or rewind a swing already in progress", () => {
    const s = createFpSwingState();
    startFpSwing(s);
    advanceFpSwing(s, 0.1, false);
    const t = s.t;
    startFpSwing(s);
    expect(s.t).toBe(t);
  });
});

describe("advanceFpSwing", () => {
  it("is inert until a swing starts", () => {
    const s = createFpSwingState();
    expect(advanceFpSwing(s, 0.1, true)).toBe(false);
    expect(s.active).toBe(false);
  });

  it("strikes exactly once, at impact", () => {
    const s = createFpSwingState();
    startFpSwing(s);
    // Before impact: no strike.
    expect(
      advanceFpSwing(s, FP_SWING_SECONDS * FP_SWING_IMPACT * 0.5, false),
    ).toBe(false);
    // Crossing impact: one strike.
    expect(advanceFpSwing(s, FP_SWING_SECONDS * FP_SWING_IMPACT, false)).toBe(
      true,
    );
    // Rest of the swing: no further strike.
    expect(advanceFpSwing(s, FP_SWING_SECONDS, false)).toBe(false);
  });

  it("goes idle after one swing when the input is released", () => {
    const s = createFpSwingState();
    startFpSwing(s);
    const strikes = run(s, FP_SWING_SECONDS * 1.2, false);
    expect(strikes).toBe(1);
    expect(s.active).toBe(false);
  });

  it("auto-restarts and keeps striking while held", () => {
    const s = createFpSwingState();
    startFpSwing(s);
    // Three full swings worth of held time yields three strikes.
    const strikes = run(s, FP_SWING_SECONDS * 3 + 0.01, true);
    expect(strikes).toBe(3);
    expect(s.active).toBe(true);
  });
});

describe("fpSwingThrow", () => {
  it("is zero when idle", () => {
    expect(fpSwingThrow(createFpSwingState())).toBe(0);
  });

  it("peaks at 1 exactly at impact", () => {
    const s = createFpSwingState();
    startFpSwing(s);
    advanceFpSwing(s, FP_SWING_SECONDS * FP_SWING_IMPACT, false);
    expect(fpSwingThrow(s)).toBeCloseTo(1, 5);
  });

  it("rises from 0 on the chop and falls back toward 0 on recovery", () => {
    const s = createFpSwingState();
    startFpSwing(s);
    // A quarter of the way to impact: partway up, below the peak.
    advanceFpSwing(s, FP_SWING_SECONDS * FP_SWING_IMPACT * 0.25, false);
    const rising = fpSwingThrow(s);
    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(1);
    // Near the end of the swing (~85% through): eased well back down.
    advanceFpSwing(s, FP_SWING_SECONDS * 0.75, false);
    expect(fpSwingThrow(s)).toBeLessThan(0.5);
  });
});
