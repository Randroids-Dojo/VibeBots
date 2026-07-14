import { beforeEach, describe, expect, it, vi } from "vitest";
import { FP_CELL_COUNT } from "./bunker-fp-grid";
import {
  armFpTutorial,
  clearFpTutorialDone,
  disarmFpTutorial,
  dismissFpTutorialStep,
  FP_TUTORIAL_AUTO_ADVANCE_MS,
  FP_TUTORIAL_DONE_KEY,
  FP_TUTORIAL_ENTRY_DELAY_MS,
  FP_TUTORIAL_LOOK_RADIANS,
  FP_TUTORIAL_STEP_GAP_MS,
  type FpTutorialStorage,
  getFpTutorialCard,
  isFpTutorialDone,
  setFpTutorialStock,
  skipFpTutorial,
  subscribeFpTutorial,
  updateFpTutorial,
} from "./bunker-fp-tutorial";

function makeStorage(
  initial: Record<string, string> = {},
): FpTutorialStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Scalar observation cursor: each tick patches the previous frame's
 * values, mirroring how the rig reports continuous state. */
const obs = {
  yaw: 0,
  pitch: 0,
  px: 3,
  pz: 0,
  openCells: 34,
  partsCount: 0,
};

/** The injected test clock. */
let t = 0;

/** Advances the clock by `dt` and feeds one observation frame. */
function tick(patch: Partial<typeof obs> = {}, dt = 16): void {
  t += dt;
  Object.assign(obs, patch);
  updateFpTutorial(
    t,
    obs.yaw,
    obs.pitch,
    obs.px,
    obs.pz,
    obs.openCells,
    obs.partsCount,
  );
}

/** Arms against `storage` and rides the entry delay to the look card. */
function startAtLook(storage: FpTutorialStorage): void {
  armFpTutorial(storage);
  tick();
  tick({}, FP_TUTORIAL_ENTRY_DELAY_MS);
  expect(getFpTutorialCard()).toBe("look");
}

/** Demonstrates the current step, then rides the gap so the next card
 * is visible. */
function ride(patch: Partial<typeof obs>): void {
  tick(patch);
  expect(getFpTutorialCard()).toBeNull();
  tick({}, FP_TUTORIAL_STEP_GAP_MS);
}

