"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  PMREMGenerator,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { isWebGPUBackend } from "./graphics-quality";

/** One filtered environment per renderer lifetime: canvases remount far
 * more often than renderers change, and regenerating the PMREM on every
 * mount churned GPU memory enough to kill canvas creation mid-suite. */
const environmentCache = new WeakMap<object, Texture>();

function environmentFor(gl: object): Texture | null {
  const cached = environmentCache.get(gl);
  if (cached) return cached;
  // WebGPU backend only: on the WebGL2 fallback the PMREM pass issues
  // synchronous ReadPixels stalls that can freeze the main thread for
  // seconds on weak GPUs (exactly the devices the fallback serves). The
  // fallback path gets a prebaked environment in the G2 slice instead.
  if (!isWebGPUBackend(gl)) return null;
  try {
    const generator = new PMREMGenerator(gl as WebGPURenderer);
    const target = generator.fromScene(new RoomEnvironment(), 0.04);
    generator.dispose();
    environmentCache.set(gl, target.texture);
    return target.texture;
  } catch {
    // A failed environment must never take the scene down: the lights
    // still carry it, just without image-based ambience.
    return null;
  }
}

/**
 * Zero-download image-based lighting (graphics slice G1): the built-in
 * neutral studio room, PMREM-filtered once per renderer and applied as
 * the scene environment. Every standard/physical material gains ambient
 * response and reflections, which is most of what makes metals and
 * crystals read as real. The same trick carries the "one-shot" demo
 * look this program is chasing, and it costs no network and compiles on
 * both the WebGPU backend and the WebGL2 fallback.
 */
export function StudioEnvironment({ intensity = 0.6 }: { intensity?: number }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    // Deferred a beat so the first canvas paint never waits on the
    // environment generation.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const texture = environmentFor(gl);
      if (!texture) return;
      scene.environment = texture;
      scene.environmentIntensity = intensity;
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      scene.environment = null;
    };
  }, [gl, scene, intensity]);

  return null;
}
