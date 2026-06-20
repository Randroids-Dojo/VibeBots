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
} from "three/webgpu";
import {
  type ArenaCameraBounds,
  arenaCameraBoundsCenter,
  arenaCameraBoundsReady,
  arenaCameraFrameForBounds,
  emptyArenaCameraBounds,
  includeArenaCameraBounds,
  includeArenaCameraPoint,
} from "@/components/arena-camera";
import {
  createWebGPU,
  partGeometry,
  shapeRotation,
} from "@/components/part-visuals";
import { createArenaWorld } from "@/sim/arena";
import {
  createMatch,
  freeMatch,
  type MatchState,
  stepMatch,
} from "@/sim/combat";
import { DT } from "@/sim/constants";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  TEST_BOT_DESIGN,
} from "@/sim/design";
import { PART_CATALOG } from "@/sim/parts";
import { matchResultHash } from "@/sim/resolve";

/** Clamp on accumulated frame time so a background tab cannot spiral. */
const MAX_FRAME_DELTA = 0.25;
/** Seconds to linger on the end banner before the next exhibition match. */
const RESTART_DELAY_SECONDS = 4;

const BOT_COLORS = ["#ff9f43", "#54e0c7"] as const;
const BOT_COLORS_DESTROYED = ["#6b4a26", "#2a5a52"] as const;
/** Rammer at index 1: its spike (front connector, -z) faces the enemy. */
const EXHIBITION_DESIGNS: [BotDesign, BotDesign] = [
  CPU_BRAWLER_DESIGN,
  TEST_BOT_DESIGN,
];
const ARENA_CAMERA_SMOOTHING = 3.2;
const ARENA_CAMERA_PART_PADDING = 1.2;

interface ArenaRun {
  match: MatchState;
  dispose: () => void;
}

