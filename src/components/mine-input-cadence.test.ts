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

  it("does not let rapid tap release beat the cadence", () => {
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
    advance(200);
    cadence.press("right", 620);
    cadence.release("right");
    advance(300);
    cadence.press("right", 620);
    cadence.release("right");
    advance(119);

    expect(actions).toEqual(["right"]);

    advance(1);
    cadence.press("right", 620);

    expect(actions).toEqual(["right", "right"]);
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
