"use client";

import type { RigidBody } from "@dimforge/rapier3d-deterministic-compat";
import { Canvas, useFrame } from "@react-three/fiber";
import { type RefObject, useEffect, useRef } from "react";
import { type Mesh, Quaternion, Vector3, WebGPURenderer } from "three/webgpu";
import { DT } from "@/sim/constants";
import { createSimWorld, type SimWorld, stepSim } from "@/sim/world";

const SIM_SEED = 42;
/** Clamp on accumulated frame time so a background tab cannot spiral. */
const MAX_FRAME_DELTA = 0.25;

interface BodyView {
  prevPos: Vector3;
  currPos: Vector3;
  prevRot: Quaternion;
  currRot: Quaternion;
}

function newBodyView(): BodyView {
  return {
    prevPos: new Vector3(),
    currPos: new Vector3(),
    prevRot: new Quaternion(),
    currRot: new Quaternion(),
  };
}

function readBody(view: BodyView, body: RigidBody): void {
  const t = body.translation();
  const r = body.rotation();
  view.currPos.set(t.x, t.y, t.z);
  view.currRot.set(r.x, r.y, r.z, r.w);
}

function copyCurrToPrev(view: BodyView): void {
  view.prevPos.copy(view.currPos);
  view.prevRot.copy(view.currRot);
}

function applyView(mesh: Mesh | null, view: BodyView, alpha: number): void {
  if (!mesh) return;
  mesh.position.lerpVectors(view.prevPos, view.currPos, alpha);
  mesh.quaternion.slerpQuaternions(view.prevRot, view.currRot, alpha);
}

function SimScene({
  stageRef,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const simRef = useRef<SimWorld | null>(null);
  const accumulatorRef = useRef(0);
  const viewsRef = useRef({ box: newBodyView(), ball: newBodyView() });
  const boxMeshRef = useRef<Mesh>(null);
  const ballMeshRef = useRef<Mesh>(null);

  useEffect(() => {
    // Strict mode mounts effects twice in dev; each mount owns its own
    // world and frees it on cleanup, so no WASM memory leaks.
    let disposed = false;
    let created: SimWorld | null = null;
    createSimWorld(SIM_SEED).then((sim) => {
      if (disposed) {
        sim.world.free();
        return;
      }
      created = sim;
      simRef.current = sim;
      const views = viewsRef.current;
      readBody(views.box, sim.bodies.box);
      readBody(views.ball, sim.bodies.ball);
      copyCurrToPrev(views.box);
      copyCurrToPrev(views.ball);
    });
    return () => {
      disposed = true;
      if (created) created.world.free();
      simRef.current = null;
    };
  }, []);

  useFrame((_, delta) => {
    const sim = simRef.current;
    if (!sim) return;
    const views = viewsRef.current;

    accumulatorRef.current = Math.min(
      accumulatorRef.current + delta,
      MAX_FRAME_DELTA,
    );
    let stepped = false;
    while (accumulatorRef.current >= DT) {
      copyCurrToPrev(views.box);
      copyCurrToPrev(views.ball);
      stepSim(sim);
      readBody(views.box, sim.bodies.box);
      readBody(views.ball, sim.bodies.ball);
      accumulatorRef.current -= DT;
      stepped = true;
    }

    const alpha = accumulatorRef.current / DT;
    applyView(boxMeshRef.current, views.box, alpha);
    applyView(ballMeshRef.current, views.ball, alpha);

    if (stepped) {
      stageRef.current?.setAttribute("data-sim-tick", String(sim.tick));
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 3]} intensity={1.4} />
      <mesh ref={boxMeshRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ff9f43" flatShading />
      </mesh>
      <mesh ref={ballMeshRef}>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial color="#54e0c7" flatShading />
      </mesh>
      <mesh position={[0, -0.5, 0]}>
        <boxGeometry args={[20, 1, 20]} />
        <meshStandardMaterial color="#2f3640" flatShading />
      </mesh>
    </>
  );
}

export default function SimCanvas() {
  const stageRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={stageRef}
      data-sim-tick="0"
      style={{ width: "100%", height: "100dvh" }}
    >
      <Canvas
        camera={{ position: [5, 4, 7], fov: 45 }}
        gl={async (glProps) => {
          const renderer = new WebGPURenderer(
            glProps as ConstructorParameters<typeof WebGPURenderer>[0],
          );
          await renderer.init();
          return renderer;
        }}
      >
        <color attach="background" args={["#0b0e14"]} />
        <SimScene stageRef={stageRef} />
      </Canvas>
    </div>
  );
}
