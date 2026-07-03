"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";
import { distance, oneMinus, pass, uv, vec2 } from "three/tsl";
import { PostProcessing, type WebGPURenderer } from "three/webgpu";

/**
 * Graphics slice G3: the three-native TSL post stack. Bloom lets every
 * emissive authored since G1 (crystal glow, gas membranes, magma, the
 * headlamp) actually cast light into the frame, and a soft vignette
 * grades the edges down so the lit center holds the eye.
 *
 * Mounted only on the WebGPU backend's high tier: the WebGL2 fallback
 * keeps the direct render it can afford (the G2 slice proved even one
 * extra per-fragment node freezes the machines that path serves). While
 * this component is mounted it takes over the frame's final render via
 * a priority-1 useFrame; unmounting hands the loop back to R3F.
 */
export function ScenePostProcessing() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const postRef = useRef<PostProcessing | null>(null);

  useEffect(() => {
    const renderer = gl as unknown as WebGPURenderer;
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode();
    const glow = bloom(sceneColor, 0.32, 0.35, 0.82);
    const vignette = oneMinus(
      distance(uv(), vec2(0.5, 0.5)).sub(0.34).max(0).mul(0.5),
    );
    const post = new PostProcessing(
      renderer,
      sceneColor.add(glow).mul(vignette),
    );
    postRef.current = post;
    gl.domElement.dataset.postStack = "bloom";
    return () => {
      postRef.current = null;
      scenePass.dispose();
      gl.domElement.dataset.postStack = "off";
    };
  }, [gl, scene, camera]);

  // Priority 1 replaces R3F's default render while mounted; the guard
  // keeps a frame from going dark during effect teardown ordering.
  useFrame(() => {
    if (postRef.current) {
      postRef.current.render();
    } else {
      (gl as unknown as WebGPURenderer).render(scene, camera);
    }
  }, 1);

  return null;
}