describe("bunker fp tutorial state machine", () => {
  beforeEach(() => {
    disarmFpTutorial();
    setFpTutorialStock(5);
    t = 0;
    obs.yaw = 0;
    obs.pitch = 0;
    obs.px = 3;
    obs.pz = 0;
    obs.openCells = 34;
    obs.partsCount = 0;
  });

  it("shows the look card only after the entry delay from the first observed frame", () => {
    armFpTutorial(makeStorage());
    expect(getFpTutorialCard()).toBeNull();
    // The delay counts from the first update, not from arming, so a
    // slow scene compile cannot eat the settle time.
    tick({}, 500);
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_ENTRY_DELAY_MS - 1);
    expect(getFpTutorialCard()).toBeNull();
    tick({}, 1);
    expect(getFpTutorialCard()).toBe("look");
  });

  it("stays idle when the done flag is already set", () => {
    armFpTutorial(makeStorage({ [FP_TUTORIAL_DONE_KEY]: "1" }));
    tick();
    tick({}, FP_TUTORIAL_ENTRY_DELAY_MS + 5000);
    expect(getFpTutorialCard()).toBeNull();
  });

  it("advances look only after the accumulated threshold, then gaps before walk", () => {
    startAtLook(makeStorage());
    // Two 0.4 rad turns: under the threshold, the card stays.
    tick({ yaw: 0.4 });
    tick({ yaw: 0.8 });
    expect(getFpTutorialCard()).toBe("look");
    // The third crosses it (1.2 rad total); the card hides for the gap.
    tick({ yaw: FP_TUTORIAL_LOOK_RADIANS });
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_STEP_GAP_MS - 1);
    expect(getFpTutorialCard()).toBeNull();
    tick({}, 1);
    expect(getFpTutorialCard()).toBe("walk");
  });

  it("counts look travel from both yaw and pitch in either direction", () => {
    startAtLook(makeStorage());
    tick({ yaw: -0.5 });
    tick({ pitch: -0.4 });
    expect(getFpTutorialCard()).toBe("look");
    tick({ yaw: -0.15 });
    expect(getFpTutorialCard()).toBeNull();
  });

  it("advances walk on accumulated horizontal distance", () => {
    startAtLook(makeStorage());
    ride({ yaw: 1.3 });
    expect(getFpTutorialCard()).toBe("walk");
    tick({ px: 4 });
    tick({ px: 5 });
    expect(getFpTutorialCard()).toBe("walk");
    tick({ pz: -0.8 });
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_STEP_GAP_MS);
    expect(getFpTutorialCard()).toBe("dig");
  });

  it("advances dig on an open-cells increment and place on a parts-count increment", () => {
    startAtLook(makeStorage());
    ride({ yaw: 1.3 });
    ride({ px: 6 });
    expect(getFpTutorialCard()).toBe("dig");
    // Idle frames and a placement (open cells DROP) do not advance.
    tick();
    tick({ openCells: 33, partsCount: 1 });
    expect(getFpTutorialCard()).toBe("dig");
    tick({ openCells: 34 });
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_STEP_GAP_MS);
    expect(getFpTutorialCard()).toBe("place");
    tick();
    expect(getFpTutorialCard()).toBe("place");
    tick({ openCells: 33, partsCount: 2 });
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_STEP_GAP_MS);
    expect(getFpTutorialCard()).toBe("pry");
  });

  it("advances pry when the parts count drops, then completes through the closer", () => {
    const storage = makeStorage();
    startAtLook(storage);
    ride({ yaw: 1.3 });
    ride({ px: 6 });
    ride({ openCells: 35 });
    ride({ partsCount: 1 });
    expect(getFpTutorialCard()).toBe("pry");
    // Idle frames and another placement (count UP) do not advance;
    // the pry demonstration is the refunded part leaving the room.
    tick();
    tick({ partsCount: 2 });
    expect(getFpTutorialCard()).toBe("pry");
    tick({ partsCount: 1 });
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_STEP_GAP_MS);
    expect(getFpTutorialCard()).toBe("done");
    expect(storage.map.has(FP_TUTORIAL_DONE_KEY)).toBe(false);
    // The closer auto-dismisses and persists the done flag.
    tick({}, FP_TUTORIAL_AUTO_ADVANCE_MS);
    expect(getFpTutorialCard()).toBeNull();
    expect(storage.map.get(FP_TUTORIAL_DONE_KEY)).toBe("1");
    tick({ yaw: 9 });
    expect(getFpTutorialCard()).toBeNull();
  });

  it("dismissing the closer completes immediately", () => {
    const storage = makeStorage();
    startAtLook(storage);
    ride({ yaw: 1.3 });
    ride({ px: 6 });
    ride({ openCells: 35 });
    ride({ partsCount: 1 });
    ride({ partsCount: 0 });
    expect(getFpTutorialCard()).toBe("done");
    dismissFpTutorialStep(t);
    expect(getFpTutorialCard()).toBeNull();
    expect(storage.map.get(FP_TUTORIAL_DONE_KEY)).toBe("1");
  });

  it("the X skips exactly one step after the standard gap", () => {
    startAtLook(makeStorage());
    dismissFpTutorialStep(t);
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_STEP_GAP_MS - 1);
    expect(getFpTutorialCard()).toBeNull();
    tick({}, 1);
    expect(getFpTutorialCard()).toBe("walk");
    // The skipped look step never re-demands its demonstration.
    tick({ px: 6 });
    expect(getFpTutorialCard()).toBeNull();
  });

  it("skip tutorial completes the whole chain and persists via the injected storage", () => {
    const storage = makeStorage();
    startAtLook(storage);
    skipFpTutorial();
    expect(getFpTutorialCard()).toBeNull();
    expect(storage.map.get(FP_TUTORIAL_DONE_KEY)).toBe("1");
    tick({ yaw: 9, px: 9 });
    expect(getFpTutorialCard()).toBeNull();
    // Re-arming against the same storage stays idle until the replay
    // control clears the flag.
    armFpTutorial(storage);
    tick();
    tick({}, FP_TUTORIAL_ENTRY_DELAY_MS);
    expect(getFpTutorialCard()).toBeNull();
    clearFpTutorialDone(storage);
    expect(isFpTutorialDone(storage)).toBe(false);
    armFpTutorial(storage);
    tick();
    tick({}, FP_TUTORIAL_ENTRY_DELAY_MS);
    expect(getFpTutorialCard()).toBe("look");
  });

  it("shows the zero-stock place variant and auto-advances it", () => {
    setFpTutorialStock(0);
    startAtLook(makeStorage());
    ride({ yaw: 1.3 });
    ride({ px: 6 });
    ride({ openCells: 35 });
    expect(getFpTutorialCard()).toBe("place-no-stock");
    tick({}, FP_TUTORIAL_AUTO_ADVANCE_MS - 1);
    expect(getFpTutorialCard()).toBe("place-no-stock");
    tick({}, 1);
    expect(getFpTutorialCard()).toBeNull();
    // Pry with nothing placed and no stock times out the same way.
    tick({}, FP_TUTORIAL_STEP_GAP_MS);
    expect(getFpTutorialCard()).toBe("pry");
    tick({}, FP_TUTORIAL_AUTO_ADVANCE_MS);
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_STEP_GAP_MS);
    expect(getFpTutorialCard()).toBe("done");
  });

  it("auto-skips the dig step when no diggable rock remains", () => {
    startAtLook(makeStorage());
    ride({ yaw: 1.3 });
    // A fully dug volume: every cell open except the core.
    tick({ openCells: FP_CELL_COUNT - 1, px: 6 });
    expect(getFpTutorialCard()).toBeNull();
    tick({}, FP_TUTORIAL_STEP_GAP_MS);
    expect(getFpTutorialCard()).toBe("place");
  });

  it("notifies subscribers only when the visible card changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFpTutorial(listener);
    armFpTutorial(makeStorage());
    expect(listener).not.toHaveBeenCalled();
    tick();
    tick({}, FP_TUTORIAL_ENTRY_DELAY_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    // Steady-state frames while a card is up notify nobody.
    tick();
    tick();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("disarm drops an in-progress run without persisting", () => {
    const storage = makeStorage();
    startAtLook(storage);
    disarmFpTutorial();
    expect(getFpTutorialCard()).toBeNull();
    expect(storage.map.has(FP_TUTORIAL_DONE_KEY)).toBe(false);
    // The next entry starts over from look.
    armFpTutorial(storage);
    tick();
    tick({}, FP_TUTORIAL_ENTRY_DELAY_MS);
    expect(getFpTutorialCard()).toBe("look");
  });
});
