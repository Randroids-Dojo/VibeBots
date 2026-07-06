import { afterEach, describe, expect, it } from "vitest";
import {
  collectCanvasDiagnostics,
  collectRendererInfo,
  collectSceneStats,
  readPerfProbe,
  registerPerfProbe,
  unregisterPerfProbe,
} from "./perf-probe";

interface FakeNode {
  visible?: boolean;
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isLight?: boolean;
  isSprite?: boolean;
  castShadow?: boolean;
  count?: number;
  type?: string;
  material?: object | object[];
  geometry?: object;
}

function fakeScene(nodes: FakeNode[]) {
  return {
    traverse(callback: (object: unknown) => void) {
      for (const node of nodes) callback(node);
    },
  };
}

describe("collectSceneStats", () => {
  it("counts meshes, instances, lights, and unique materials", () => {
    const sharedMaterial = {};
    const stats = collectSceneStats(
      fakeScene([
        { isMesh: true, material: sharedMaterial },
        { isMesh: true, material: sharedMaterial },
        { isMesh: true, material: [{}, {}] },
        { isInstancedMesh: true, isMesh: true, count: 120, material: {} },
        {
          isLight: true,
          type: "PointLight",
          castShadow: false,
        },
        { isLight: true, type: "DirectionalLight", castShadow: true },
        { isSprite: true, visible: false },
      ]),
    );
    expect(stats.meshCount).toBe(4);
    expect(stats.instancedMeshCount).toBe(1);
    expect(stats.instanceCount).toBe(120);
    expect(stats.lightCount).toBe(2);
    expect(stats.shadowLightCount).toBe(1);
    expect(stats.spriteCount).toBe(1);
    expect(stats.visibleObjectCount).toBe(6);
    expect(stats.materialCount).toBe(4);
    expect(stats.lightsByType).toEqual({
      PointLight: 1,
      DirectionalLight: 1,
    });
  });
});

describe("collectRendererInfo", () => {
  it("reads render and memory counters defensively", () => {
    expect(
      collectRendererInfo({
        render: { calls: 42, triangles: 90_000 },
        memory: { geometries: 12, textures: "bad" },
      }),
    ).toEqual({
      drawCalls: 42,
      triangles: 90_000,
      geometries: 12,
      textures: null,
    });
    expect(collectRendererInfo(undefined)).toEqual({
      drawCalls: null,
      triangles: null,
      geometries: null,
      textures: null,
    });
  });
});

describe("collectCanvasDiagnostics", () => {
  it("keeps only allowlisted dataset keys", () => {
    expect(
      collectCanvasDiagnostics({
        frameMs: "16.2",
        particleCount: "12",
        timeOfDay: "day",
        minerX: "4.00",
        camX: "1.00",
        renderer: "webgpu-auto",
      }),
    ).toEqual({ frameMs: "16.2", particleCount: "12", timeOfDay: "day" });
  });
});

describe("probe registry", () => {
  afterEach(() => unregisterPerfProbe("mine"));

  it("returns null when no probe is registered", () => {
    expect(readPerfProbe("mine")).toBeNull();
  });

  it("returns the registered probe sample and swallows probe errors", () => {
    registerPerfProbe("mine", () => {
      throw new Error("probe blew up");
    });
    expect(readPerfProbe("mine")).toBeNull();
  });
});
