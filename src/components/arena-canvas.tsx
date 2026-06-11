"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type Group,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { createArenaWorld } from "@/sim/arena";
import {
  createMatch,
  freeMatch,
  type MatchState,
  stepMatch,
} from "@/sim/combat";
import { DT } from "@/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "@/sim/design";
import { PART_CATALOG, type PartShape } from "@/sim/parts";

/** Clamp on accumulated frame time so a background tab cannot spiral. */
const MAX_FRAME_DELTA = 0.25;
/** Seconds to linger on the end banner before the next exhibition match. */
const RESTART_DELAY_SECONDS = 4;

const BOT_COLORS = ["#ff9f43", "#54e0c7"] as const;
const BOT_COLORS_DESTROYED = ["#6b4a26", "#2a5a52"] as const;
/** Rammer at index 1: its spike (front connector, -z) faces the enemy. */
const EXHIBITION_DESIGNS = [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN] as const;

interface ArenaRun {
  match: MatchState;
  dispose: () => void;
}

async function bootMatch(): Promise<ArenaRun> {
  const world = await createArenaWorld();
  const match = createMatch(world, [
    EXHIBITION_DESIGNS[0],
    EXHIBITION_DESIGNS[1],
  ]);
  return {
    match,
    dispose: () => {
      freeMatch(match);
      world.free();
    },
  };
}

export interface HudPartPip {
  iid: string;
  healthRatio: number;
  destroyed: boolean;
}

export interface HudBot {
  label: string;
  healthPercent: number;
  partsRemaining: number;
  partCount: number;
  pips: HudPartPip[];
}

export interface HudState {
  bots: [HudBot, HudBot];
  banner: string | null;
}

function readHud(match: MatchState): HudState {
  const labels = match.bots.map((bot) => bot.design.name);
  const bots = match.bots.map((bot, index) => {
    let health = 0;
    let maxHealth = 0;
    let partsRemaining = 0;
    const pips: HudPartPip[] = [];
    for (const part of bot.design.parts) {
      const state = bot.parts.get(part.iid);
      if (!state) continue;
      health += state.health;
      maxHealth += state.maxHealth;
      if (!state.destroyed) partsRemaining += 1;
      pips.push({
        iid: part.iid,
        healthRatio: state.maxHealth > 0 ? state.health / state.maxHealth : 0,
        destroyed: state.destroyed,
      });
    }
    return {
      label: labels[index],
      healthPercent: maxHealth > 0 ? Math.round((health / maxHealth) * 100) : 0,
      partsRemaining,
      partCount: bot.parts.size,
      pips,
    };
  }) as [HudBot, HudBot];

  let banner: string | null = null;
  const status = match.status;
  if (status.over) {
    const detail =
      status.reason === "timeout"
        ? ` (${Math.round(status.scores[0].total)} vs ${Math.round(status.scores[1].total)})`
        : "";
    banner =
      status.winner === null
        ? `Draw by ${status.reason}${detail}`
        : `${labels[status.winner]} wins by ${status.reason}${detail}`;
  }
  return { bots, banner };
}

interface PartView {
  prevPos: Vector3;
  currPos: Vector3;
  prevRot: Quaternion;
  currRot: Quaternion;
}

function newPartView(): PartView {
  return {
    prevPos: new Vector3(),
    currPos: new Vector3(),
    prevRot: new Quaternion(),
    currRot: new Quaternion(),
  };
}

function partGeometry(shape: PartShape) {
  switch (shape.type) {
    case "cuboid":
      return <boxGeometry args={[shape.hx * 2, shape.hy * 2, shape.hz * 2]} />;
    case "ball":
      return <icosahedronGeometry args={[shape.radius, 1]} />;
    case "cylinder":
      return (
        <cylinderGeometry
          args={[shape.radius, shape.radius, shape.halfHeight * 2, 14]}
        />
      );
  }
}