async function bootMatch(designs: [BotDesign, BotDesign]): Promise<ArenaRun> {
  const world = await createArenaWorld();
  const match = createMatch(world, designs);
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

type MatchBot = MatchState["bots"][number];

function newPartView(): PartView {
  return {
    prevPos: new Vector3(),
    currPos: new Vector3(),
    prevRot: new Quaternion(),
    currRot: new Quaternion(),
  };
}

function includeBotPartBounds(
  bounds: ArenaCameraBounds,
  bot: MatchBot,
  botIndex: 0 | 1,
  groups: Map<string, Group | null>,
  includeDestroyed: boolean,
): number {
  let count = 0;
  for (const iid of bot.assembled.bodies.keys()) {
    const group = groups.get(`${botIndex}:${iid}`);
    if (!group) continue;
    if (!includeDestroyed && (bot.parts.get(iid)?.destroyed ?? false)) {
      continue;
    }
    includeArenaCameraPoint(
      bounds,
      group.position.x,
      group.position.y,
      group.position.z,
      ARENA_CAMERA_PART_PADDING,
    );
    count += 1;
  }
  return count;
}

export interface MatchEndInfo {
  hash: string;
  tick: number;
}

function ArenaScene({
  designs,
  stageRef,
  onHud,
  onMatchEnd,
}: {
  designs: [BotDesign, BotDesign];
  stageRef: RefObject<HTMLDivElement | null>;
  onHud: (hud: HudState) => void;
  onMatchEnd?: (info: MatchEndInfo) => void;
}) {
  const runRef = useRef<ArenaRun | null>(null);
  /** Bumped on every effect (re)run and cleanup; stale async boots check it. */
  const generationRef = useRef(0);
  const accumulatorRef = useRef(0);
  const endLingerRef = useRef(0);
  const restartingRef = useRef(false);
  const lastHudTickRef = useRef(-1);
  const bannerShownRef = useRef(false);
  const viewsRef = useRef(new Map<string, PartView>());
  const groupRefs = useRef(new Map<string, Group | null>());
  const materialRefs = useRef(new Map<string, MeshStandardMaterial | null>());
  const desiredCameraPositionRef = useRef(new Vector3(8, 5, 10));
  const desiredCameraLookAtRef = useRef(new Vector3(0, 1, 0));
  const projectedBotRef = useRef<[Vector3, Vector3]>([
    new Vector3(),
    new Vector3(),
  ]);

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
    const generation = ++generationRef.current;
    bootMatch(designs).then((run) => {
      if (generationRef.current !== generation) {
        run.dispose();
        return;
      }
      runRef.current = run;
      syncViews(run.match, true);
      onHud(readHud(run.match));
    });
    return () => {
      generationRef.current += 1;
      runRef.current?.dispose();
      runRef.current = null;
    };
  }, [syncViews, onHud, designs]);

  useFrame((state, delta) => {
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

    const allBounds = emptyArenaCameraBounds();
    const botCenters: [{ x: number; z: number }, { x: number; z: number }] = [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ];
    let framedBots = 0;
    for (const [index, bot] of match.bots.entries()) {
      const botIndex = index as 0 | 1;
      const botBounds = emptyArenaCameraBounds();
      const visibleParts = includeBotPartBounds(
        botBounds,
        bot,
        botIndex,
        groupRefs.current,
        false,
      );
      if (visibleParts === 0) {
        includeBotPartBounds(botBounds, bot, botIndex, groupRefs.current, true);
      }
      if (!arenaCameraBoundsReady(botBounds)) continue;
      includeArenaCameraBounds(allBounds, botBounds);
      const center = arenaCameraBoundsCenter(botBounds);
      botCenters[botIndex] = {
        x: center.x,
        z: center.z,
      };
      framedBots += 1;
    }

    if (framedBots === 2 && arenaCameraBoundsReady(allBounds)) {
      const frame = arenaCameraFrameForBounds(allBounds, botCenters);
      desiredCameraLookAtRef.current.set(
        frame.targetX,
        frame.targetY,
        frame.targetZ,
      );
      desiredCameraPositionRef.current.set(
        frame.targetX + Math.sin(frame.yaw) * frame.distance,
        frame.targetY + frame.height,
        frame.targetZ + Math.cos(frame.yaw) * frame.distance,
      );
      const blend = 1 - Math.exp(-delta * ARENA_CAMERA_SMOOTHING);
      state.camera.position.lerp(desiredCameraPositionRef.current, blend);
      state.camera.lookAt(desiredCameraLookAtRef.current);
      state.camera.updateMatrixWorld();

      const bot0 = projectedBotRef.current[0].set(
        botCenters[0].x,
        frame.targetY,
        botCenters[0].z,
      );
      const bot1 = projectedBotRef.current[1].set(
        botCenters[1].x,
        frame.targetY,
        botCenters[1].z,
      );
      bot0.project(state.camera);
      bot1.project(state.camera);
      const bot0InFrame = Math.abs(bot0.x) <= 0.88 && Math.abs(bot0.y) <= 0.82;
      const bot1InFrame = Math.abs(bot1.x) <= 0.88 && Math.abs(bot1.y) <= 0.82;
      const stage = stageRef.current;
      if (stage) {
        stage.dataset.cameraMode = "cinematic-follow";
        stage.dataset.cameraTargetX = frame.targetX.toFixed(2);
        stage.dataset.cameraTargetZ = frame.targetZ.toFixed(2);
        stage.dataset.cameraDistance = frame.distance.toFixed(2);
        stage.dataset.bot0ScreenX = bot0.x.toFixed(3);
        stage.dataset.bot1ScreenX = bot1.x.toFixed(3);
        stage.dataset.botsInFrame = String(bot0InFrame && bot1InFrame);
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
        if (bannerEdge) {
          bannerShownRef.current = true;
          onMatchEnd?.({ hash: matchResultHash(match), tick: match.tick });
        }
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
        const generation = generationRef.current;
        bootMatch(designs).then((next) => {
          if (generationRef.current !== generation) {
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
        designs[botIndex].parts.map((part) => {
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

export default function ArenaCanvas({
  designs = EXHIBITION_DESIGNS,
  onMatchEnd,
}: {
  designs?: [BotDesign, BotDesign];
  onMatchEnd?: (info: MatchEndInfo) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<HudState | null>(null);

  return (
    <div
      ref={stageRef}
      data-sim-tick="0"
      style={{ position: "relative", width: "100%", height: "100dvh" }}
    >
      <Canvas camera={{ position: [8, 5, 10], fov: 42 }} gl={createWebGPU}>
        <color attach="background" args={["#0b0e14"]} />
        <ArenaScene
          designs={designs}
          stageRef={stageRef}
          onHud={setHud}
          onMatchEnd={onMatchEnd}
        />
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
