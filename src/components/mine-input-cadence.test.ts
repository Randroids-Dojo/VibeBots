import { describe, expect, it } from "vitest";
import {
  type CadenceClock,
  createDirectionCadenceController,
} from "./mine-input-cadence";

function testClock() {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: CadenceClock = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = nextTimerId++;
      timers.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout: (timer) => {
      timers.delete(timer);
    },
  };
  return {
    clock,
    advance: (ms: number) => {
      const target = now + ms;
      while (true) {
        let next:
          | {
              id: number;
              at: number;
              callback: () => void;
            }
          | undefined;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (!next || timer.at < next.at) {
            next = { id, at: timer.at, callback: timer.callback };
          }
        }
        if (!next) break;
        now = next.at;
        timers.delete(next.id);
        next.callback();
      }
      now = target;
    },
  };
}

describe("mine input cadence", () => {
  it("fires the first press immediately", () => {
    const actions: string[] = [];
    const { clock } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
    });

    expect(cadence.press("right", 620)).toBe(true);

    expect(actions).toEqual(["right"]);
  });

  it("rapid taps never fire before the next legal action time", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
    });

    // Three taps inside one 620ms window: the first fires immediately,
    // the rest collapse into ONE buffered action that lands exactly at
    // the legal time. Tapping is never faster than holding.
    cadence.press("right", 620);
    cadence.release("right");
    advance(200);
    cadence.press("right", 620);
    cadence.release("right");
    advance(300);
    cadence.press("right", 620);
    cadence.release("right");
    advance(119);

    expect(actions).toEqual(["right"]);

    advance(1);
    expect(actions).toEqual(["right", "right"]);

    // The buffer holds one action, never banks more.
    advance(1240);
    expect(actions).toEqual(["right", "right"]);
  });

  it("remembers a tap made during the cooldown and fires it once", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
    });

    cadence.press("right", 620);
    cadence.release("right");
    advance(300);
    cadence.press("right", 620);
    cadence.release("right");
    advance(319);
    expect(actions).toEqual(["right"]);
    advance(1);
    expect(actions).toEqual(["right", "right"]);
  });

  it("cancels a buffered tap with the opposite direction", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
      isOpposite: (a, b) =>
        (a === "right" && b === "left") || (a === "left" && b === "right"),
    });

    cadence.press("right", 620);
    cadence.release("right");
    advance(200);
    cadence.press("right", 620);
    cadence.release("right");
    advance(100);
    cadence.press("left", 620);
    cadence.release("left");
    advance(2000);

    // The opposite tap erased the pending move: net zero, not a left.
    expect(actions).toEqual(["right"]);
  });

  it("a held opposite still moves after cancelling the buffered tap", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
      isOpposite: (a, b) =>
        (a === "right" && b === "left") || (a === "left" && b === "right"),
    });

    cadence.press("right", 620);
    cadence.release("right");
    advance(200);
    cadence.press("right", 620);
    cadence.release("right");
    advance(100);
    cadence.press("left", 620);
    advance(400);

    // Holding is intent: the buffered right was cancelled, and the held
    // left fires at the legal time.
    expect(actions).toEqual(["right", "left"]);
  });

  it("OS keydown repeats never leave a trailing buffered step", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
    });

    cadence.press("right", 620);
    for (let i = 0; i < 4; i++) {
      advance(100);
      cadence.press("right", 620);
    }
    cadence.release("right");
    advance(2000);

    // The auto-repeat presses of an already-held key are not new intent:
    // releasing before the gate opens means no extra step fires.
    expect(actions).toEqual(["right"]);
  });

  it("reports auto-repeat only for the second and later held firings", () => {
    const flags: Array<[string, boolean]> = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string, isAutoRepeat: boolean) => {
        flags.push([input, isAutoRepeat]);
        return true;
      },
    });

    // Fresh press fires as deliberate; held repeats are auto.
    cadence.press("up", 620);
    advance(620);
    advance(620);
    cadence.release("up");
    expect(flags).toEqual([
      ["up", false],
      ["up", true],
      ["up", true],
    ]);

    // A press during the cooldown that stays held fires nothing early;
    // its FIRST action lands at the legal time as deliberate (the player
    // pressed), then repeats as auto.
    flags.length = 0;
    cadence.press("up", 620);
    expect(flags).toEqual([]);
    advance(620);
    expect(flags).toEqual([["up", false]]);
    advance(620);
    expect(flags).toEqual([
      ["up", false],
      ["up", true],
    ]);
    cadence.release("up");
  });

  it("keeps firing while held at the shared cadence", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
    });

    cadence.press("down", 620);
    advance(619);
    expect(actions).toEqual(["down"]);

    advance(1);
    expect(actions).toEqual(["down", "down"]);

    advance(620);
    expect(actions).toEqual(["down", "down", "down"]);
  });

  it("does not let repeated keydown events delay the held timer", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
    });

    cadence.press("right", 620);
    for (let i = 0; i < 5; i++) {
      advance(100);
      cadence.press("right", 620);
    }
    advance(120);

    expect(actions).toEqual(["right", "right"]);
  });

  it("uses the newest direction when held input changes before cadence opens", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
    });

    cadence.press("right", 620);
    advance(250);
    cadence.press("down", 620);
    advance(370);

    expect(actions).toEqual(["right", "down"]);
  });

  it("survives timers that fire a hair early while held", () => {
    // Real browsers under load can run a timer callback fractionally
    // before its due time. The held chain must reschedule through the
    // miss instead of silently dying (a stalled dig on loaded devices).
    let now = 0;
    let nextTimerId = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const jitteryClock: CadenceClock = {
      now: () => now,
      setTimeout: (callback, delayMs) => {
        const id = nextTimerId++;
        // Fire 1ms before the requested delay, but like real browsers,
        // never at zero delay (timers always advance the clock).
        timers.set(id, { at: now + Math.max(1, delayMs - 1), callback });
        return id;
      },
      clearTimeout: (timer) => {
        timers.delete(timer);
      },
    };
    const advance = (ms: number) => {
      const target = now + ms;
      while (true) {
        let next: { id: number; at: number; callback: () => void } | undefined;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (!next || timer.at < next.at) {
            next = { id, at: timer.at, callback: timer.callback };
          }
        }
        if (!next) break;
        now = next.at;
        timers.delete(next.id);
        next.callback();
      }
      now = target;
    };
    const actions: number[] = [];
    const controller = createDirectionCadenceController<string>({
      clock: jitteryClock,
      onAction: () => {
        actions.push(now);
        return true;
      },
    });
    controller.press("down", 100);
    advance(1000);
    controller.release("down");
    // One immediate action plus repeats roughly every 100ms; the early
    // firings must not kill the chain after the first repeat.
    expect(actions.length).toBeGreaterThanOrEqual(9);
  });

  it("an OS repeat press while the gate is open stays auto-repeat", () => {
    // Browsers can run the keydown-repeat task before the held timer's
    // callback even after nextActionAt has passed. That repeat press is
    // a continuation of the hold: it must report isAutoRepeat so the
    // panel's ladder rule cannot be defeated by holding "up".
    let now = 0;
    let nextTimerId = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const lateClock: CadenceClock = {
      now: () => now,
      setTimeout: (callback, delayMs) => {
        const id = nextTimerId++;
        // Fire 50ms late, like a dilated timer on a loaded main thread.
        timers.set(id, { at: now + delayMs + 50, callback });
        return id;
      },
      clearTimeout: (timer) => {
        timers.delete(timer);
      },
    };
    const advanceWithoutTimers = (ms: number) => {
      now += ms;
    };
    const flags: boolean[] = [];
    const cadence = createDirectionCadenceController<string>({
      clock: lateClock,
      onAction: (_input, isAutoRepeat) => {
        flags.push(isAutoRepeat);
        return true;
      },
    });

    cadence.press("up", 620);
    expect(flags).toEqual([false]);
    // The gate opens at 620 but the held timer (due 670) has not run yet
    // when the OS keydown repeat re-enters press().
    advanceWithoutTimers(620);
    cadence.press("up", 620);
    expect(flags).toEqual([false, true]);
  });

  it("release cancels the pending held action", () => {
    const actions: string[] = [];
    const { clock, advance } = testClock();
    const cadence = createDirectionCadenceController({
      clock,
      onAction: (input: string) => {
        actions.push(input);
        return true;
      },
    });

    cadence.press("left", 620);
    advance(300);
    cadence.release("left");
    advance(620);

    expect(actions).toEqual(["left"]);
  });
});
