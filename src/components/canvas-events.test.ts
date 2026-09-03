import { describe, expect, it, vi } from "vitest";
import { createGuardedEvents } from "./canvas-events";

type Store = Parameters<typeof createGuardedEvents>[0];

// The manager only reads the store when a pointer event fires or the events
// connect, so a stub that hands back the pieces connect touches is enough.
function makeStore() {
  const state = {
    events: {} as Record<string, unknown>,
    set: vi.fn((update: (s: unknown) => unknown) => {
      Object.assign(state, update(state));
    }),
  };
  return {
    getState: () => state,
    state,
  } as unknown as Store & { state: typeof state };
}

describe("createGuardedEvents", () => {
  it("connects to a real element the way the fiber's manager does (F-248)", () => {
    const store = makeStore();
    const manager = createGuardedEvents(store);
    // The fiber keeps the manager itself in state.events; connect reads its
    // handlers from there.
    store.state.events = manager as unknown as Record<string, unknown>;
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    manager.connect?.(target);
    expect(
      (target.addEventListener as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it("treats a missing element as nothing to connect to instead of crashing (F-248)", () => {
    const store = makeStore();
    const manager = createGuardedEvents(store);
    // The fiber passes its wrapper div ref, which is null once the canvas
    // unmounted while the async renderer init was still pending.
    expect(() =>
      manager.connect?.(null as unknown as HTMLElement),
    ).not.toThrow();
    expect(store.state.set).not.toHaveBeenCalled();
  });
});
