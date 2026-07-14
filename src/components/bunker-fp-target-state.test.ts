import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getFpBoxedInSnapshot,
  resetFpBoxedIn,
  setFpBoxedIn,
  subscribeFpBoxedIn,
} from "./bunker-fp-target-state";

describe("fp boxed-in mini-store", () => {
  afterEach(() => {
    resetFpBoxedIn();
  });

  it("notifies subscribers only when the value actually changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFpBoxedIn(listener);

    setFpBoxedIn(false);
    expect(listener).not.toHaveBeenCalled();

    setFpBoxedIn(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getFpBoxedInSnapshot()).toBe(true);

    setFpBoxedIn(true);
    expect(listener).toHaveBeenCalledTimes(1);

    resetFpBoxedIn();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getFpBoxedInSnapshot()).toBe(false);

    unsubscribe();
    setFpBoxedIn(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
