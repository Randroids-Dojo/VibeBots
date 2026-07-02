"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import type {
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  PointLight,
} from "three/webgpu";
import { Color, Matrix4 } from "three/webgpu";
import {
  clampMineCameraZoom,
  maxMineCameraZoom,
  mineCameraDistance,
  mineDarknessOpacity,
  mineLampDistanceForRadius,
  mineRenderWindow,
} from "@/components/mine-camera";
import { createWebGPU } from "@/components/part-visuals";
import type {
  BunkerFootprint,
  BunkerRaidSnapshot,
  BunkerState,
} from "@/sim/bunker";
import {
  biomeAt,
  type CollectTarget,
  cellAt,
  ELEVATOR_COL,
  FALL_DELAY_ACTIONS,
  hitsFor,
  isSupportSalvageTarget,
  lanternDistance,
  lightRadius,
  type MineCoord,
  oreReserveAt,
  STRATA,
  stratumAt,
} from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";
import {
  type GraphicsFeatures,
  graphicsFeaturesFor,
  hasCoarsePointer,
  isWebGPUBackend,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import {
  CacheCrate,
  CrackMarks,
  crackSegmentCountForDamage,
  DropPileMarkers,
  DroppedBagMarker,
  DynamiteCharge,
  dropPileStats,
  FallingRockShard,
  MineBlockBody,
} from "./mine-block-render";
import { type BunkerBuildMode, BunkerOverlay } from "./mine-bunker-overlay";
import {
  CRUSH_HOLD_SECONDS,
  FATAL_FALL_HOLD_SECONDS,
  fatalFallPlaybackSeconds,
  useMineDeathPlaybackBridge,
} from "./mine-death-playback";
import { MinerBot } from "./mine-miner-render";
import { minerStepSeconds } from "./mine-pacing";
import {
  type JuiceState,
  spawnBurst,
  spawnClang,
  spawnDirtBreakBurst,
  spawnDust,
  spawnFallWarning,
  spawnGasHiss,
  spawnLadderFall,
  spawnOreGlitter,
  spawnSparks,
} from "./mine-particles";
import {
  BOULDER_COLOR,
  BOULDER_WOBBLE_COLOR,
  biomeDirtColorAt,
  CACHE_COLOR,
  cellHash,
  cellX,
  DARK_DEPTH,
  GAS_COLOR,
  GLOWING_ORES,
  MAGMA_COLOR,
  ORE_COLORS,
  rockColorsForBiome,
  STRATA_BG,
  TEETER_EMISSIVE,
  tunnelColorForBiome,
  variedColor,
} from "./mine-render-palette";
import { playMineResultSfx, playMineSfxEvent } from "./mine-sfx";
import {
  SelectedSupportCellOutline,
  SupportCellHitTarget,
  SupportSelectionOutline,
} from "./mine-support-selection";
import {
  CAMP_WIDTH,
  SurfaceDressing,
  SurfaceSkin,
} from "./mine-surface-render";
import {
  advanceMinerRig,
  BOUNCE_SECONDS,
  createMinerRigState,
  DIG_LUNGE_SECONDS,
  PICK_SWING_SECONDS,
} from "./miner-rig";
import { StudioEnvironment } from "./studio-environment";

interface MotionTrack {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  duration: number;
  frames: number;
}

const CAMERA_STEP_SECONDS = 0.28;
/** Instance pool sizes per particle kind; spawners cap the live pool at
 * 260 total, so these bound the per-kind bursts. */
const PARTICLE_CAPACITY = { spark: 96, debris: 192, dust: 96 } as const;
const EDGE_DARKNESS_COLOR = "#02040a";

const easeStep = (t: number) => 0.5 - Math.cos(t * Math.PI) * 0.5;

function snapMotion(
  now: number,
  targetX: number,
  targetY: number,
  duration: number,
): MotionTrack {
  return {
    fromX: targetX,
    fromY: targetY,
    toX: targetX,
    toY: targetY,
    startedAt: now,
    duration,
    frames: 0,
  };
}

function retargetMotion(
  track: MotionTrack | null,
  now: number,
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  duration: number,
): MotionTrack {
  if (track && track.toX === targetX && track.toY === targetY) return track;
  return {
    fromX: currentX,
    fromY: currentY,
    toX: targetX,
    toY: targetY,
    startedAt: now,
    duration,
    frames: 0,
  };
}

function motionProgress(track: MotionTrack, now: number): number {
  const raw = (now - track.startedAt) / track.duration;
  return Math.max(0, Math.min(1, raw));
}

function sampleMotion(track: MotionTrack, now: number): [number, number] {
  const t = motionProgress(track, now);
  const eased = easeStep(t);
  return [
    track.fromX + (track.toX - track.fromX) * eased,
    track.fromY + (track.toY - track.fromY) * eased,
  ];
}

/* ---- Village building kit (REQ-021): one distinct model per stall.
 * Shared frame: every group sits at z -0.85 so the boardwalk and the
 * miner's walk row (z 0) stay clearly in front of every facade; the
 * ground line is at local y ~1.06. ---- */

function MineScene({
  zoom,
  collectMode,
  selectedSupportKeys,
  dynamitePreviewCells,
  bunkerPreview,
  bunkerBlockedCells,
  bunker,
  activeBunkerRaid,
  bunkerEditingEnabled,
  selectedBunkerPartCell,
  bunkerPartDragTargetCell,
  bunkerTargetCell,
  bunkerBuildMode,
  onToggleSupport,
  onBunkerPartTap,
  onBunkerPartPointerDown,
  onBunkerCellHover,
  onBunkerCellTap,
  onBunkerDragTarget,
  onBunkerDragEnd,
  graphicsFeatures,
}: MineCanvasProps & { graphicsFeatures: GraphicsFeatures }) {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const lastAction = useMineStore((s) => s.lastAction);
  void tick; // subscription trigger: the mine object mutates in place
  const rigRef = useRef<Group>(null);
  const minerRef = useRef<Group>(null);
  const minerBodyRef = useRef<Group>(null);
  const motesRef = useRef<Group>(null);
  const pickArmRef = useRef<Group>(null);
  const legLRef = useRef<Group>(null);
  const legRRef = useRef<Group>(null);
  // Walk cadence: advanced by distance actually travelled so the stride
  // is foot-locked to the glide, plus the prior frame's position to
  // measure that distance.
  const minerRig = useRef(createMinerRigState());
  const prevMinerPos = useRef<{ x: number; y: number } | null>(null);
  const cameraMotion = useRef<MotionTrack | null>(null);
  const minerMotion = useRef<MotionTrack | null>(null);
  const lampRef = useRef<PointLight>(null);
  const ambientRef = useRef<AmbientLight>(null);
  const hemiRef = useRef<HemisphereLight>(null);
  const dirRef = useRef<DirectionalLight>(null);
  const sparkInstRef = useRef<InstancedMesh>(null);
  const debrisInstRef = useRef<InstancedMesh>(null);
  const dustInstRef = useRef<InstancedMesh>(null);
  const particleMatrix = useRef(new Matrix4());
  const particleColor = useRef(new Color());
  const wobbleRefs = useRef<Map<string, Group | Mesh>>(new Map());
  const juice = useRef<JuiceState>({
    particles: [],
    nextId: 1,
    shake: 0,
    swing: 0,
    bounce: 0,
    facing: 0,
    lunge: { x: 0, y: 0, t: 0 },
    fallWarning: 0,
  });
  const minerPlaced = useRef(false);
  // Smoothed frame time (ms), exposed for performance QA. A surface walk
  // must not spike this the way the per-step village rebuild used to.
  const frameMsRef = useRef(16);
  // Capability gate: shadow passes only when the real WebGPU backend is
  // driving; the WebGL2 fallback (headless CI, software GL, weak GPUs)
  // cannot afford them regardless of the pointer-derived tier.
  const webgpuBackend = useThree((state) => isWebGPUBackend(state.gl));
  const { fallPlayback, fallWindow, clearFallPlayback } =
    useMineDeathPlaybackBridge(lastResult, tick);
  const renderedCellCountRef = useRef(0);
  const renderedCrackSegmentCountRef = useRef(0);

  const displayCol = fallWindow?.col ?? mine.miner.col;
  const minerRow = fallWindow?.toRow ?? mine.miner.row;
  const renderDistance = (col: number, row: number) =>
    Math.max(Math.abs(col - displayCol), Math.max(0, row - minerRow));
  const cameraZoom = clampMineCameraZoom(zoom, mine.gear);
  const maxCameraZoom = maxMineCameraZoom(mine.gear);
  const renderWindow = mineRenderWindow(mine.gear, cameraZoom);
  const litBelow = lightRadius(mine.gear);
  const lampDistance = mineLampDistanceForRadius(litBelow);
  const renderRadius = renderWindow.below;
  const renderColRadius = Math.min(renderWindow.cols, renderRadius);
  const firstCol = displayCol - renderColRadius;
  const lastCol = displayCol + renderColRadius;
  const firstRow = Math.max(0, minerRow - renderWindow.above);
  const lastRow = minerRow + renderWindow.below;

  // Dig/blast feedback: bursts, shake, swing, and facing keyed to the
  // last sim result.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useLayoutEffect(() => {
    const j = juice.current;
    playMineResultSfx(lastResult, lastAction);
    if (lastAction === "left") j.facing = -1;
    else if (lastAction === "right") j.facing = 1;
    else if (lastAction != null) j.facing = 0;
    // The starter pick glancing off rock it can't cut (REQ "too hard"):
    // a real swing that bounces back, a thud, a body recoil, and a cold
    // spark shower, so the wall reads as physically immovable, not just
    // as a toast. Nothing chips: no debris, no progress.
    if (lastResult && !lastResult.ok && lastResult.reason === "rock") {
      const miner = mine.miner;
      const dc = lastAction === "left" ? -1 : lastAction === "right" ? 1 : 0;
      const dr = lastAction === "down" ? 1 : lastAction === "up" ? -1 : 0;
      const sx = cellX(miner.col + dc);
      const sy = -(miner.row + dr);
      j.bounce = BOUNCE_SECONDS;
      // Recoil the body AWAY from the rock: the swing rebounds off it.
      j.lunge = { x: -dc * 0.14, y: dr * 0.12, t: DIG_LUNGE_SECONDS };
      j.shake = Math.max(j.shake, 0.14);
      // Sparks fly off the rock face back toward the miner.
      spawnClang(j, sx, sy, -dc, dr);
    }
    if (!lastResult?.ok) return;
    const miner = mine.miner;
    const at = lastResult.dugAt ??
      lastResult.lost ?? { col: miner.col, row: miner.row };
    if (lastResult.cracked) {
      j.swing = PICK_SWING_SECONDS;
      const dc = lastAction === "left" ? -1 : lastAction === "right" ? 1 : 0;
      const dr = lastAction === "down" ? 1 : lastAction === "up" ? -1 : 0;
      const targetCol = miner.col + dc;
      const targetRow = miner.row + dr;
      const targetBiome = biomeAt(targetCol);
      const sx = cellX(targetCol);
      const sy = -targetRow;
      spawnSparks(j, sx, sy, 4);
      spawnBurst(
        j,
        sx,
        sy,
        lastResult.oreHarvested
          ? ORE_COLORS[lastResult.oreHarvested.ore]
          : lastResult.cracked.kind === "rock"
            ? rockColorsForBiome(targetBiome)[0]
            : biomeDirtColorAt(targetCol, targetRow),
        3,
      );
      j.shake = Math.max(j.shake, 0.02);
      j.lunge = { x: dc * 0.16, y: -dr * 0.13, t: DIG_LUNGE_SECONDS };
    }
    if (lastResult.plankCracked) {
      j.swing = PICK_SWING_SECONDS;
      spawnSparks(j, cellX(miner.col), -miner.row - 0.42, 4);
      spawnBurst(j, cellX(miner.col), -miner.row - 0.42, "#e4ad5b", 3);
      j.shake = Math.max(j.shake, 0.02);
      j.lunge = { x: 0, y: -0.13, t: DIG_LUNGE_SECONDS };
    }
    if (lastResult.dug) {
      j.swing = PICK_SWING_SECONDS;
      const color =
        lastResult.dugOre != null
          ? ORE_COLORS[lastResult.dugOre]
          : lastResult.dug === "rock"
            ? rockColorsForBiome(biomeAt(at.col))[0]
            : lastResult.dug === "part-cache"
              ? CACHE_COLOR
              : biomeDirtColorAt(at.col, at.row);
      if (lastResult.dug === "dirt") {
        spawnDirtBreakBurst(j, cellX(at.col), -at.row, color);
      } else {
        spawnBurst(
          j,
          cellX(at.col),
          -at.row,
          color,
          lastResult.dug === "rock" ? 16 : 11,
        );
      }
      if (lastResult.dugOre != null) {
        spawnOreGlitter(
          j,
          cellX(at.col),
          -at.row,
          ORE_COLORS[lastResult.dugOre],
          GLOWING_ORES.has(lastResult.dugOre),
        );
      }
      if (lastResult.dug === "gas") {
        spawnGasHiss(j, cellX(at.col), -at.row);
      }
      spawnSparks(
        j,
        cellX(at.col),
        -at.row,
        lastResult.dug === "rock" ? 10 : lastResult.dug === "dirt" ? 5 : 6,
      );
      // Every strike thumps; rock thumps harder.
      j.shake = Math.max(
        j.shake,
        lastResult.dug === "rock"
          ? 0.12
          : lastResult.dug === "dirt"
            ? 0.16
            : 0.045,
      );
      // Lunge the body toward the struck cell.
      const ldx = lastAction === "left" ? -1 : lastAction === "right" ? 1 : 0;
      const ldy = lastAction === "down" ? -1 : lastAction === "up" ? 1 : 0;
      j.lunge = { x: ldx * 0.16, y: ldy * 0.13, t: DIG_LUNGE_SECONDS };
    } else if (
      lastResult.ok &&
      (lastAction === "left" ||
        lastAction === "right" ||
        lastAction === "down" ||
        lastAction === "up")
    ) {
      // A plain step into open tunnel: treads kick a little dust.
      spawnDust(j, cellX(miner.col), -miner.row);
    }
    if (lastResult.exploded) {
      spawnBurst(
        j,
        cellX(lastResult.exploded.col),
        -lastResult.exploded.row,
        "#ffb347",
        26 + (lastResult.blasted ?? 0) * 4,
      );
      j.shake = Math.max(j.shake, 0.35);
    }
    if ((lastResult.vented ?? 0) > 0) {
      const biome = biomeAt(at.col);
      const ventColor =
        biome === "winter"
          ? "#9ee7ff"
          : biome === "highTech"
            ? "#65ffb8"
            : GAS_COLOR;
      spawnBurst(j, cellX(at.col), -at.row, ventColor, 16);
      j.shake = Math.max(j.shake, 0.25);
    }
    if (lastResult.fallingRockWarnings?.length) {
      for (const warning of lastResult.fallingRockWarnings.slice(0, 6)) {
        spawnFallWarning(j, cellX(warning.col), -warning.row);
      }
      j.fallWarning = 0.55;
      j.shake = Math.max(j.shake, 0.08);
    }
    if (lastResult.ladderFalls?.length) {
      const visibleFalls = lastResult.ladderFalls.slice(0, 14);
      for (const fall of visibleFalls) {
        spawnLadderFall(j, cellX(fall.to.col), -fall.from.row, -fall.to.row);
      }
      j.shake = Math.max(
        j.shake,
        Math.min(0.18, 0.055 + visibleFalls.length * 0.014),
      );
    }
    if (lastResult.crushed) j.shake = Math.max(j.shake, 0.5);
  }, [tick]);

  useFrame((state, delta) => {
    const j = juice.current;
    const t = state.clock.elapsedTime;
    const activeFall = fallPlayback.current;
    let visualTargetX = cellX(mine.miner.col);
    let visualTargetY = -mine.miner.row;
    // The surface ground visual sits higher than an underground cell
    // floor, so lift the bot at the ground line to keep feet on the
    // grass instead of shin-deep in the first block row. The camera
    // glide eases the step when entering the shaft.
    if (mine.miner.row <= 0 && !activeFall) visualTargetY += 0.06;
    if (activeFall) {
      if (!activeFall.track) {
        const duration =
          activeFall.kind === "crush"
            ? 0.32
            : fatalFallPlaybackSeconds(activeFall.fell);
        activeFall.track = {
          fromX: cellX(activeFall.col),
          fromY: -activeFall.fromRow,
          toX: cellX(activeFall.col),
          toY: -activeFall.toRow,
          startedAt: t,
          duration,
          frames: 0,
        };
      }
      if (motionProgress(activeFall.track, t) < 1) activeFall.track.frames += 1;
      [visualTargetX, visualTargetY] = sampleMotion(activeFall.track, t);
      if (motionProgress(activeFall.track, t) >= 1 && !activeFall.impacted) {
        activeFall.impacted = true;
        // Signal the panel that the impact frame has rendered; the trip
        // report waits on this instead of racing the visuals wall-clock.
        useMineStore.getState().markFallVisualImpact(activeFall.key);
        activeFall.doneAt =
          t +
          (activeFall.kind === "crush"
            ? CRUSH_HOLD_SECONDS
            : FATAL_FALL_HOLD_SECONDS);
        const impactX = cellX(activeFall.col);
        const impactY = -activeFall.toRow;
        if (activeFall.kind === "crush") {
          spawnBurst(j, impactX, impactY, "#d9863a", 32);
          spawnSparks(j, impactX, impactY + 0.12, 18);
          j.shake = Math.max(j.shake, 0.9);
          playMineSfxEvent("crush");
        } else {
          spawnBurst(j, impactX, impactY, "#ff6b6b", 24);
          spawnSparks(j, impactX, impactY, 12);
          j.shake = Math.max(j.shake, 0.72);
          playMineSfxEvent("fall-death");
        }
      }
      if (activeFall.doneAt != null && t >= activeFall.doneAt) {
        const key = activeFall.key;
        clearFallPlayback(key);
      }
    }
    const resetJump =
      (lastResult?.ok && lastResult.collapsed && !activeFall) ||
      lastAction === "abandon" ||
      lastAction === "recall" ||
      lastAction === "warp-home" ||
      lastAction?.startsWith("warp-down") ||
      lastAction?.startsWith("portal-warp");
    // Camera rig eases down the shaft after the miner, with shake.
    const targetY = visualTargetY;
    const rig = rigRef.current;
    let depthT = 0;
    if (rig) {
      // Trip resets (collapse, recall, abandon) move the miner across
      // the whole map; gliding the camera through it reads as broken.
      const targetX = visualTargetX;
      const cameraJump =
        resetJump ||
        Math.hypot(targetX - rig.position.x, targetY - rig.position.y) > 6;
      if (activeFall) {
        cameraMotion.current = activeFall.track;
        rig.position.set(targetX, targetY, 0);
      } else if (cameraJump) {
        cameraMotion.current = snapMotion(
          t,
          targetX,
          targetY,
          CAMERA_STEP_SECONDS,
        );
        rig.position.set(targetX, targetY, 0);
      } else {
        cameraMotion.current = retargetMotion(
          cameraMotion.current,
          t,
          rig.position.x,
          rig.position.y,
          targetX,
          targetY,
          CAMERA_STEP_SECONDS,
        );
        if (motionProgress(cameraMotion.current, t) < 1)
          cameraMotion.current.frames += 1;
        const [cx, cy] = sampleMotion(cameraMotion.current, t);
        rig.position.set(cx, cy, 0);
      }
      j.shake = Math.max(0, j.shake - delta * 0.9);
      const sx = rig.position.x + (Math.random() - 0.5) * j.shake;
      const sy = (Math.random() - 0.5) * j.shake;
      state.camera.position.set(
        sx,
        rig.position.y + 1.5 + sy,
        mineCameraDistance(cameraZoom),
      );
      state.camera.lookAt(sx, rig.position.y + sy, 0);
      // Rendered camera pan exposed for motion QA on narrow viewports.
      state.gl.domElement.dataset.camX = rig.position.x.toFixed(2);
      state.gl.domElement.dataset.camY = rig.position.y.toFixed(2);
      state.gl.domElement.dataset.camZoom = cameraZoom.toFixed(2);
      state.gl.domElement.dataset.renderBelow = String(renderWindow.below);
      state.gl.domElement.dataset.litBelow = String(litBelow);
      state.gl.domElement.dataset.lampDistance = lampDistance.toFixed(2);
      state.gl.domElement.dataset.renderRadius = String(renderRadius);
      state.gl.domElement.dataset.renderMinCol = String(firstCol);
      state.gl.domElement.dataset.renderMaxCol = String(lastCol);
      state.gl.domElement.dataset.renderedCellCount = String(
        renderedCellCountRef.current,
      );
      state.gl.domElement.dataset.crackSegmentCount = String(
        renderedCrackSegmentCountRef.current,
      );
      state.gl.domElement.dataset.particleCount = String(j.particles.length);
      state.gl.domElement.dataset.darknessOpacityMin = hasDarknessOverlay
        ? minDarknessOpacity.toFixed(2)
        : "0.00";
      state.gl.domElement.dataset.darknessOpacityMax = hasDarknessOverlay
        ? maxDarknessOpacity.toFixed(2)
        : "0.00";
      state.gl.domElement.dataset.cameraMotionFrames = String(
        cameraMotion.current?.frames ?? 0,
      );
      depthT = Math.min(1, Math.max(0, -rig.position.y / DARK_DEPTH));
    }
    // Daylight dies with depth; the lamp takes over as the key light.
    const day = (1 - depthT) ** 1.7;
    if (ambientRef.current) ambientRef.current.intensity = 0.07 + 0.48 * day;
    if (hemiRef.current) hemiRef.current.intensity = 0.5 * day * day;
    if (dirRef.current) dirRef.current.intensity = 0.06 + 1.04 * day;
    // The studio environment is a surface phenomenon: it fades with the
    // daylight so the underground keeps its lamp-lit darkness.
    state.scene.environmentIntensity =
      graphicsFeatures.environmentIntensity * (0.12 + 0.88 * day);
    const lamp = lampRef.current;
    if (lamp) {
      let intensity = (1.0 + 3.8 * depthT) * (1 + (litBelow - 3) * 0.1);
      // The lamp gutters when the trip is nearly out of energy.
      const energy = mine.miner.energy;
      if (minerRow > 0 && energy < 10)
        intensity *= 0.78 + 0.22 * Math.sin(t * 26) * Math.sin(t * 7.3);
      lamp.intensity = intensity;
      lamp.distance = lampDistance;
      lamp.decay = 1.25;
    }
    // The miner glides between cells instead of teleporting. useFrame is
    // the only writer of this position: a JSX position prop here would be
    // re-applied by R3F on every tick re-render, snapping Y back to the
    // prop value mid-glide (the old walk-left teleport-to-surface bug).
    const miner = minerRef.current;
    if (miner) {
      const tx = visualTargetX;
      const ty = visualTargetY;
      const stepSeconds = minerStepSeconds(mine.gear);
      // Teleport-scale jumps (trip resets) snap; easing across them
      // would fly the bot up through solid rock for seconds.
      const minerJump =
        (resetJump && !activeFall) ||
        !minerPlaced.current ||
        Math.abs(tx - miner.position.x) > 3 ||
        Math.abs(ty - miner.position.y) > 6;
      if (activeFall) {
        minerPlaced.current = true;
        minerMotion.current = activeFall.track;
        miner.position.set(tx, ty, 0.2);
      } else if (minerJump) {
        minerPlaced.current = true;
        minerMotion.current = snapMotion(t, tx, ty, stepSeconds);
        miner.position.set(tx, ty, 0.2);
      } else {
        minerMotion.current = retargetMotion(
          minerMotion.current,
          t,
          miner.position.x,
          miner.position.y,
          tx,
          ty,
          stepSeconds,
        );
        if (motionProgress(minerMotion.current, t) < 1)
          minerMotion.current.frames += 1;
        const [mx, my] = sampleMotion(minerMotion.current, t);
        miner.position.set(mx, my, 0.2);
      }
      // Rendered position exposed for motion QA (Rule 10): e2e reads these
      // to prove the glide never lifts toward the surface on lateral steps.
      const el = state.gl.domElement;
      el.dataset.minerX = miner.position.x.toFixed(2);
      el.dataset.minerY = miner.position.y.toFixed(2);
      el.dataset.minerMotionFrames = String(minerMotion.current?.frames ?? 0);
      el.dataset.fallVisualActive = activeFall ? "true" : "false";
      el.dataset.fallVisualImpact = activeFall?.impacted ? "true" : "false";
      el.dataset.fallingRockWarning = j.fallWarning > 0 ? "true" : "false";
      // Last frame's draw-call count: the budget that phones live by.
      el.dataset.drawCalls = String(state.gl.info.render.calls);
      // Smoothed frame time: a steady low value means no per-step hitches.
      frameMsRef.current += (delta * 1000 - frameMsRef.current) * 0.1;
      el.dataset.frameMs = frameMsRef.current.toFixed(1);
    }
    // Body language, foot-locked stride, and the pick arm all come from
    // the shared rig (miner-rig.ts): the canvas owns the timers and the
    // refs, the rig owns how inputs become joint transforms.
    j.lunge.t = Math.max(0, j.lunge.t - delta);
    j.fallWarning = Math.max(0, j.fallWarning - delta);
    j.swing = Math.max(0, j.swing - delta);
    j.bounce = Math.max(0, j.bounce - delta);
    const body = minerBodyRef.current;
    const legL = legLRef.current;
    const legR = legRRef.current;
    const arm = pickArmRef.current;
    if (miner && body && legL && legR && arm) {
      const prev = prevMinerPos.current;
      const dx = prev ? miner.position.x - prev.x : 0;
      const dy = prev ? miner.position.y - prev.y : 0;
      prevMinerPos.current = { x: miner.position.x, y: miner.position.y };
      const pose = advanceMinerRig(minerRig.current, {
        t,
        delta,
        facing: j.facing,
        stepDistance: Math.sqrt(dx * dx + dy * dy),
        leanVx: visualTargetX - miner.position.x,
        swing: j.swing,
        bounce: j.bounce,
        lunge: j.lunge,
        crushed: activeFall?.kind === "crush" ? activeFall.impacted : false,
        still: false,
      });
      body.position.x = pose.body.posX;
      body.position.y = pose.body.posY;
      body.rotation.y = pose.body.rotY;
      body.rotation.z = pose.body.rotZ;
      body.scale.set(pose.body.scaleX, pose.body.scaleY, pose.body.scaleZ);
      legL.rotation.x = pose.legL.rotX;
      legL.position.y = pose.legL.posY;
      legR.rotation.x = pose.legR.rotX;
      legR.position.y = pose.legR.posY;
      arm.rotation.z = pose.arm.rotZ;
    }
    // Lamp-lit dust drifts around the bot underground.
    const motes = motesRef.current;
    if (motes) {
      motes.visible = minerRow > 0;
      motes.rotation.z = t * 0.12;
    }
    // Teetering rock and boulders tremble every frame, harder and faster
    // the closer they are to dropping (the escalating tell).
    for (const mesh of wobbleRefs.current.values()) {
      const urgency = (mesh.userData.urgency as number) ?? 1;
      mesh.position.x =
        (mesh.userData.baseX as number) +
        Math.sin(t * (22 + 16 * urgency) + (mesh.userData.baseY as number)) *
          (0.015 + 0.05 * urgency);
    }
    // Particles: integrate, gravity, expire; positions sync imperatively
    // (creation/removal re-renders on tick).
    for (const p of j.particles) {
      p.life -= delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy -= p.gravity * delta;
    }
    j.particles = j.particles.filter((p) => p.life > 0);
    // Instanced particle write-out: one draw per kind, no React
    // reconciliation on spawn or expiry (W3).
    const instFor = {
      spark: sparkInstRef.current,
      debris: debrisInstRef.current,
      dust: dustInstRef.current,
    } as const;
    const counts = { spark: 0, debris: 0, dust: 0 };
    const matrix = particleMatrix.current;
    const colorScratch = particleColor.current;
    for (const p of j.particles) {
      const inst = instFor[p.kind];
      if (!inst) continue;
      const index = counts[p.kind];
      if (index >= PARTICLE_CAPACITY[p.kind]) continue;
      counts[p.kind] = index + 1;
      const scale = p.size * Math.max(0.05, Math.min(1, p.life * 2.2));
      matrix.makeScale(scale, scale, scale);
      matrix.setPosition(p.x, p.y, 0.4);
      inst.setMatrixAt(index, matrix);
      inst.setColorAt(index, colorScratch.set(p.color));
    }
    for (const kind of ["spark", "debris", "dust"] as const) {
      const inst = instFor[kind];
      if (!inst) continue;
      inst.count = counts[kind];
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  });

  const stratumIndex = Math.min(
    STRATA.indexOf(stratumAt(minerRow)),
    STRATA_BG.length - 1,
  );
  const bg = STRATA_BG[stratumIndex];

  wobbleRefs.current.clear();
  // Register a teetering block's mesh so useFrame can tremble it; the
  // urgency (0..1, rising as the countdown nears zero) drives the shake.
  const teeterRef =
    (key: string, x: number, y: number, urgency: number) =>
    (mesh: Group | Mesh | null) => {
      if (mesh) {
        mesh.userData.baseX = x;
        mesh.userData.baseY = y;
        mesh.userData.urgency = urgency;
        wobbleRefs.current.set(key, mesh);
      } else {
        wobbleRefs.current.delete(key);
      }
    };
  const teeterUrgency = (fallIn: number) =>
    (FALL_DELAY_ACTIONS - fallIn + 1) / FALL_DELAY_ACTIONS;
  const blockMeshes = [];
  const tunnelMeshes = [];
  const cargoMeshes = [];
  const crackMeshes = [];
  const darknessMeshes = [];
  const supportSelectionMeshes = [];
  let minDarknessOpacity = 1;
  let maxDarknessOpacity = 0;
  let renderedCellCount = 0;
  let renderedCrackSegmentCount = 0;
  const selectedSupportSet = new Set(selectedSupportKeys ?? []);
  const dynamitePreviewSet = new Set(
    (dynamitePreviewCells ?? []).map((coord) => `${coord.col}:${coord.row}`),
  );
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const distanceFromMiner = fallWindow
        ? renderDistance(col, row)
        : lanternDistance(mine, col, row);
      if (distanceFromMiner > renderRadius) continue;
      const cell = cellAt(mine, col, row);
      if (!cell) continue;
      renderedCellCount += 1;
      const key = `${col}:${row}`;
      const x = cellX(col);
      const y = -row;
      const biome = biomeAt(col);
      if (cell.bag) {
        const bagOnBlock = cell.kind !== "empty";
        cargoMeshes.push(
          <group
            key={`bag:${key}`}
            position={[
              x,
              y + (bagOnBlock ? 0.18 : -0.28),
              bagOnBlock ? 0.92 : 0.28,
            ]}
            rotation={[0, cellHash(col, row, 67) * 0.35 - 0.18, 0]}
          >
            <DroppedBagMarker />
          </group>,
        );
      }
      if (dynamitePreviewSet.has(key)) {
        crackMeshes.push(
          <mesh key={`dynamite-preview:${key}`} position={[x, y, 0.86]}>
            <planeGeometry args={[1.1, 1.1]} />
            <meshBasicMaterial
              color="#ffe08a"
              transparent
              opacity={0.34}
              depthWrite={false}
            />
          </mesh>,
        );
      }
      const beyondLight = Math.max(0, distanceFromMiner - litBelow);
      if (beyondLight > 0) {
        const opacity = mineDarknessOpacity(
          beyondLight,
          cameraZoom,
          maxCameraZoom,
        );
        if (opacity > 0) {
          minDarknessOpacity = Math.min(minDarknessOpacity, opacity);
          maxDarknessOpacity = Math.max(maxDarknessOpacity, opacity);
          darknessMeshes.push(
            <mesh key={`dark:${key}`} position={[x, y, 0.72]}>
              <planeGeometry args={[1.08, 1.08]} />
              <meshBasicMaterial
                color={EDGE_DARKNESS_COLOR}
                transparent
                opacity={opacity}
                depthWrite={false}
              />
            </mesh>,
          );
        }
      }
      // Damaged blocks wear cracks (REQ-013); the overlay rides above
      // whatever shape the kind renders.
      const oreDamage =
        cell.kind === "ore" && cell.ore && cell.oreRemaining !== undefined
          ? 1 - cell.oreRemaining / oreReserveAt(cell.ore, row)
          : null;
      if (
        oreDamage !== null ||
        (cell.hp !== undefined && cell.kind !== "empty")
      ) {
        const damage =
          oreDamage ??
          1 -
            (cell.hp ?? hitsFor(cell.kind, mine.gear)) /
              hitsFor(cell.kind, mine.gear);
        renderedCrackSegmentCount += crackSegmentCountForDamage(damage);
        crackMeshes.push(
          <group key={`crack:${key}`} position={[x, y, 0]}>
            <CrackMarks col={col} row={row} damage={damage} />
          </group>,
        );
      }
      if (cell.kind === "empty") {
        // Carved tunnels read as recessed rock, not as holes in the sky.
        if (row >= 1) {
          tunnelMeshes.push(
            <mesh key={key} position={[x, y, -0.42]}>
              <boxGeometry args={[1, 1, 0.12]} />
              <meshStandardMaterial
                color={variedColor(tunnelColorForBiome(biome), col, row)}
                roughness={1}
              />
            </mesh>,
          );
        }
        // A planted ladder (REQ-020): rails and rungs against the wall.
        if (cell.ladder) {
          const ladderCanSalvage =
            collectMode && isSupportSalvageTarget(mine, col, row);
          const ladderSelected =
            ladderCanSalvage && selectedSupportSet.has(`ladder:${col},${row}`);
          const toggleLadder =
            ladderCanSalvage && onToggleSupport ? onToggleSupport : null;
          if (toggleLadder) {
            supportSelectionMeshes.push(
              <SupportCellHitTarget
                key={`support-hit:ladder:${key}`}
                target={{ type: "ladder", col, row }}
                onToggleSupport={toggleLadder}
              />,
            );
          }
          if (ladderSelected) {
            supportSelectionMeshes.push(
              <SelectedSupportCellOutline
                key={`selected-cell:ladder:${key}`}
                col={col}
                row={row}
              />,
            );
          }
          tunnelMeshes.push(
            // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
            <group
              key={`ladder:${key}`}
              position={[x, y, -0.28]}
              onClick={
                toggleLadder
                  ? (e) => {
                      e.stopPropagation();
                      toggleLadder({ type: "ladder", col, row });
                    }
                  : undefined
              }
            >
              {[-0.16, 0.16].map((rx) => (
                <mesh key={rx} position={[rx, 0, 0]}>
                  <boxGeometry args={[0.05, 1, 0.05]} />
                  <meshStandardMaterial
                    color={ladderCanSalvage ? "#d9a052" : "#a87b3e"}
                    emissive={ladderCanSalvage ? "#5a3411" : "#000000"}
                    emissiveIntensity={ladderCanSalvage ? 0.16 : 0}
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
              {[-0.3, 0, 0.3].map((ry) => (
                <mesh key={ry} position={[0, ry, 0]}>
                  <boxGeometry args={[0.36, 0.05, 0.05]} />
                  <meshStandardMaterial
                    color={ladderCanSalvage ? "#ffd078" : "#c99a55"}
                    emissive={ladderCanSalvage ? "#5a3411" : "#000000"}
                    emissiveIntensity={ladderCanSalvage ? 0.18 : 0}
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
              {ladderSelected ? (
                <SupportSelectionOutline width={0.54} height={1.08} />
              ) : null}
            </group>,
          );
        }
        // The warp beacon (REQ-029): a humming pylon in the dark.
        if (cell.beacon) {
          const beaconCanSalvage =
            collectMode && isSupportSalvageTarget(mine, col, row);
          const beaconSelected =
            beaconCanSalvage && selectedSupportSet.has(`beacon:${col},${row}`);
          const toggleBeacon =
            beaconCanSalvage && onToggleSupport ? onToggleSupport : null;
          tunnelMeshes.push(
            // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
            <group
              key={`beacon:${key}`}
              position={[x, y - 0.18, 0.1]}
              onClick={
                toggleBeacon
                  ? (e) => {
                      e.stopPropagation();
                      toggleBeacon({ type: "beacon", col, row });
                    }
                  : undefined
              }
            >
              <mesh>
                <cylinderGeometry args={[0.07, 0.12, 0.5, 8]} />
                <meshStandardMaterial
                  color={beaconCanSalvage ? "#8d58b8" : "#5a3a78"}
                  metalness={0.5}
                  roughness={0.4}
                  flatShading
                />
              </mesh>
              <mesh position={[0, 0.35, 0]}>
                <octahedronGeometry args={[0.12, 0]} />
                <meshStandardMaterial
                  color="#e08aff"
                  emissive="#e08aff"
                  emissiveIntensity={1.6}
                  flatShading
                />
              </mesh>
              <pointLight
                position={[0, 0.4, 0.4]}
                color="#e08aff"
                intensity={1.4}
                distance={4}
                decay={1.6}
              />
              {beaconSelected ? (
                <SupportSelectionOutline width={0.56} height={0.86} />
              ) : null}
            </group>,
          );
        }
        const drop = dropPileStats(cell);
        if (drop.count > 0) {
          const oreColor = drop.ore ? ORE_COLORS[drop.ore] : CACHE_COLOR;
          tunnelMeshes.push(
            <group key={`drop:${key}`} position={[x, y - 0.28, 0.18]}>
              <mesh
                rotation={[
                  cellHash(col, row, 41) * 1.2,
                  cellHash(col, row, 43) * 1.8,
                  cellHash(col, row, 47) * 1.4,
                ]}
              >
                <octahedronGeometry args={[0.16, 0]} />
                <meshStandardMaterial
                  color={oreColor}
                  emissive={oreColor}
                  emissiveIntensity={0.25}
                  roughness={0.55}
                  flatShading
                />
              </mesh>
              {drop.count > 1 ? (
                <DropPileMarkers extraCount={drop.count - 1} color={oreColor} />
              ) : null}
            </group>,
          );
        }
        // A plank bridge (REQ-022): boards spanning the cell floor.
        if (cell.plank) {
          const plankCanSalvage =
            collectMode && isSupportSalvageTarget(mine, col, row);
          const plankSelected =
            plankCanSalvage && selectedSupportSet.has(`plank:${col},${row}`);
          const togglePlank =
            plankCanSalvage && onToggleSupport ? onToggleSupport : null;
          if (togglePlank) {
            supportSelectionMeshes.push(
              <SupportCellHitTarget
                key={`support-hit:plank:${key}`}
                target={{ type: "plank", col, row }}
                onToggleSupport={togglePlank}
              />,
            );
          }
          if (plankSelected) {
            supportSelectionMeshes.push(
              <SelectedSupportCellOutline
                key={`selected-cell:plank:${key}`}
                col={col}
                row={row}
              />,
            );
          }
          tunnelMeshes.push(
            // biome-ignore lint/a11y/noStaticElementInteractions: React Three Fiber scene targets are not DOM controls.
            <group
              key={`plank:${key}`}
              position={[x, y - 0.42, 0.05]}
              onClick={
                togglePlank
                  ? (e) => {
                      e.stopPropagation();
                      togglePlank({ type: "plank", col, row });
                    }
                  : undefined
              }
            >
              {[-0.14, 0.14].map((pz) => (
                <mesh key={pz} position={[0, 0, pz]}>
                  <boxGeometry args={[0.98, 0.07, 0.22]} />
                  <meshStandardMaterial
                    color={plankCanSalvage ? "#e4ad5b" : "#b58a4a"}
                    emissive={plankCanSalvage ? "#4a2d10" : "#000000"}
                    emissiveIntensity={plankCanSalvage ? 0.14 : 0}
                    roughness={0.85}
                    flatShading
                  />
                </mesh>
              ))}
              <mesh position={[0, -0.05, 0]}>
                <boxGeometry args={[0.2, 0.06, 0.56]} />
                <meshStandardMaterial
                  color={plankCanSalvage ? "#ba8240" : "#8a6536"}
                  emissive={plankCanSalvage ? "#4a2d10" : "#000000"}
                  emissiveIntensity={plankCanSalvage ? 0.12 : 0}
                  roughness={0.9}
                  flatShading
                />
              </mesh>
              {plankSelected ? (
                <SupportSelectionOutline width={1.08} height={0.44} z={0.34} />
              ) : null}
            </group>,
          );
        }
        continue;
      }
      if (cell.kind === "ore" && cell.ore) {
        blockMeshes.push(
          <group key={key} position={[x, y, 0]}>
            <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
          </group>,
        );
        continue;
      }
      if (cell.kind === "rock") {
        const rockColors = rockColorsForBiome(biome);
        const _tier = Math.min((cell.rockTier ?? 1) - 1, rockColors.length - 1);
        const teeter = cell.fallIn;
        const urgency = teeter !== undefined ? teeterUrgency(teeter) : 0;
        if (teeter !== undefined || cell.fallen) {
          blockMeshes.push(
            <group
              key={key}
              position={[x, y, 0]}
              ref={
                teeter !== undefined ? teeterRef(key, x, y, urgency) : undefined
              }
            >
              <FallingRockShard col={col} row={row} urgency={urgency} />
            </group>,
          );
          continue;
        }
        blockMeshes.push(
          <group key={key} position={[x, y, 0]}>
            <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
          </group>,
        );
        continue;
      }
      if (cell.kind === "boulder") {
        const teeter = cell.fallIn;
        const urgency = teeter !== undefined ? teeterUrgency(teeter) : 0;
        blockMeshes.push(
          <mesh
            key={key}
            position={[x, y, 0]}
            rotation={[0, cellHash(col, row, 29) * 3.1, 0]}
            ref={
              teeter !== undefined ? teeterRef(key, x, y, urgency) : undefined
            }
          >
            <icosahedronGeometry args={[0.56, 0]} />
            <meshStandardMaterial
              color={
                biome === "winter"
                  ? teeter !== undefined
                    ? "#c8e6f0"
                    : "#9fb5c8"
                  : biome === "highTech"
                    ? teeter !== undefined
                      ? "#65ffb8"
                      : "#3d625b"
                    : teeter !== undefined
                      ? BOULDER_WOBBLE_COLOR
                      : BOULDER_COLOR
              }
              emissive={teeter !== undefined ? TEETER_EMISSIVE : "#000000"}
              emissiveIntensity={teeter !== undefined ? 0.2 + 0.5 * urgency : 0}
              roughness={0.8}
              flatShading
            />
          </mesh>,
        );
        continue;
      }
      if (cell.kind === "part-cache") {
        blockMeshes.push(
          <group key={key} position={[x, y, 0]}>
            <CacheCrate col={col} row={row} />
          </group>,
        );
        continue;
      }
      if (cell.kind === "magma") {
        blockMeshes.push(
          <RoundedBox
            key={key}
            args={[0.94, 0.94, 0.94]}
            radius={0.07}
            smoothness={2}
            position={[x, y, 0]}
          >
            <meshStandardMaterial
              color={variedColor(
                biome === "winter"
                  ? "#335568"
                  : biome === "highTech"
                    ? "#122f28"
                    : "#5a2418",
                col,
                row,
              )}
              emissive={
                biome === "winter"
                  ? "#9ee7ff"
                  : biome === "highTech"
                    ? "#65ffb8"
                    : MAGMA_COLOR
              }
              emissiveIntensity={biome === "default" ? 0.55 : 0.42}
              roughness={0.6}
              flatShading
            />
          </RoundedBox>,
        );
        continue;
      }
      if (cell.kind === "gas") {
        blockMeshes.push(
          <RoundedBox
            key={key}
            args={[0.94, 0.94, 0.94]}
            radius={0.07}
            smoothness={2}
            position={[x, y, 0]}
          >
            <meshStandardMaterial
              color={variedColor(biomeDirtColorAt(col, row), col, row).lerp(
                new Color(
                  biome === "winter"
                    ? "#9ee7ff"
                    : biome === "highTech"
                      ? "#65ffb8"
                      : GAS_COLOR,
                ),
                0.45,
              )}
              emissive={
                biome === "winter"
                  ? "#9ee7ff"
                  : biome === "highTech"
                    ? "#65ffb8"
                    : GAS_COLOR
              }
              emissiveIntensity={0.12}
              roughness={0.7}
              flatShading
            />
          </RoundedBox>,
        );
        continue;
      }
      if (cell.kind === "metal") {
        blockMeshes.push(
          <group key={key} position={[x, y, 0]}>
            <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
          </group>,
        );
        continue;
      }
      // Dirt and anything else: the shared body (per-cell tone variation
      // and soil grain live in the shader now).
      blockMeshes.push(
        <group key={key} position={[x, y, 0]}>
          <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
        </group>,
      );
    }
  }
  const charge = mine.pendingDynamite;
  if (
    charge &&
    (fallWindow
      ? renderDistance(charge.col, charge.row) <= lightRadius(mine.gear)
      : lanternDistance(mine, charge.col, charge.row) <=
        lightRadius(mine.gear)) &&
    charge.row >= firstRow &&
    charge.row <= lastRow &&
    charge.col >= firstCol &&
    charge.col <= lastCol
  ) {
    blockMeshes.push(
      <DynamiteCharge
        key={`dynamite:${charge.col}:${charge.row}`}
        col={charge.col}
        row={charge.row}
      />,
    );
  }
  renderedCellCountRef.current = renderedCellCount;
  renderedCrackSegmentCountRef.current = renderedCrackSegmentCount;
  const hasDarknessOverlay = maxDarknessOpacity > 0;

  return (
    <>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 12, 26]} />
      <ambientLight ref={ambientRef} intensity={0.55} color="#cdd8f4" />
      <hemisphereLight ref={hemiRef} args={["#8fb4e8", "#2a2017", 0.5]} />
      <directionalLight
        ref={dirRef}
        position={[3, 6, 8]}
        intensity={1.1}
        castShadow={graphicsFeatures.shadows && webgpuBackend}
        shadow-mapSize={[
          graphicsFeatures.sunShadowMapSize,
          graphicsFeatures.sunShadowMapSize,
        ]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={10}
        shadow-camera-bottom={-8}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
      />
      {/* Studio IBL: ambient response and reflections for every PBR
          surface; the frame loop scales it with daylight so descending
          into the dark still reads dark. */}
      <StudioEnvironment intensity={graphicsFeatures.environmentIntensity} />
      <group ref={rigRef}>
        {/* Cave backdrop tracks the camera so depth never shows raw void. */}
        <mesh position={[0, 0, -5]}>
          <planeGeometry args={[60, 44]} />
          <meshStandardMaterial color="#05060a" roughness={1} />
        </mesh>
      </group>
      {tunnelMeshes}
      {blockMeshes}
      {crackMeshes}
      {cargoMeshes}
      {/* The elevator rail (REQ-028): guides and ties down the bored
          shaft, rendered for the visible span of the bought rail. */}
      {mine.gear.elevator > 0 &&
        (() => {
          const railTop = Math.max(1, firstRow);
          const railBottom = Math.min(mine.gear.elevator, lastRow);
          if (railBottom < railTop) return null;
          const mid = -(railTop + railBottom) / 2;
          const span = railBottom - railTop + 1;
          const ties = [];
          for (let r = railTop; r <= railBottom; r += 2) {
            ties.push(
              <mesh key={r} position={[ELEVATOR_COL, -r, -0.3]}>
                <boxGeometry args={[0.7, 0.06, 0.1]} />
                <meshStandardMaterial
                  color="#6b7baa"
                  roughness={0.6}
                  metalness={0.4}
                  flatShading
                />
              </mesh>,
            );
          }
          return (
            <group>
              {[-0.32, 0.32].map((rx) => (
                <mesh key={rx} position={[ELEVATOR_COL + rx, mid, -0.3]}>
                  <boxGeometry args={[0.07, span, 0.07]} />
                  <meshStandardMaterial
                    color="#9aa7ff"
                    roughness={0.45}
                    metalness={0.5}
                    flatShading
                  />
                </mesh>
              ))}
              {ties}
            </group>
          );
        })()}
      {darknessMeshes}
      {supportSelectionMeshes}
      <BunkerOverlay
        preview={bunkerPreview}
        blockedCells={bunkerBlockedCells}
        bunker={bunker}
        activeRaid={activeBunkerRaid}
        editingEnabled={bunkerEditingEnabled}
        selectedPartCell={selectedBunkerPartCell}
        dragTargetCell={bunkerPartDragTargetCell}
        targetCell={bunkerTargetCell}
        buildMode={bunkerBuildMode}
        onBunkerPartTap={onBunkerPartTap}
        onBunkerPartPointerDown={onBunkerPartPointerDown}
        onBunkerCellHover={onBunkerCellHover}
        onBunkerCellTap={onBunkerCellTap}
        onBunkerDragTarget={onBunkerDragTarget}
        onBunkerDragEnd={onBunkerDragEnd}
      />
      {/* Instanced particles: sparks render fullbright, debris and dust
          take the scene light. Unit cube scaled per instance (W3). */}
      <instancedMesh
        ref={sparkInstRef}
        args={[undefined, undefined, PARTICLE_CAPACITY.spark]}
        count={0}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={debrisInstRef}
        args={[undefined, undefined, PARTICLE_CAPACITY.debris]}
        count={0}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial flatShading roughness={0.7} />
      </instancedMesh>
      <instancedMesh
        ref={dustInstRef}
        args={[undefined, undefined, PARTICLE_CAPACITY.dust]}
        count={0}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial flatShading roughness={1} />
      </instancedMesh>
      {/* Night meadow backdrop behind the village row: the bot, the
          stalls, and the grass all share one ground line now (the old
          raised shelf made the surface read as a pit). Sits behind the
          deepest building footprint so no facade gets occluded. */}
      <mesh position={[0, 0, -1.55]}>
        <boxGeometry args={[CAMP_WIDTH, 1.04, 0.12]} />
        <meshStandardMaterial color="#10130d" roughness={1} />
      </mesh>
      <SurfaceSkin firstCol={firstCol} lastCol={lastCol} mine={mine} />
      <SurfaceDressing />
      {/* The miner bot. No position prop: useFrame owns the transform. */}
      <group ref={minerRef}>
        <MinerBot
          bodyRef={minerBodyRef}
          armRef={pickArmRef}
          lampRef={lampRef}
          motesRef={motesRef}
          legLRef={legLRef}
          legRRef={legRRef}
        />
      </group>
    </>
  );
}

interface MineCanvasProps {
  zoom: number;
  collectMode?: boolean;
  selectedSupportKeys?: readonly string[];
  dynamitePreviewCells?: readonly MineCoord[];
  bunkerPreview?: BunkerFootprint | null;
  bunkerBlockedCells?: readonly MineCoord[];
  bunker?: BunkerState | null;
  activeBunkerRaid?: BunkerRaidSnapshot | null;
  bunkerEditingEnabled?: boolean;
  selectedBunkerPartCell?: MineCoord | null;
  bunkerPartDragTargetCell?: MineCoord | null;
  bunkerTargetCell?: MineCoord | null;
  bunkerBuildMode?: BunkerBuildMode;
  onToggleSupport?: (target: CollectTarget) => void;
  onBunkerPartTap?: (cell: MineCoord) => void;
  onBunkerPartPointerDown?: (cell: MineCoord) => void;
  onBunkerCellHover?: (cell: MineCoord) => void;
  onBunkerCellTap?: (cell: MineCoord) => void;
  onBunkerDragTarget?: (cell: MineCoord) => void;
  onBunkerDragEnd?: (cell: MineCoord) => void;
  onBunkerBackgroundTap?: () => void;
}

export default function MineCanvas(props: MineCanvasProps) {
  // Resolved once per mount: the tier only changes with the device or a
  // stored setting, and flipping renderer shadow support live is not
  // worth the misconfiguration risk.
  const features = graphicsFeaturesFor(
    resolveGraphicsQualityTier(readStoredGraphicsQuality(), hasCoarsePointer()),
  );
  return (
    <Canvas
      camera={{ position: [0, 1.5, 13], fov: 42 }}
      dpr={[1, 2]}
      gl={createWebGPU}
      shadows={features.shadows ? "soft" : false}
      onPointerMissed={props.onBunkerBackgroundTap}
    >
      <MineScene {...props} graphicsFeatures={features} />
    </Canvas>
  );
}
