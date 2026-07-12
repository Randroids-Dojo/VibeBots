"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { Camera, Object3D } from "three/webgpu";

/** A compile that outlives this deadline starts frames anyway: a stalled
 * driver must degrade to the old lazy-compile stall, never to a canvas
 * frozen at frameloop="never". Generous next to real compile times (the
 * whole holodeck set is ~3 s on software rendering, far less on GPUs). */
export const COMPILE_GATE_DEADLINE_MS = 4000;

interface CompileCapableRenderer {
  compileAsync?: (scene: Object3D, camera: Camera) => Promise<unknown>;
}

/**
 * Kicks a background compile of the mounted scene and calls onCompiled
 * exactly once when it settles, when it fails, when the renderer cannot
 * compile asynchronously, or when the deadline passes, whichever comes
 * first. Returns a cancel function; after cancel, onCompiled never fires.
 */
export function startFramesAfterCompile(
  gl: CompileCapableRenderer,
  scene: Object3D,
  camera: Camera,
  onCompiled: () => void,
  deadlineMs: number = COMPILE_GATE_DEADLINE_MS,
): () => void {
  let compiled: Promise<unknown> | undefined;
  try {
    compiled = gl.compileAsync?.(scene, camera);
  } catch {
    compiled = undefined;
  }
  return startFramesWhenSettled(compiled, onCompiled, deadlineMs);
}

/**
 * The settle-or-deadline race behind the gate, for callers that already
 * hold a compile promise (the mine's warm pass runs its own compileAsync
 * over the warm group, F-081). onStart fires exactly once when the
 * promise settles either way, or at the deadline, or immediately when
 * there is no promise; after cancel it never fires.
 */
export function startFramesWhenSettled(
  compiled: Promise<unknown> | null | undefined,
  onStart: () => void,
  deadlineMs: number = COMPILE_GATE_DEADLINE_MS,
): () => void {
  let settled = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (deadline !== undefined) clearTimeout(deadline);
    onStart();
  };
  if (compiled) {
    deadline = setTimeout(finish, deadlineMs);
    compiled.then(finish, finish);
  } else {
    finish();
  }
  return () => {
    settled = true;
    if (deadline !== undefined) clearTimeout(deadline);
  };
}

/**
 * Compiles every material in the mounted scene, then reports done (F-072).
 *
 * Mount inside a Canvas whose frameloop prop is "never" until onCompiled
 * fires, then "always" (the prop must change through React state: R3F
 * reconciles the prop on every parent re-render, so poking the store
 * directly gets reverted by the next render). Without the gate, the first
 * rendered frame compiles the whole mounted scene synchronously on the
 * main thread: navigating from the mine to the holodeck froze the page
 * for the full compile, the worst first-view long task of any surface in
 * the telemetry. compileAsync routes the same compiles through the
 * driver's parallel-compile path while the page stays responsive; the
 * canvas shows its backdrop for the beat the compile needs and then
 * animates as before.
 *
 * Best-effort in every direction: a renderer without compileAsync, a
 * rejected compile, or one that never settles (COMPILE_GATE_DEADLINE_MS)
 * all start frames and fall back to lazy compilation as before.
 */
export function StartFramesWhenCompiled({
  onCompiled,
}: {
  onCompiled: () => void;
}) {
  const gl = useThree((state) => state.gl) as CompileCapableRenderer;
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  useEffect(
    () => startFramesAfterCompile(gl, scene, camera, onCompiled),
    [gl, scene, camera, onCompiled],
  );
  return null;
}
