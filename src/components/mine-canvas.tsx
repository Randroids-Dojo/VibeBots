"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type ReactElement, useCallback, useLayoutEffect, useRef } from "react";
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
import { PerfProbeBridge } from "@/components/perf-probe-bridge";
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
  type MineCell,
  type MineCoord,
  type OreId,
  oreReserveAt,
  STRATA,
  stratumAt,
} from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";
import { setDatasetNumber, setDatasetText } from "./dataset-diagnostics";
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
import {
  type MotionTrack,
  motionProgress,
  retargetMotion,
  sampleMotion,
  snapMotion,
} from "./mine-motion";
import { minerStepSeconds } from "./mine-pacing";
import {
  type JuiceState,
  PARTICLE_KINDS,
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
  advanceCrushTumble,
  type CrushTumbleState,
  createCrushTumble,
} from "./miner-crush-tumble";
import {
  advanceMinerRig,
  BOUNCE_SECONDS,
  createMinerPose,
  createMinerRigState,
  DIG_LUNGE_SECONDS,
  type MinerPose,
  minerRigRestInputs,
  PICK_SWING_SECONDS,
} from "./miner-rig";
import { ScenePostProcessing } from "./scene-post";
import { StudioEnvironment } from "./studio-environment";
import { daylightGradeFor, fogRangeForStratum } from "./time-of-day";

const CAMERA_STEP_SECONDS = 0.28;
/** Instance pool sizes per particle kind; spawners cap the live pool at
 * 260 total, so these bound the per-kind bursts. */
const PARTICLE_CAPACITY = { spark: 96, debris: 192, dust: 96 } as const;
const EDGE_DARKNESS_COLOR = "#02040a";

/* ---- Village building kit (REQ-021): one distinct model per stall.
 * Shared frame: every group sits at z -0.85 so the boardwalk and the
 * miner's walk row (z 0) stay clearly in front of every facade; the
 * ground line is at local y ~1.06. ---- */

/** Cached scene elements for one mine cell plus the render bookkeeping
 * their construction produced (F-075). `sig` fingerprints every input
 * the cell's JSX reads; while it matches, the tick re-render hands React
 * the identical element references and reconciliation bails out on the
 * whole cell subtree. The mine world mutates in place, so cell object
 * identity can never stand in for this signature. */
interface MineCellEntry {
  sig: string;
  block: ReactElement[];
  cargo: ReactElement[];
  darkness: ReactElement[];
  tunnel: ReactElement[];
  crack: ReactElement[];
  support: ReactElement[];
  darknessOpacity: number;
  crackSegments: number;
  gasWisp: boolean;
}

/** Hard cap on cached cells. A long trip visits far more cells than one
 * render window shows; past the cap the cache clears wholesale and the
 * next tick rebuilds just the visible window. */
