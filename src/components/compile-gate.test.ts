import type { Camera, Object3D } from "three/webgpu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFramesAfterCompile } from "./compile-gate";

const SCENE = {} as Object3D;
const CAMERA = {} as Camera;

describe("startFramesAfterCompile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts frames once when the compile resolves", async () => {
    const onCompiled = vi.fn();
    let resolve = () => {};
    const compiled = new Promise<void>((r) => {
      resolve = r;
    });
    startFramesAfterCompile(
      { compileAsync: () => compiled },
      SCENE,
      CAMERA,
      onCompiled,
    );
    expect(onCompiled).not.toHaveBeenCalled();
    resolve();
    await compiled;
    expect(onCompiled).toHaveBeenCalledTimes(1);
    // The deadline firing later must not call it again.
    vi.runAllTimers();
    expect(onCompiled).toHaveBeenCalledTimes(1);
  });

  it("starts frames at the deadline when the compile never settles", () => {
    const onCompiled = vi.fn();
    startFramesAfterCompile(
      { compileAsync: () => new Promise(() => {}) },
      SCENE,
      CAMERA,
      onCompiled,
      4000,
    );
    vi.advanceTimersByTime(3999);
    expect(onCompiled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCompiled).toHaveBeenCalledTimes(1);
  });

  it("starts frames once when the compile rejects", async () => {
    const onCompiled = vi.fn();
    const compiled = Promise.reject(new Error("device lost"));
    startFramesAfterCompile(
      { compileAsync: () => compiled },
      SCENE,
      CAMERA,
      onCompiled,
    );
    await compiled.catch(() => {});
    expect(onCompiled).toHaveBeenCalledTimes(1);
  });

  it("starts frames immediately without compileAsync or when it throws", () => {
    const plain = vi.fn();
    startFramesAfterCompile({}, SCENE, CAMERA, plain);
    expect(plain).toHaveBeenCalledTimes(1);

    const throwing = vi.fn();
    startFramesAfterCompile(
      {
        compileAsync: () => {
          throw new Error("no context");
        },
      },
      SCENE,
      CAMERA,
      throwing,
    );
    expect(throwing).toHaveBeenCalledTimes(1);
  });

  it("never fires after cancel", async () => {
    const onCompiled = vi.fn();
    let resolve = () => {};
    const compiled = new Promise<void>((r) => {
      resolve = r;
    });
    const cancel = startFramesAfterCompile(
      { compileAsync: () => compiled },
      SCENE,
      CAMERA,
      onCompiled,
    );
    cancel();
    resolve();
    await compiled;
    vi.runAllTimers();
    expect(onCompiled).not.toHaveBeenCalled();
  });
});
