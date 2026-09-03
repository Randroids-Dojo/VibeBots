import type { EventManager } from "@react-three/fiber";
import { events as createPointerEvents } from "@react-three/fiber";

type Store = Parameters<typeof createPointerEvents>[0];

/**
 * The fiber's pointer-event manager, with one guard: connecting to no
 * element is a no-op instead of a crash.
 *
 * The Canvas awaits the renderer factory (WebGPU init is async) and only
 * then runs its created-callback, which connects the pointer events to the
 * wrapper div. If the canvas unmounted while the init was pending, which
 * happens when a fight starts within the first second on the workshop
 * bench, or the player leaves the arena as fast, that div ref is already
 * null and the fiber's own connect calls addEventListener on it (F-248).
 * Nothing is lost by skipping the connect: the canvas that would have
 * received the events is gone.
 */
export function createGuardedEvents(store: Store): EventManager<HTMLElement> {
  const manager = createPointerEvents(store);
  const connect = manager.connect;
  return {
    ...manager,
    connect: (target: HTMLElement | null) => {
      if (!target || !connect) return;
      connect(target);
    },
  };
}