const CELL_CACHE_LIMIT = 4000;

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
  const wobbleTargets = useRef<
    Map<string, { x: number; y: number; urgency: number }>
  >(new Map());
  // F-075 cell element cache: keyed `${col}:${row}`, dropped wholesale
  // when the world object changes identity (new trip, restored save).
  const cellElementCache = useRef<Map<string, MineCellEntry>>(new Map());
  const cellCacheWorld = useRef<object | null>(null);
  // Cached cell elements bake their click handlers in, so the handlers
  // dispatch through a ref that always sees the latest prop.
  const onToggleSupportRef = useRef(onToggleSupport);
  onToggleSupportRef.current = onToggleSupport;
  const dispatchToggleSupport = useCallback((target: CollectTarget) => {
    onToggleSupportRef.current?.(target);
  }, []);
  const teeterMotionFrames = useRef(0);
  const crushTumble = useRef<{ key: number; state: CrushTumbleState } | null>(
    null,
  );
  const crushTumbleFrames = useRef(0);
  const timeOfDay = useRef({
    grade: daylightGradeFor(12),
    nextCheck: 0,
  });
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
  // Frame-loop scratch: reused across frames so posing the miner,
  // sampling glides, and writing diagnostics allocate nothing per frame.
  const datasetCache = useRef<Record<string, number | string>>({});
  const motionSample = useRef<[number, number]>([0, 0]);
  const minerPoseScratch = useRef(createMinerPose());
  const rigInputs = useRef(minerRigRestInputs());
  const particleCounts = useRef({ spark: 0, debris: 0, dust: 0 });
  const particleInstFor = useRef<
    Record<(typeof PARTICLE_KINDS)[number], InstancedMesh | null>
  >({ spark: null, debris: null, dust: null });
  // Capability gate: shadow passes only when the real WebGPU backend is
  // driving; the WebGL2 fallback (headless CI, software GL, weak GPUs)
  // cannot afford them regardless of the pointer-derived tier.
  const webgpuBackend = useThree((state) => isWebGPUBackend(state.gl));
  const { fallPlayback, fallWindow, clearFallPlayback } =
    useMineDeathPlaybackBridge(lastResult, tick);
  const renderedCellCountRef = useRef(0);
  const renderedCrackSegmentCountRef = useRef(0);
  const renderedTeeterCountRef = useRef(0);
  const renderedGasWispCountRef = useRef(0);

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
    // One alias pair for the whole frame: every diagnostics write below
    // goes through the same quantize-and-cache pair.
    const dataset = state.gl.domElement.dataset;
    const cache = datasetCache.current;
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
      [visualTargetX, visualTargetY] = sampleMotion(
        activeFall.track,
        t,
        motionSample.current,
      );
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
        const [cx, cy] = sampleMotion(
          cameraMotion.current,
          t,
          motionSample.current,
        );
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
      setDatasetNumber(cache, dataset, "camX", rig.position.x, 2);
      setDatasetNumber(cache, dataset, "camY", rig.position.y, 2);
      setDatasetNumber(cache, dataset, "camZoom", cameraZoom, 2);
      setDatasetNumber(cache, dataset, "renderBelow", renderWindow.below, 0);
      setDatasetNumber(cache, dataset, "litBelow", litBelow, 0);
      setDatasetNumber(cache, dataset, "lampDistance", lampDistance, 2);
      setDatasetNumber(cache, dataset, "renderRadius", renderRadius, 0);
      setDatasetNumber(cache, dataset, "renderMinCol", firstCol, 0);
      setDatasetNumber(cache, dataset, "renderMaxCol", lastCol, 0);
      setDatasetNumber(
        cache,
        dataset,
        "renderedCellCount",
        renderedCellCountRef.current,
        0,
      );
      setDatasetNumber(
        cache,
        dataset,
        "crackSegmentCount",
        renderedCrackSegmentCountRef.current,
        0,
      );
      // Live teetering blocks (undercut or span-condemned) plus proof the
      // tremble is really displacing meshes, for QA on collapse warnings
      // and plank rescues (Rule 10: pixels must move, not just flags).
      setDatasetNumber(
        cache,
        dataset,
        "teeterCount",
        renderedTeeterCountRef.current,
        0,
      );
      setDatasetNumber(
        cache,
        dataset,
        "teeterMotionFrames",
        teeterMotionFrames.current,
        0,
      );
      setDatasetNumber(
        cache,
        dataset,
        "gasWispCount",
        renderedGasWispCountRef.current,
        0,
      );
      setDatasetNumber(
        cache,
        dataset,
        "crushTumbleFrames",
        crushTumbleFrames.current,
        0,
      );
      setDatasetNumber(cache, dataset, "particleCount", j.particles.length, 0);
      setDatasetNumber(
        cache,
        dataset,
        "darknessOpacityMin",
        hasDarknessOverlay ? minDarknessOpacity : 0,
        2,
      );
      setDatasetNumber(
        cache,
        dataset,
        "darknessOpacityMax",
        hasDarknessOverlay ? maxDarknessOpacity : 0,
        2,
      );
      setDatasetNumber(
        cache,
        dataset,
        "cameraMotionFrames",
        cameraMotion.current?.frames ?? 0,
        0,
      );
      depthT = Math.min(1, Math.max(0, -rig.position.y / DARK_DEPTH));
    }
    // Daylight dies with depth; the lamp takes over as the key light.
    // The surface sun also follows the player's real clock (G4): warm at
    // the edges of the day, cool and dim at night, full at noon. The
    // grade re-reads the clock once a minute and never blocks a frame.
    if (t >= timeOfDay.current.nextCheck) {
      const now = new Date();
      const override = (
        window as unknown as { __vibebotsTimeOfDayHour?: number }
      ).__vibebotsTimeOfDayHour;
      timeOfDay.current.grade = daylightGradeFor(
        override ?? now.getHours() + now.getMinutes() / 60,
      );
      timeOfDay.current.nextCheck = t + 60;
    }
    const grade = timeOfDay.current.grade;
    const day = (1 - depthT) ** 1.7;
    if (ambientRef.current) ambientRef.current.intensity = 0.07 + 0.48 * day;
    if (hemiRef.current) {
      hemiRef.current.intensity = 0.5 * day * day;
      hemiRef.current.color.set(grade.skyColor);
    }
    if (dirRef.current) {
      dirRef.current.intensity = (0.06 + 1.04 * day) * grade.sunStrength;
      dirRef.current.color.set(grade.sunColor);
    }
    setDatasetText(cache, dataset, "timeOfDay", grade.phase);
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
        const [mx, my] = sampleMotion(
          minerMotion.current,
          t,
          motionSample.current,
        );
        miner.position.set(mx, my, 0.2);
      }
      // Rendered position exposed for motion QA (Rule 10): e2e reads these
      // to prove the glide never lifts toward the surface on lateral steps.
      setDatasetNumber(cache, dataset, "minerX", miner.position.x, 2);
      setDatasetNumber(cache, dataset, "minerY", miner.position.y, 2);
      setDatasetNumber(
        cache,
        dataset,
        "minerMotionFrames",
        minerMotion.current?.frames ?? 0,
        0,
      );
      setDatasetText(
        cache,
        dataset,
        "fallVisualActive",
        activeFall ? "true" : "false",
      );
      setDatasetText(
        cache,
        dataset,
        "fallVisualImpact",
        activeFall?.impacted ? "true" : "false",
      );
      setDatasetText(
        cache,
        dataset,
        "fallingRockWarning",
        j.fallWarning > 0 ? "true" : "false",
      );
      // Last frame's draw-call count: the budget that phones live by.
      setDatasetNumber(
        cache,
        dataset,
        "drawCalls",
        state.gl.info.render.calls,
        0,
      );
      // Smoothed frame time: a steady low value means no per-step hitches.
      frameMsRef.current += (delta * 1000 - frameMsRef.current) * 0.1;
      setDatasetNumber(cache, dataset, "frameMs", frameMsRef.current, 1);
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
      if (prev) {
        prev.x = miner.position.x;
        prev.y = miner.position.y;
      } else {
        prevMinerPos.current = { x: miner.position.x, y: miner.position.y };
      }
      // A landed crush plays the physically integrated tumble instead of
      // the static crumple: the block's hit launches the wreck, it
      // bounces out its energy, and the pose settles into the designed
      // crumple the trip report has always framed.
      const crushLanded =
        activeFall?.kind === "crush" ? activeFall.impacted : false;
      let pose: MinerPose;
      if (crushLanded && activeFall) {
        if (crushTumble.current?.key !== activeFall.key) {
          crushTumble.current = {
            key: activeFall.key,
            state: createCrushTumble(
              cellHash(activeFall.col, activeFall.toRow, 83),
            ),
          };
        }
        const beforeY = crushTumble.current.state.y;
        pose = advanceCrushTumble(
          crushTumble.current.state,
          delta,
          minerPoseScratch.current,
        );
        if (Math.abs(crushTumble.current.state.y - beforeY) > 0.0004) {
          crushTumbleFrames.current += 1;
        }
      } else {
        if (!activeFall) crushTumble.current = null;
        const inputs = rigInputs.current;
        inputs.t = t;
        inputs.delta = delta;
        inputs.facing = j.facing;
        inputs.stepDistance = Math.sqrt(dx * dx + dy * dy);
        inputs.leanVx = visualTargetX - miner.position.x;
        inputs.swing = j.swing;
        inputs.bounce = j.bounce;
        inputs.lunge = j.lunge;
        inputs.crushed = false;
        inputs.still = false;
        pose = advanceMinerRig(
          minerRig.current,
          inputs,
          minerPoseScratch.current,
        );
      }
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
      // G4: the dust drifts instead of only spinning, so the lamp-lit
      // air reads as air.
      motes.position.x = Math.sin(t * 0.21) * 0.4;
      motes.position.y = Math.sin(t * 0.35) * 0.3;
    }
    // Teetering blocks tremble every frame, harder and faster the closer
    // they are to dropping (the escalating tell). Rescued or dropped
    // blocks leave the targets map: their mesh snaps back to rest.
    let teeterMoved = false;
    // Map.forEach: entry-tuple iteration allocates a [key, value] array
    // per teetering block per frame; the callback form does not.
    wobbleRefs.current.forEach((mesh, wobbleKey) => {
      const target = wobbleTargets.current.get(wobbleKey);
      if (!target) {
        mesh.position.x = (mesh.userData.baseX as number) ?? mesh.position.x;
        wobbleRefs.current.delete(wobbleKey);
        return;
      }
      const prevX = mesh.position.x;
      mesh.position.x =
        target.x +
        Math.sin(t * (22 + 16 * target.urgency) + target.y) *
          (0.015 + 0.05 * target.urgency);
      if (Math.abs(mesh.position.x - prevX) > 0.0005) teeterMoved = true;
    });
    if (teeterMoved) teeterMotionFrames.current += 1;
    // Particles: integrate, gravity, expire; positions sync imperatively
    // (creation/removal re-renders on tick).
    const particles = j.particles;
    let alive = 0;
    for (const p of particles) {
      p.life -= delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy -= p.gravity * delta;
      // Compact in place: survivors slide down over the expired, so the
      // array (and its backing store) is reused instead of refiltered.
      if (p.life > 0) particles[alive++] = p;
    }
    particles.length = alive;
    // Instanced particle write-out: one draw per kind, no React
    // reconciliation on spawn or expiry (W3).
    const instFor = particleInstFor.current;
    instFor.spark = sparkInstRef.current;
    instFor.debris = debrisInstRef.current;
    instFor.dust = dustInstRef.current;
    const counts = particleCounts.current;
    counts.spark = 0;
    counts.debris = 0;
    counts.dust = 0;
    const matrix = particleMatrix.current;
    const colorScratch = particleColor.current;
    for (const p of particles) {
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
    for (const kind of PARTICLE_KINDS) {
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

  // Register a teetering block's mesh so useFrame can tremble it; the
  // urgency (0..1, rising as the countdown nears zero) drives the shake.
  // The mesh handle registers once via the mount ref; the per-render
  // targets map carries the live urgency. React 19 does not re-invoke a
  // callback ref just because its closure identity changed, so clearing
  // the handle map during render silently killed the tremble. The ref
  // callback bakes into cached cell elements, so it carries no per-render
  // state; the loop below refreshes wobbleTargets every render.
  wobbleTargets.current.clear();
  const teeterMeshRef =
    (key: string, x: number) => (mesh: Group | Mesh | null) => {
      if (mesh) {
        mesh.userData.baseX = x;
        wobbleRefs.current.set(key, mesh);
      } else {
        wobbleRefs.current.delete(key);
      }
    };
  // Span-destabilized ceilings start on a longer countdown than the
  // undercut teeter, so the ramp clamps to a gentle floor instead of
  // going negative: distant dooms tremble softly, imminent ones shake.
  const teeterUrgency = (fallIn: number) =>
    Math.min(
      1,
      Math.max(0.2, (FALL_DELAY_ACTIONS - fallIn + 1) / FALL_DELAY_ACTIONS),
    );
  const blockMeshes = [];
  const tunnelMeshes = [];
  const cargoMeshes = [];
  const crackMeshes = [];
  const darknessMeshes = [];
  const supportSelectionMeshes = [];
  let minDarknessOpacity = 1;
  let maxDarknessOpacity = 0;
  let renderedCellCount = 0;
  let renderedTeeterCount = 0;
  let renderedGasWispCount = 0;
  let renderedCrackSegmentCount = 0;
  const selectedSupportSet = new Set(selectedSupportKeys ?? []);
  const dynamitePreviewSet = new Set(
    (dynamitePreviewCells ?? []).map((coord) => `${coord.col}:${coord.row}`),
  );
  // F-075: rebuilding every visible cell's elements on every store tick
  // made React reconcile the whole grid per action (and per row during a
  // fall), the per-tick churn behind the fall hitches. Cells now build
  // through a signature-keyed cache; the loop below serves unchanged
  // cells the previous element references and React bails out on them.
  const cellCache = cellElementCache.current;
  if (cellCacheWorld.current !== mine || cellCache.size > CELL_CACHE_LIMIT) {
    cellCache.clear();
    cellCacheWorld.current = mine;
  }
  const supportToggle = onToggleSupport ? dispatchToggleSupport : null;
  const buildCellEntry = (
    sig: string,
    cell: MineCell,
    col: number,
    row: number,
    key: string,
    x: number,
    y: number,
    dynamitePreview: boolean,
    darknessOpacity: number,
    damage: number | null,
    canSalvage: boolean,
    ladderSelected: boolean,
    beaconSelected: boolean,
    plankSelected: boolean,
    drop: { count: number; ore: OreId | null } | null,
  ): MineCellEntry => {
    const biome = biomeAt(col);
    const entry: MineCellEntry = {
      sig,
      block: [],
      cargo: [],
      darkness: [],
      tunnel: [],
      crack: [],
      support: [],
      darknessOpacity,
      crackSegments: damage === null ? 0 : crackSegmentCountForDamage(damage),
      gasWisp: cell.kind === "gas" && cell.gasSeeped === true,
    };
    if (cell.bag) {
      const bagOnBlock = cell.kind !== "empty";
      entry.cargo.push(
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
    if (dynamitePreview) {
      entry.crack.push(
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
    if (darknessOpacity > 0) {
      entry.darkness.push(
        <mesh key={`dark:${key}`} position={[x, y, 0.72]}>
          <planeGeometry args={[1.08, 1.08]} />
          <meshBasicMaterial
            color={EDGE_DARKNESS_COLOR}
            transparent
            opacity={darknessOpacity}
            depthWrite={false}
          />
        </mesh>,
      );
    }
    // Damaged blocks wear cracks (REQ-013); the overlay rides above
    // whatever shape the kind renders.
    if (damage !== null) {
      entry.crack.push(
        <group key={`crack:${key}`} position={[x, y, 0]}>
          <CrackMarks col={col} row={row} damage={damage} />
        </group>,
      );
    }
    if (cell.kind === "empty") {
      // Carved tunnels read as recessed rock, not as holes in the sky.
      if (row >= 1) {
        entry.tunnel.push(
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
        const toggleLadder = canSalvage ? supportToggle : null;
        if (toggleLadder) {
          entry.support.push(
            <SupportCellHitTarget
              key={`support-hit:ladder:${key}`}
              target={{ type: "ladder", col, row }}
              onToggleSupport={toggleLadder}
            />,
          );
        }
        if (ladderSelected) {
          entry.support.push(
            <SelectedSupportCellOutline
              key={`selected-cell:ladder:${key}`}
              col={col}
              row={row}
            />,
          );
        }
        entry.tunnel.push(
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
                  color={canSalvage ? "#d9a052" : "#a87b3e"}
                  emissive={canSalvage ? "#5a3411" : "#000000"}
                  emissiveIntensity={canSalvage ? 0.16 : 0}
                  roughness={0.85}
                  flatShading
                />
              </mesh>
            ))}
            {[-0.3, 0, 0.3].map((ry) => (
              <mesh key={ry} position={[0, ry, 0]}>
                <boxGeometry args={[0.36, 0.05, 0.05]} />
                <meshStandardMaterial
                  color={canSalvage ? "#ffd078" : "#c99a55"}
                  emissive={canSalvage ? "#5a3411" : "#000000"}
                  emissiveIntensity={canSalvage ? 0.18 : 0}
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
        const toggleBeacon = canSalvage ? supportToggle : null;
        entry.tunnel.push(
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
                color={canSalvage ? "#8d58b8" : "#5a3a78"}
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
      if (drop && drop.count > 0) {
        const oreColor = drop.ore ? ORE_COLORS[drop.ore] : CACHE_COLOR;
        entry.tunnel.push(
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
        const togglePlank = canSalvage ? supportToggle : null;
        if (togglePlank) {
          entry.support.push(
            <SupportCellHitTarget
              key={`support-hit:plank:${key}`}
              target={{ type: "plank", col, row }}
              onToggleSupport={togglePlank}
            />,
          );
        }
        if (plankSelected) {
          entry.support.push(
            <SelectedSupportCellOutline
              key={`selected-cell:plank:${key}`}
              col={col}
              row={row}
            />,
          );
        }
        entry.tunnel.push(
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
                  color={canSalvage ? "#e4ad5b" : "#b58a4a"}
                  emissive={canSalvage ? "#4a2d10" : "#000000"}
                  emissiveIntensity={canSalvage ? 0.14 : 0}
                  roughness={0.85}
                  flatShading
                />
              </mesh>
            ))}
            <mesh position={[0, -0.05, 0]}>
              <boxGeometry args={[0.2, 0.06, 0.56]} />
              <meshStandardMaterial
                color={canSalvage ? "#ba8240" : "#8a6536"}
                emissive={canSalvage ? "#4a2d10" : "#000000"}
                emissiveIntensity={canSalvage ? 0.12 : 0}
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
      return entry;
    }
    if (cell.kind === "ore" && cell.ore) {
      entry.block.push(
        <group
          key={key}
          position={[x, y, 0]}
          ref={cell.fallIn !== undefined ? teeterMeshRef(key, x) : undefined}
        >
          <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
        </group>,
      );
      return entry;
    }
    if (cell.kind === "rock") {
      const teeter = cell.fallIn;
      const urgency = teeter !== undefined ? teeterUrgency(teeter) : 0;
      if (teeter !== undefined || cell.fallen) {
        entry.block.push(
          <group
            key={key}
            position={[x, y, 0]}
            ref={teeter !== undefined ? teeterMeshRef(key, x) : undefined}
          >
            <FallingRockShard col={col} row={row} urgency={urgency} />
          </group>,
        );
        return entry;
      }
      entry.block.push(
        <group key={key} position={[x, y, 0]}>
          <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
        </group>,
      );
      return entry;
    }
    if (cell.kind === "boulder") {
      const teeter = cell.fallIn;
      const urgency = teeter !== undefined ? teeterUrgency(teeter) : 0;
      entry.block.push(
        <mesh
          key={key}
          position={[x, y, 0]}
          rotation={[0, cellHash(col, row, 29) * 3.1, 0]}
          ref={teeter !== undefined ? teeterMeshRef(key, x) : undefined}
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
      return entry;
    }
    if (cell.kind === "part-cache") {
      entry.block.push(
        <group key={key} position={[x, y, 0]}>
          <CacheCrate col={col} row={row} />
        </group>,
      );
      return entry;
    }
    if (cell.kind === "magma") {
      entry.block.push(
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
      return entry;
    }
    if (cell.kind === "gas") {
      // A seeped wisp reads as haze, not rock: translucent, smaller,
      // glowing brighter so a leak stands out from the pocket it left.
      if (cell.gasSeeped) {
        renderedGasWispCount += 1;
        entry.block.push(
          <mesh key={key} position={[x, y, 0]}>
            <sphereGeometry args={[0.42, 10, 8]} />
            <meshStandardMaterial
              color={
                biome === "winter"
                  ? "#9ee7ff"
                  : biome === "highTech"
                    ? "#65ffb8"
                    : GAS_COLOR
              }
              emissive={
                biome === "winter"
                  ? "#9ee7ff"
                  : biome === "highTech"
                    ? "#65ffb8"
                    : GAS_COLOR
              }
              emissiveIntensity={0.4}
              transparent
              opacity={0.42}
              depthWrite={false}
              roughness={0.9}
            />
          </mesh>,
        );
        return entry;
      }
      entry.block.push(
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
      return entry;
    }
    if (cell.kind === "metal") {
      entry.block.push(
        <group key={key} position={[x, y, 0]}>
          <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
        </group>,
      );
      return entry;
    }
    // Dirt and anything else: the shared body (per-cell tone variation
    // and soil grain live in the shader now). A wide-span ceiling cell
    // teeters like a rock: the tremble is the collapse warning.
    entry.block.push(
      <group
        key={key}
        position={[x, y, 0]}
        ref={cell.fallIn !== undefined ? teeterMeshRef(key, x) : undefined}
      >
        <MineBlockBody cell={cell} col={col} row={row} biome={biome} />
      </group>,
    );
    return entry;
  };
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
      // Per-render bookkeeping that cache hits must still produce: the
      // wobble targets map was cleared above and carries the live
      // urgency to the frame loop.
      if (cell.fallIn !== undefined) {
        renderedTeeterCount += 1;
        wobbleTargets.current.set(key, {
          x,
          y,
          urgency: teeterUrgency(cell.fallIn),
        });
      }
      // Signature inputs: everything the cell's JSX reads that can
      // change while the cell stays on screen.
      const dynamitePreview = dynamitePreviewSet.has(key);
      const beyondLight = Math.max(0, distanceFromMiner - litBelow);
      const darknessOpacity =
        beyondLight > 0
          ? mineDarknessOpacity(beyondLight, cameraZoom, maxCameraZoom)
          : 0;
      const oreDamage =
        cell.kind === "ore" && cell.ore && cell.oreRemaining !== undefined
          ? 1 - cell.oreRemaining / oreReserveAt(cell.ore, row)
          : null;
      let damage = oreDamage;
      if (damage === null && cell.hp !== undefined && cell.kind !== "empty") {
        damage = 1 - cell.hp / hitsFor(cell.kind, mine.gear);
      }
      const canSalvage =
        collectMode && (cell.ladder || cell.plank || cell.beacon)
          ? isSupportSalvageTarget(mine, col, row)
          : false;
      const ladderSelected =
        canSalvage &&
        cell.ladder === true &&
        selectedSupportSet.has(`ladder:${col},${row}`);
      const beaconSelected =
        canSalvage &&
        cell.beacon === true &&
        selectedSupportSet.has(`beacon:${col},${row}`);
      const plankSelected =
        canSalvage &&
        cell.plank === true &&
        selectedSupportSet.has(`plank:${col},${row}`);
      const drop = cell.kind === "empty" ? dropPileStats(cell) : null;
      // Sub-0.001 opacity/damage drift is invisible; quantizing it keeps
      // camera zoom eases from rebuilding every darkened cell per tick.
      const sig =
        `${cell.kind}|${cell.ore ?? ""}|${cell.rockTier ?? 0}|` +
        `${cell.fallIn ?? -1}|${cell.fallen ? 1 : 0}${cell.ladder ? 1 : 0}` +
        `${cell.plank ? 1 : 0}${cell.beacon ? 1 : 0}` +
        `${cell.gasSeeped ? 1 : 0}${cell.bag ? 1 : 0}|` +
        `${drop ? drop.count : 0}:${drop?.ore ?? ""}|` +
        `${dynamitePreview ? 1 : 0}|${Math.round(darknessOpacity * 1000)}|` +
        `${damage === null ? "" : Math.round(damage * 1000)}|` +
        `${canSalvage ? 1 : 0}${ladderSelected ? 1 : 0}` +
        `${beaconSelected ? 1 : 0}${plankSelected ? 1 : 0}` +
        `${supportToggle ? 1 : 0}`;
      let entry = cellCache.get(key);
      if (entry === undefined || entry.sig !== sig) {
        entry = buildCellEntry(
          sig,
          cell,
          col,
          row,
          key,
          x,
          y,
          dynamitePreview,
          darknessOpacity,
          damage,
          canSalvage,
          ladderSelected,
          beaconSelected,
          plankSelected,
          drop,
        );
        cellCache.set(key, entry);
      }
      for (const el of entry.cargo) cargoMeshes.push(el);
      for (const el of entry.crack) crackMeshes.push(el);
      for (const el of entry.darkness) {
        minDarknessOpacity = Math.min(
          minDarknessOpacity,
          entry.darknessOpacity,
        );
        maxDarknessOpacity = Math.max(
          maxDarknessOpacity,
          entry.darknessOpacity,
        );
        darknessMeshes.push(el);
      }
      for (const el of entry.tunnel) tunnelMeshes.push(el);
      for (const el of entry.block) blockMeshes.push(el);
      for (const el of entry.support) supportSelectionMeshes.push(el);
      renderedCrackSegmentCount += entry.crackSegments;
      if (entry.gasWisp) renderedGasWispCount += 1;
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
  renderedTeeterCountRef.current = renderedTeeterCount;
  renderedGasWispCountRef.current = renderedGasWispCount;
  const hasDarknessOverlay = maxDarknessOpacity > 0;
  // G4: the deep strata press the fog in close; the surface breathes.
  const fogRange = fogRangeForStratum(stratumIndex);

  return (
    <>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, fogRange.near, fogRange.far]} />
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
      {/* G3 post stack: only where the real WebGPU backend pays for it. */}
      {graphicsFeatures.postBloom && webgpuBackend ? (
        <ScenePostProcessing />
      ) : null}
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
      <PerfProbeBridge source="mine" />
    </Canvas>
  );
}