/** Mesh-local rotation matching the collider's axis reorientation. */
function shapeRotation(shape: PartShape): [number, number, number] {
  if (shape.type === "cylinder" && shape.axis === "x") {
    return [0, 0, Math.PI / 2];
  }
  if (shape.type === "cylinder" && shape.axis === "z") {
    return [Math.PI / 2, 0, 0];
  }
  return [0, 0, 0];
}

function ArenaScene({
  stageRef,
  onHud,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  onHud: (hud: HudState) => void;
}) {
  const runRef = useRef<ArenaRun | null>(null);
  const unmountedRef = useRef(false);
  const accumulatorRef = useRef(0);
  const endLingerRef = useRef(0);
  const restartingRef = useRef(false);
  const lastHudTickRef = useRef(-1);
  const bannerShownRef = useRef(false);
  const viewsRef = useRef(new Map<string, PartView>());
  const groupRefs = useRef(new Map<string, Group | null>());
  const materialRefs = useRef(new Map<string, MeshStandardMaterial | null>());

  const syncViews = useCallback((match: MatchState, hard: boolean) => {
    for (const [index, bot] of match.bots.entries()) {
      for (const [iid, body] of bot.assembled.bodies) {
        const key = `${index}:${iid}`;
        let view = viewsRef.current.get(key);
        if (!view) {
          view = newPartView();
          viewsRef.current.set(key, view);
        }
        const t = body.translation();
        const r = body.rotation();
        view.currPos.set(t.x, t.y, t.z);
        view.currRot.set(r.x, r.y, r.z, r.w);
        if (hard) {
          view.prevPos.copy(view.currPos);
          view.prevRot.copy(view.currRot);
        }
      }
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    bootMatch().then((run) => {
      if (unmountedRef.current) {
        run.dispose();
        return;
      }
      runRef.current = run;
      syncViews(run.match, true);
      onHud(readHud(run.match));
    });
    return () => {
      unmountedRef.current = true;
      runRef.current?.dispose();
      runRef.current = null;
    };
  }, [syncViews, onHud]);

  useFrame((_, delta) => {
    const run = runRef.current;
    if (!run) return;
    const match = run.match;

    accumulatorRef.current = Math.min(
      accumulatorRef.current + delta,
      MAX_FRAME_DELTA,
    );
    let stepped = false;
    while (accumulatorRef.current >= DT) {
      for (const view of viewsRef.current.values()) {
        view.prevPos.copy(view.currPos);
        view.prevRot.copy(view.currRot);
      }
      stepMatch(match);
      syncViews(match, false);
      accumulatorRef.current -= DT;
      stepped = true;
    }

    const alpha = accumulatorRef.current / DT;
    for (const [index, bot] of match.bots.entries()) {
      for (const iid of bot.assembled.bodies.keys()) {
        const key = `${index}:${iid}`;
        const view = viewsRef.current.get(key);
        const group = groupRefs.current.get(key);
        if (!view || !group) continue;
        group.position.lerpVectors(view.prevPos, view.currPos, alpha);
        group.quaternion.slerpQuaternions(view.prevRot, view.currRot, alpha);
        const material = materialRefs.current.get(key);
        if (material) {
          const destroyed = bot.parts.get(iid)?.destroyed ?? false;
          material.color.set(
            destroyed ? BOT_COLORS_DESTROYED[index] : BOT_COLORS[index],
          );
        }
      }
    }

    if (stepped) {
      stageRef.current?.setAttribute("data-sim-tick", String(match.tick));
      const hudTick = Math.floor(match.tick / 15);
      // Edge-trigger the banner; a level trigger would re-render every
      // frame for the whole end linger.
      const bannerEdge = match.status.over && !bannerShownRef.current;
      if (hudTick !== lastHudTickRef.current || bannerEdge) {
        lastHudTickRef.current = hudTick;
        if (bannerEdge) bannerShownRef.current = true;
        onHud(readHud(match));
      }
    }

    // Exhibition loop: linger on the result, then run it back.
    if (match.status.over && !restartingRef.current) {
      endLingerRef.current += delta;
      if (endLingerRef.current > RESTART_DELAY_SECONDS) {
        restartingRef.current = true;
        endLingerRef.current = 0;
        runRef.current = null;
        run.dispose();
        bootMatch().then((next) => {
          if (unmountedRef.current) {
            next.dispose();
            return;
          }
          runRef.current = next;
          syncViews(next.match, true);
          bannerShownRef.current = false;
          lastHudTickRef.current = -1;
          onHud(readHud(next.match));
          restartingRef.current = false;
        });
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 10, 4]} intensity={1.5} />
      {([0, 1] as const).map((botIndex) =>
        EXHIBITION_DESIGNS[botIndex].parts.map((part) => {
          const key = `${botIndex}:${part.iid}`;
          const shape = PART_CATALOG[part.partId].shape;
          return (
            <group
              key={key}
              ref={(node) => {
                groupRefs.current.set(key, node);
              }}
            >
              <mesh rotation={shapeRotation(shape)}>
                {partGeometry(shape)}
                <meshStandardMaterial
                  ref={(node) => {
                    materialRefs.current.set(key, node);
                  }}
                  color={BOT_COLORS[botIndex]}
                  flatShading
                />
              </mesh>
            </group>
          );
        }),
      )}
      <mesh position={[0, -0.5, 0]}>
        <boxGeometry args={[26, 1, 26]} />
        <meshStandardMaterial color="#2f3640" flatShading />
      </mesh>
    </>
  );
}

export default function ArenaCanvas() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<HudState | null>(null);

  return (
    <div
      ref={stageRef}
      data-sim-tick="0"
      style={{ position: "relative", width: "100%", height: "100dvh" }}
    >
      <Canvas
        camera={{ position: [8, 5, 10], fov: 42 }}
        gl={async (glProps) => {
          const renderer = new WebGPURenderer(
            glProps as ConstructorParameters<typeof WebGPURenderer>[0],
          );
          await renderer.init();
          return renderer;
        }}
      >
        <color attach="background" args={["#0b0e14"]} />
        <ArenaScene stageRef={stageRef} onHud={setHud} />
      </Canvas>

      {hud && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            gap: 24,
            pointerEvents: "none",
            fontSize: "0.85rem",
          }}
        >
          {hud.bots.map((bot, index) => (
            <div
              key={bot.label}
              style={{
                background: "rgba(11, 14, 20, 0.8)",
                border: `1px solid ${BOT_COLORS[index]}`,
                borderRadius: 8,
                padding: "8px 14px",
                minWidth: 180,
              }}
            >
              <div style={{ color: BOT_COLORS[index], fontWeight: 600 }}>
                {bot.label}
              </div>
              <div
                style={{
                  height: 6,
                  marginTop: 6,
                  borderRadius: 3,
                  background: "#1c2230",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${bot.healthPercent}%`,
                    height: "100%",
                    background: BOT_COLORS[index],
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginTop: 6,
                  alignItems: "center",
                }}
              >
                {bot.pips.map((pip) => (
                  <span
                    key={pip.iid}
                    title={pip.iid}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: pip.destroyed ? "#3a4358" : BOT_COLORS[index],
                      opacity: pip.destroyed
                        ? 0.6
                        : 0.3 + 0.7 * pip.healthRatio,
                    }}
                  />
                ))}
                <span style={{ opacity: 0.7, marginLeft: 6 }}>
                  {bot.healthPercent}% hull
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {hud?.banner && (
        <div
          style={{
            position: "absolute",
            top: "38%",
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              background: "rgba(11, 14, 20, 0.85)",
              border: "1px solid #3a4358",
              borderRadius: 10,
              padding: "10px 22px",
              fontSize: "1.3rem",
              fontWeight: 600,
            }}
          >
            {hud.banner}
          </span>
        </div>
      )}
    </div>
  );
}
