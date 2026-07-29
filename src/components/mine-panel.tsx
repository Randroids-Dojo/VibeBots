"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampMineCameraZoom,
  MINE_CAMERA_BUTTON_STEP,
  MINE_CAMERA_MIN_ZOOM,
  MINE_CAMERA_STORAGE_KEY,
  MINE_CAMERA_ZOOM_DEFAULT,
  maxMineCameraZoom,
  mineCameraDistance,
} from "@/components/mine-camera";
import type { AppRelease } from "@/lib/app-release-types";
import { MINE_REFRESH_ENTRY_KEY } from "@/lib/mine-refresh";
import { detectTvMode, tvSafeInsets } from "@/lib/tv-device";
import { tvRemoteDirection } from "@/lib/tv-remote-input";
import {
  AVAILABLE_BASE_PART_IDS,
  type BasePartId,
  type BunkerOrientation,
  bunkerCells,
  bunkerPartAtSlot,
  bunkerPartAtWholeCell,
  canonicalWallSlot,
  containsBunkerCell,
  isBasePartDamaged,
  isBunkerLayoutIncompatible,
  isRotatableBasePart,
  maxBunkerRaidTier,
  proposedBunkerFootprint,
} from "@/sim/bunker";
import {
  activatePortalAction,
  activePortalAt,
  authoredPortalAt,
  BAG_STACK_LIMIT,
  type CollectTarget,
  canDropThroughPlank,
  canJump,
  canPlacePlank,
  cargoCapacity,
  carriedCount,
  carriedStackCount,
  cellAt,
  climbWouldPlaceLadder,
  collectAction,
  collectablePlacements,
  createMine,
  DEFAULT_GEAR,
  type Direction,
  DYNAMITE_TIERS,
  type DynamiteTier,
  dropOreAction,
  dynamitePreviewCells,
  dynamiteTier,
  elevatorBoardingTarget,
  elevatorColumn,
  elevatorRailPrice,
  findPortalBeacons,
  MAX_BEACONS,
  MINE_BOTTOM_ROW,
  MINE_VERSION,
  type MineAction,
  type MineGear,
  type MineState,
  maxEnergy,
  NO_CONSUMABLES,
  OPPOSITE_DIRECTION,
  type OreId,
  oreDef,
  portalWarpAction,
  recallRopeRange,
  returnEnergyCost,
  returnHomeEstimate,
  type SoldHaul,
  START_COL,
  stratumAt,
  supportSalvageValue,
  warpRange,
} from "@/sim/mine";
import { PART_CATALOG } from "@/sim/parts";
import { useBunkerStore } from "@/state/bunker-store";
import {
  SAVE_SYNC_CHANNEL,
  tripChangedWorld,
  useMineStore,
} from "@/state/mine-store";
import type { FpEditIntent } from "./bunker-fp-grid";
import { BunkerFpHud } from "./bunker-fp-hud";
import { attachFpKeyboard, resetFpInput } from "./bunker-fp-input";
import { clearFpTutorialDone } from "./bunker-fp-tutorial";
import type {
  BunkerToolAction,
  BunkerToolSelection,
} from "./bunker-tool-types";
import { COMPILE_GATE_DEADLINE_MS } from "./compile-gate";
import {
  eventInsideRef,
  useOutsidePointerDismiss,
  useTvBackDismiss,
} from "./dismissible-dialog-frame";
import { AccountSyncPopup } from "./mine-account-popup";
import { MineBagPanel } from "./mine-bag-panel";
import { BunkerControlPanel } from "./mine-bunker-control-panel";
import {
  CRUSH_REPORT_AFTER_IMPACT_MS,
  FALL_REPORT_AFTER_IMPACT_MS,
  POWER_DOWN_REPORT_AFTER_IMPACT_MS,
  wreckReportCeilingMs,
} from "./mine-death-playback";
import { DESTINATIONS, destinationAt } from "./mine-destinations";
import { MineElevatorControls } from "./mine-elevator-controls";
import {
  type ElevatorPresentation,
  type ElevatorPresentationStage,
  type ElevatorRideAction,
  initialElevatorPresentation,
} from "./mine-elevator-presentation";
import {
  createDirectionCadenceController,
  type DirectionCadenceController,
} from "./mine-input-cadence";
import { actionRepeatMs } from "./mine-pacing";
import { useMinePerformanceSampling } from "./mine-performance-sampling";
import { ReleaseNotesPopup } from "./mine-release-notes-popup";
import { SaveConflictPopup } from "./mine-save-conflict-popup";
import { SaveSlotsPopup } from "./mine-save-slots-popup";
import {
  CreditsDialog,
  FallingRockHazardAlert,
  type FeedbackContext,
  FeedbackDialog,
  IosHomeScreenPrompt,
  LadderGravityFeedbackPrompt,
  PerfTelemetryControl,
  ReleaseNotificationControl,
} from "./mine-settings-dialogs";
import { mineShopNoteSfxEvent, playMineSfxEvent } from "./mine-sfx";
import { sheetButtonStyle, triggerShopHaptic } from "./mine-sheet-controls";
import { STALL_ICONS, StallMenu } from "./mine-stall-menu";
import { STALLS, stallAt } from "./mine-stalls";
import { StampBookPopup } from "./mine-stamp-book-popup";
import { MineTouchControls } from "./mine-touch-controls";
import { MineTvControls, type TvCenterAction } from "./mine-tv-controls";
import { PerfTelemetry } from "./perf-telemetry";
import { StampCollectAlert } from "./stamp-collect-alert";
import { useForegroundReturn } from "./use-foreground-return";

type MineSceneStatus = "loading" | "ready" | "error";
const MINE_SCENE_LOAD_ERROR =
  "The network dropped before the mine could load. Your save was not changed. Check the connection and retry.";
const STRATUM_BANNER_MS = 2600;

function MineSceneBackdrop({ veil = false }: { veil?: boolean }) {
  return (
    <div
      className={
        veil
          ? "mine-scene-backdrop mine-scene-backdrop-veil"
          : "mine-scene-backdrop"
      }
      aria-hidden="true"
    />
  );
}

function MineSceneNotice({
  status,
  message,
  onRetry,
}: {
  status: "loading" | "error";
  message?: string;
  onRetry?: () => void;
}) {
  const loading = status === "loading";
  return (
    <div
      className="mine-scene-notice"
      role={loading ? "status" : "alert"}
      aria-live={loading ? "polite" : "assertive"}
    >
      <div className="mine-scene-loader" aria-hidden="true">
        <span className="mine-scene-loader-rail" />
        <span className="mine-scene-loader-cart">
          <span className="mine-scene-loader-gem" />
          <span className="mine-scene-loader-gem" />
          <span className="mine-scene-loader-gem" />
        </span>
        <span className="mine-scene-loader-bit" data-mine-loader-bit="true" />
      </div>
      <div className="mine-scene-notice-copy">
        <strong>{loading ? "Opening the shaft" : "Mine signal lost"}</strong>
        <span>
          {loading
            ? "Warming the lamps and loading your latest tunnel."
            : (message ?? MINE_SCENE_LOAD_ERROR)}
        </span>
      </div>
      {!loading && onRetry && (
        <button type="button" className="mine-scene-retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

class MineSceneErrorBoundary extends Component<
  {
    children: ReactNode;
    onError: (message: string) => void;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error.message || "The mine renderer failed to start.");
  }

  render() {
    if (this.state.error) return <MineSceneBackdrop />;
    return this.props.children;
  }
}

const MineCanvas = dynamic(() => import("./mine-canvas"), {
  ssr: false,
  // The chunk downloads inside the first-paint window, where the panel
  // already shows the backdrop veil and the loading notice; a second
  // notice here would stack a duplicate card on top of it.
  loading: () => <MineSceneBackdrop />,
});

// The first-person bunker viewer swaps in for MineCanvas while the
// player walks their claim interior; the swap hides behind the same
// first-paint veil, so its loading placeholder matches.
const BunkerFpCanvas = dynamic(() => import("./bunker-fp-canvas"), {
  ssr: false,
  loading: () => <MineSceneBackdrop />,
});

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowLeft: "left",
  ArrowRight: "right",
  s: "down",
  w: "up",
  a: "left",
  d: "right",
};

/** Shift uppercases letter keys; lowercase single chars so w/a/s/d still
 * match KEY_DIRECTIONS, and leave multi-char keys (the arrows) untouched. */
const normalizeKeyName = (key: string) =>
  key.length === 1 ? key.toLowerCase() : key;

/** Bunker tool hotkeys (2D and first-person) ignore modified chords and
 * keystrokes aimed at editable targets; those stay with the browser. */
function bunkerToolKeyIgnored(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target as HTMLElement | null;
  return Boolean(
    target &&
      (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)),
  );
}

const MINE_CAMERA_FOV_DEGREES = 42;
const DYNAMITE_TIER_LABELS: Record<DynamiteTier, string> = {
  1: "Pulse",
  2: "Bore",
  3: "Block",
  4: "Lamp wipe",
};
const DYNAMITE_TIER_BLURBS: Record<DynamiteTier, string> = {
  1: "1 cell up, down, left, and right",
  2: "2 up, 2 left, 2 right, 3 down",
  3: "3 by 3 square around the miner",
  4: "clears blastable cells inside lamp range",
};

function accountFallbackPreflightRequired(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return (
    url.searchParams.get("account") === "1" &&
    !url.searchParams.has("accountHandoff")
  );
}

/** Drops a query param from the address bar without navigating. */
function stripQueryParam(name: string): void {
  const next = new URL(window.location.href);
  if (!next.searchParams.has(name)) return;
  next.searchParams.delete(name);
  window.history.replaceState(
    null,
    "",
    `${next.pathname}${next.search}${next.hash}`,
  );
}

const MINE_SURFACE_TIPS = [
  "Tip: rich ore may need several hits. Every swing still costs battery.",
  "Tip: press up into solid ground to dig overhead without using a ladder.",
  "Tip: falling rocks drop after two moves and need at least two hits to break.",
  "Tip: every rock and boulder breaks with the right pickaxe. A blocked swing names the level it needs.",
  "Tip: tunnels five cells wide shake their roof loose. A plank props the ceiling above it.",
  "Tip: Lantern upgrades reveal more rows and let you zoom out farther.",
  "Tip: Buy ladders and planks at the Supply Depot before heading deeper.",
  "Tip: Dynamite collects the ore and parts it breaks if your hold has room.",
  "Tip: Upgrade Blast Charge to unlock larger dynamite blast shapes.",
  "Tip: Upgrade Recall Rope to bank from deeper rows.",
  "Tip: Head up to the surface to save the shafts you dug, even with an empty bag.",
  "Tip: Planted beacons only work within your current Warpcoil range.",
  "Tip: Distant biome beacons become free portals back to base.",
  "Tip: Clankers chew blockers with remaining battery, so layered walls matter.",
  "Tip: Player levels unlock higher raid tiers: bigger waves, tougher bites, more XP.",
  "Tip: Inside your bunker, Start raid drops you into a live first-person fight. The Clankers hunt you down through the halls, and stopping one drops XP to walk over.",
  "Tip: Your pickaxe is a weapon during a raid: swing at the nearest Clanker in front of you.",
  "Tip: Bites cost health, not the raid. Fight one Clanker, run from two.",
  "Tip: Leaving a live raid forfeits it: press Escape or tap Leave raid in the HUD. You cannot slip out and re-enter to retry, so hold your ground.",
  "Tip: The Clankers regroup for hours after a raid, win or lose. The Start raid spot counts down to the next one.",
  "Tip: A Clanker bursting through your wall needs a moment to get its legs. Keep moving; a surfacing one cannot strike yet.",
  "Tip: Your starter kit seals the player cell: floors below, roofs above, wall and door beside.",
  "Tip: Bunker skins are pure paint. A bought skin is yours forever and reselects free.",
  "Tip: Standing in your claim, Enter bunker is the way to build: walk it in first person.",
  "Tip: In first person, hold the pick and drag your aim to mine claim rock cell after cell. Parts place at the crosshair; pry returns them to your pack.",
  "Tip: Aim a wall or roof at a surface to build it as a thin panel on that exact face. Corner a cell with two walls, or line a room without filling it.",
  "Tip: Place a Staircase and press R (or Rotate) to face it, then walk up it to climb one floor. Stack a couple to reach a room you dug out above.",
  "Tip: Floors build off whatever you aim at, any level: a stair top's side, a deck edge, or bare rock. Bridge outward cell by cell to lay a second story.",
  "Tip: Placed floors are thin decks: walk their tops, and a jump from below pops you up through one onto it.",
  "Tip: A fresh claim is a small pre-mined room in solid rock. Dig the walls, and even the floor, to open the space you want.",
  "Tip: Bunker blocks take real swings now: deeper claims cut harder, pickaxe upgrades shave hits, and ore chips loose swing by swing until the block breaks.",
  "Tip: Digging your bunker walls fills your cargo bag, richer the deeper you carve. Carry it up and bank it with your surface haul, because a cave-in loses it like any other ore.",
  "Tip: Your bunker walls show the mine's own dirt, rock, and ore for that depth. Break the cells where ore glints to bank what they are worth.",
  "Tip: Need the bunker basics again? Replay bunker tutorial lives in the settings gear.",
  "Tip: In first person on touch, walking into a one-block step hops it automatically.",
  "Tip: The bag chip in the top corner of the bunker view opens your cargo bag. Walking and digging pause while it is open.",
  "Tip: Sealed yourself in? Reset bunker in the Upkeep menu clears the build and refunds undamaged parts.",
  "Tip: Enter your shaft, wait for the car, then choose the top or bottom arrow.",
  "Tip: Row 1,000 needs rail, Warpcoil, Recall Rope, cargo, and battery upgrades.",
  "Tip: Use the Stamp Book for depth, tool, haul, and portal goals.",
  "Tip: One cloud save on two devices? Sync when prompted; runs never merge.",
] as const;

const MINE_SURFACE_TIP_EMPTY_SLOTS = 3;
const MINE_SURFACE_TIP_ROTATION_MS = 15_000;
const MINE_SURFACE_TIP_CHOICES: readonly (string | null)[] = [
  ...MINE_SURFACE_TIPS,
  ...Array.from({ length: MINE_SURFACE_TIP_EMPTY_SLOTS }, () => null),
];
const PICKAXE_GATE_HINT_MS = 1800;

interface MineSurfaceTipTestWindow {
  __vibebotsSurfaceTipSequence?: (string | null)[];
  __vibebotsSurfaceTipRotationMs?: number;
}

const BASE_BUILDING_COLS = [
  ...STALLS.map((stall) => stall.col),
  ...DESTINATIONS.map((destination) => destination.col),
];
const BASE_MIN_COL = Math.min(...BASE_BUILDING_COLS);
const BASE_MAX_COL = Math.max(...BASE_BUILDING_COLS);
const BASE_CENTER_COL = START_COL;

type ViewportSize = {
  width: number;
  height: number;
};

function baseReturnTarget(
  minerCol: number,
  cameraZoom: number,
  viewport: ViewportSize,
): {
  direction: "left" | "right";
  cost: number;
  distance: number;
} | null {
  const aspect = Math.max(0.5, viewport.width / Math.max(1, viewport.height));
  const halfWidth =
    Math.tan((MINE_CAMERA_FOV_DEGREES * Math.PI) / 360) *
    mineCameraDistance(cameraZoom) *
    aspect;
  const left = minerCol - halfWidth;
  const right = minerCol + halfWidth;
  if (BASE_MAX_COL >= left && BASE_MIN_COL <= right) return null;
  const direction = minerCol < BASE_CENTER_COL ? "right" : "left";
  const distance =
    minerCol < BASE_MIN_COL
      ? BASE_MIN_COL - minerCol
      : minerCol > BASE_MAX_COL
        ? minerCol - BASE_MAX_COL
        : Math.abs(minerCol - BASE_CENTER_COL);
  return {
    direction,
    distance,
    cost: Math.max(1, Math.min(9, Math.ceil(distance / 24))),
  };
}

function elevatorAutoDelayMs(gear: MineGear): number {
  // Test hook: slow (or speed) the automatic ride cadence so timing-sensitive
  // restore e2es can observe a mid-ride state without racing the real 240ms
  // step. Ignored in production (the global is never set).
  if (typeof window !== "undefined") {
    const override = (
      window as Window & { __vibebotsElevatorAutoDelayMs?: number }
    ).__vibebotsElevatorAutoDelayMs;
    if (typeof override === "number" && Number.isFinite(override)) {
      return Math.max(0, override);
    }
  }
  return Math.max(70, 240 - ((gear.elevatorSpeed ?? 1) - 1) * 20);
}

function randomMineSurfaceTip(current: string | null): string | null {
  const sequence =
    typeof window === "undefined"
      ? undefined
      : (window as Window & MineSurfaceTipTestWindow)
          .__vibebotsSurfaceTipSequence;
  if (sequence && sequence.length > 0) return sequence.shift() ?? null;
  const options = MINE_SURFACE_TIP_CHOICES.filter((tip) => tip !== current);
  const slot = options[Math.floor(Math.random() * options.length)];
  return slot ?? null;
}

const chipStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.82)",
  border: "1px solid #26304a",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: "0.8rem",
  lineHeight: 1.3,
  whiteSpace: "nowrap",
  display: "inline-block",
};

const statusChipStyle: React.CSSProperties = {
  ...chipStyle,
  boxSizing: "border-box",
  maxWidth: "min(560px, calc(100vw - 94px))",
  whiteSpace: "normal",
  overflowWrap: "break-word",
};

const compactChipStyle: React.CSSProperties = {
  ...chipStyle,
  boxSizing: "border-box",
  minWidth: 0,
  maxWidth: "100%",
  whiteSpace: "normal",
  overflowWrap: "break-word",
};

const RESOURCE_FLOAT_COLORS: Record<OreId, string> = {
  coal: "#8b93a7",
  copper: "#d28445",
  silver: "#cdd6ea",
  emerald: "#54e0c7",
  ruby: "#ff6b6b",
  diamond: "#7dd3fc",
  "core-crystal": "#d58cff",
  "frozen-coal": "#8ea5bd",
  "frost-copper": "#bddde8",
  "rime-silver": "#e6f8ff",
  "aurora-emerald": "#7fffd4",
  "glacier-ruby": "#ff7fb0",
  "blue-diamond": "#9ee7ff",
  "permafrost-core": "#d6f8ff",
  "brass-knob": "#d8a24a",
  "wire-spool": "#ff7a45",
  "logic-chip": "#5df2a4",
  "micro-monitor": "#7aa8ff",
  "keyboard-matrix": "#e6e8ee",
  "servo-motor": "#a2b0c7",
  "quantum-core": "#65ffb8",
};

const ORE_CELL_LABELS: Record<OreId, string> = {
  coal: "Co",
  copper: "Cu",
  silver: "Ag",
  emerald: "Em",
  ruby: "Ru",
  diamond: "Di",
  "core-crystal": "Cr",
  "frozen-coal": "Fc",
  "frost-copper": "Fp",
  "rime-silver": "Rs",
  "aurora-emerald": "Ae",
  "glacier-ruby": "Gr",
  "blue-diamond": "Bd",
  "permafrost-core": "Pc",
  "brass-knob": "Bk",
  "wire-spool": "Ws",
  "logic-chip": "Lc",
  "micro-monitor": "Mm",
  "keyboard-matrix": "Km",
  "servo-motor": "Sm",
  "quantum-core": "Qc",
};

type OreBagCell = {
  id: OreId;
  key: string;
  name: string;
  label: string;
  color: string;
  count: number;
  full: boolean;
};

function oreBagRows(carried: Partial<Record<OreId, number>>): Array<{
  id: OreId;
  name: string;
  count: number;
  value: number;
}> {
  return Object.entries(carried)
    .map(([id, count]) => {
      const def = oreDef(id as OreId);
      return {
        id: id as OreId,
        name: def.name,
        count: count ?? 0,
        value: def.value,
      };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function oreBagCells(carried: Partial<Record<OreId, number>>): OreBagCell[] {
  const cells: OreBagCell[] = [];
  for (const row of oreBagRows(carried)) {
    let remaining = row.count;
    for (let index = 0; remaining > 0; index++) {
      const count = Math.min(BAG_STACK_LIMIT, remaining);
      cells.push({
        id: row.id,
        key: `${row.id}-${index}`,
        name: row.name,
        label: ORE_CELL_LABELS[row.id],
        color: RESOURCE_FLOAT_COLORS[row.id],
        count,
        full: count >= BAG_STACK_LIMIT,
      });
      remaining -= count;
    }
  }
  return cells;
}

function selectedOrePileFromBagCells(
  cells: readonly OreBagCell[],
  selectedKeys: ReadonlySet<string>,
): { count: number; pile: Partial<Record<OreId, number>> } {
  const pile: Partial<Record<OreId, number>> = {};
  let count = 0;
  for (const cell of cells) {
    if (!selectedKeys.has(cell.key)) continue;
    count += cell.count;
    pile[cell.id] = (pile[cell.id] ?? 0) + cell.count;
  }
  return { count, pile };
}

function compactResourceList(
  rows: Array<{ name: string; count: number }>,
  limit = 2,
): string {
  const shown = rows.slice(0, limit).map((row) => `${row.name} x${row.count}`);
  const extra = rows.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
}

function bagDetailSummary(miner: MineState["miner"]): string {
  const rows = oreBagRows(miner.carried);
  const parts = miner.carriedParts.length;
  const hasScrap = miner.carriedSalvageCredits > 0;
  if (rows.length === 0 && parts === 0 && !hasScrap) return "No ore carried.";
  const labelParts: string[] = [];
  if (rows.length > 0) labelParts.push(compactResourceList(rows));
  if (hasScrap) labelParts.push("support scrap");
  if (parts > 0) labelParts.push(`${parts} part${parts > 1 ? "s" : ""}`);
  return labelParts.join(" + ");
}

function soldHaulLine(
  haul: SoldHaul | undefined,
  credits: number,
  parts: string[],
): string {
  const rows = haul ? oreBagRows(haul.ores) : [];
  const soldParts: string[] = [];
  if (rows.length > 0) soldParts.push(compactResourceList(rows, 4));
  if ((haul?.salvageCredits ?? 0) > 0) soldParts.push("support scrap");
  const sold = soldParts.length > 0 ? soldParts.join(", ") : "no resources";
  const found =
    parts.length > 0
      ? ` Found ${parts.length} part${parts.length > 1 ? "s" : ""}.`
      : "";
  return `Sold ${sold} for ${credits} vibes total.${found} Your mine stays.`;
}

const iconButtonStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.88)",
  border: "1px solid #26304a",
  borderRadius: 14,
  color: "#e6e8ee",
  minWidth: 54,
  height: 46,
  fontSize: "0.95rem",
  pointerEvents: "auto",
};

const jumpButtonStyle: React.CSSProperties = {
  ...iconButtonStyle,
  minWidth: 88,
  height: 64,
  borderRadius: 8,
  border: "2px solid #54e0c7",
  background: "rgba(15, 31, 37, 0.94)",
  color: "#eafff9",
  fontSize: "0.95rem",
  fontWeight: 900,
  letterSpacing: 0,
  boxShadow: "0 0 18px rgba(84, 224, 199, 0.2)",
};

const zoomButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 12,
  border: "1px solid #26304a",
  background: "rgba(17, 21, 31, 0.88)",
  color: "#e6e8ee",
  fontSize: "1.35rem",
  fontWeight: 900,
  lineHeight: 1,
  pointerEvents: "auto",
};

const SETTINGS_MENU_TOP = 206;
const SETTINGS_MENU_EDGE_GAP = 14;

const SURFACE_ACTION_PROMPT_BOTTOM = 154;

const surfaceActionPromptAnchorStyle: React.CSSProperties = {
  position: "absolute",
  bottom: SURFACE_ACTION_PROMPT_BOTTOM,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 8,
};

const mineShellStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  width: "100%",
  height: "100dvh",
  overflow: "hidden",
  overscrollBehavior: "none",
  touchAction: "none",
};

interface MineViewportFrame {
  displayMode: "browser" | "fullscreen" | "minimal-ui" | "standalone";
  height: number;
  layoutHeight: number;
  layoutWidth: number;
  left: number;
  refreshEntry: string;
  top: number;
  width: number;
}

function readMineDisplayMode(): MineViewportFrame["displayMode"] {
  if (window.matchMedia?.("(display-mode: fullscreen)").matches) {
    return "fullscreen";
  }
  if (window.matchMedia?.("(display-mode: standalone)").matches) {
    return "standalone";
  }
  if (window.matchMedia?.("(display-mode: minimal-ui)").matches) {
    return "minimal-ui";
  }
  return "browser";
}

function readMineViewportFrame(refreshEntry: string): MineViewportFrame {
  const visualViewport = window.visualViewport;
  const layoutWidth = window.innerWidth;
  const layoutHeight = window.innerHeight;
  return {
    displayMode: readMineDisplayMode(),
    height: visualViewport?.height ?? layoutHeight,
    layoutHeight,
    layoutWidth,
    left: visualViewport?.offsetLeft ?? 0,
    refreshEntry,
    top: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? layoutWidth,
  };
}

function mineViewportValue(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "unmeasured";
}

function collectTargetKey(target: CollectTarget): string {
  return `${target.type}:${target.col},${target.row}`;
}

/** Banner shown for a few seconds when the miner enters a new stratum. */
function StratumBanner({ row }: { row: number }) {
  const [banner, setBanner] = useState<{ key: number; text: string } | null>(
    null,
  );
  const bannerKey = useRef(0);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepestSeen = useRef(0);
  const stratum = stratumAt(row);

  useEffect(() => {
    return () => {
      if (bannerTimer.current !== null) {
        clearTimeout(bannerTimer.current);
      }
    };
  }, []);

  // The fade animation owns the banner's lifetime (onAnimationEnd). The
  // timer is only the stuck-banner reaper for environments where the
  // animation never runs, so it must outlast a late-starting animation:
  // entering a new stratum re-skins every block and can stall the main
  // thread past the mount, deferring the animation's start. A timer cut
  // to the animation length used to reap the banner mid-plateau, so the
  // fade-out never rendered on slow devices. Re-arming from the real
  // animationstart keeps the reaper tight without racing the fade.
  const armBannerTimer = useCallback((key: number, delayMs: number) => {
    if (bannerTimer.current !== null) {
      clearTimeout(bannerTimer.current);
    }
    bannerTimer.current = setTimeout(() => {
      setBanner((current) => (current?.key === key ? null : current));
      bannerTimer.current = null;
    }, delayMs);
  }, []);

  useEffect(() => {
    if (row <= deepestSeen.current) return;
    const wasStratum = stratumAt(deepestSeen.current);
    deepestSeen.current = row;
    if (stratum.name === wasStratum.name) return;
    const nextKey = bannerKey.current + 1;
    bannerKey.current = nextKey;
    setBanner({ key: nextKey, text: `Entering ${stratum.name}` });
    armBannerTimer(nextKey, STRATUM_BANNER_MS * 2);
  }, [row, stratum.name, armBannerTimer]);

  if (!banner) return null;
  return (
    <div
      key={banner.key}
      className="mine-stratum-banner"
      role="status"
      onAnimationStart={() =>
        armBannerTimer(banner.key, STRATUM_BANNER_MS + 400)
      }
      onAnimationEnd={() =>
        setBanner((current) => (current?.key === banner.key ? null : current))
      }
    >
      {banner.text}
    </div>
  );
}

/**
 * Render-layer near-miss search (REQ-019): the best treasure within
 * reach of the collapse point, from rows the client already generated.
 */
function nearMissLine(
  mine: MineState,
  at: { col: number; row: number },
  cause: "battery" | "crush" | "fall" | "abandon",
): string | null {
  let best: { name: string; value: number; dist: number } | null = null;
  const lo = Math.max(1, at.row - 6);
  const hi = at.row + 6;
  for (let r = lo; r <= hi; r++) {
    for (let c = at.col - 6; c <= at.col + 6; c++) {
      const cell = cellAt(mine, c, r);
      if (!cell) continue;
      const dist = Math.abs(r - at.row) + Math.abs(c - at.col);
      if (dist === 0 || dist > 6) continue;
      const value =
        cell.kind === "part-cache"
          ? 999
          : cell.kind === "ore" && cell.ore
            ? oreDef(cell.ore).value
            : 0;
      if (value < 20) continue;
      const name =
        cell.kind === "part-cache"
          ? "a part cache"
          : cell.ore
            ? oreDef(cell.ore).name.toLowerCase()
            : "";
      if (
        !best ||
        value > best.value ||
        (value === best.value && dist < best.dist)
      ) {
        best = { name, value, dist };
      }
    }
  }
  if (!best) return null;
  const what = best.name === "a part cache" ? best.name : `a ${best.name}`;
  const place =
    cause === "crush"
      ? "where the rock fell"
      : cause === "fall"
        ? "where the fall ended"
        : cause === "abandon"
          ? "where the bag dropped"
          : "where the battery died";
  return `${what} sat ${best.dist} block${best.dist > 1 ? "s" : ""} from ${place}.`;
}

interface FloatNote {
  id: number;
  text: string;
  color: string;
  glow: string;
}

/** Floating collection text, cache fanfare, and the collapse reveal. */
function JuiceOverlays() {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const clearTerminalResult = useMineStore((s) => s.clearTerminalResult);
  const [floats, setFloats] = useState<FloatNote[]>([]);
  const [fanfare, setFanfare] = useState<string | null>(null);
  const [wreck, setWreck] = useState<{
    crushed: boolean;
    fallFatal: boolean;
    abandoned: boolean;
    value: number;
    parts: number;
    nearMiss: string | null;
  } | null>(null);
  const nextId = useRef(1);
  const wreckTimeout = useRef<number | null>(null);
  const wreckImpactUnsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (wreckTimeout.current != null) {
        window.clearTimeout(wreckTimeout.current);
        wreckTimeout.current = null;
      }
      wreckImpactUnsub.current?.();
      wreckImpactUnsub.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useEffect(() => {
    // Cancel any pending wreck report BEFORE the ok-gate: a trip reset
    // (restart, slot switch, world reload) arrives as a tick change with
    // a null result, and it must not leave a previous trip's report timer
    // or impact subscription alive to fire over the fresh trip.
    if (wreckTimeout.current != null) {
      window.clearTimeout(wreckTimeout.current);
      wreckTimeout.current = null;
    }
    wreckImpactUnsub.current?.();
    wreckImpactUnsub.current = null;
    if (!lastResult?.ok) return;
    if (lastResult.oreHarvested) {
      const ore = oreDef(lastResult.oreHarvested.ore);
      const count = lastResult.oreHarvested.units;
      const color =
        RESOURCE_FLOAT_COLORS[lastResult.oreHarvested.ore] ?? "#54e0c7";
      const id = nextId.current++;
      setFloats((prev) => [
        ...prev.slice(-4),
        {
          id,
          text: `${ore.name} x${count}`,
          color,
          glow: `0 0 18px ${color}`,
        },
      ]);
      setTimeout(
        () => setFloats((prev) => prev.filter((f) => f.id !== id)),
        1300,
      );
    }
    if (lastResult.found) {
      const name = PART_CATALOG[lastResult.found]?.name ?? lastResult.found;
      setFanfare(`Cache cracked: ${name}!`);
      setTimeout(() => setFanfare(null), 2800);
    }
    if (lastResult.collapsed && lastResult.lost) {
      const nextWreck = {
        crushed: lastResult.crushed ?? false,
        fallFatal: lastResult.fallFatal ?? false,
        abandoned: lastResult.abandoned ?? false,
        value: lastResult.lost.value,
        parts: lastResult.lost.parts.length,
        nearMiss: nearMissLine(
          mine,
          lastResult.lost,
          lastResult.crushed
            ? "crush"
            : lastResult.fallFatal
              ? "fall"
              : lastResult.abandoned
                ? "abandon"
                : "battery",
        ),
      };
      // An out-of-battery death powers the miner down in place before the
      // report (F-058), gated on the same impact signal as fall and crush;
      // a deliberate abandon still reports immediately.
      const isBatteryDeath =
        !lastResult.fallFatal &&
        !lastResult.crushed &&
        !(lastResult.abandoned ?? false);
      if (lastResult.fallFatal || lastResult.crushed || isBatteryDeath) {
        // The report must not beat the visible impact: the canvas frame
        // loop marks the impact frame in the store, and the report holds
        // for a beat after it. The ceiling timer covers a canvas that
        // never renders the impact (context lost, scene error); it scales
        // with the fall length because long falls take that long to land.
        const afterImpactMs = lastResult.fallFatal
          ? FALL_REPORT_AFTER_IMPACT_MS
          : lastResult.crushed
            ? CRUSH_REPORT_AFTER_IMPACT_MS
            : POWER_DOWN_REPORT_AFTER_IMPACT_MS;
        const ceilingMs = wreckReportCeilingMs(lastResult.fell);
        const scheduleWreck = (delayMs: number) => {
          if (wreckTimeout.current != null) {
            window.clearTimeout(wreckTimeout.current);
          }
          wreckTimeout.current = window.setTimeout(() => {
            setWreck(nextWreck);
            wreckTimeout.current = null;
            wreckImpactUnsub.current?.();
            wreckImpactUnsub.current = null;
          }, delayMs);
        };
        const impactKey = tick;
        if (useMineStore.getState().fallVisualImpactKey === impactKey) {
          scheduleWreck(afterImpactMs);
        } else {
          scheduleWreck(ceilingMs);
          wreckImpactUnsub.current = useMineStore.subscribe((state) => {
            if (state.fallVisualImpactKey !== impactKey) return;
            wreckImpactUnsub.current?.();
            wreckImpactUnsub.current = null;
            scheduleWreck(afterImpactMs);
          });
        }
      } else {
        setWreck(nextWreck);
      }
    }
  }, [tick]);

  return (
    <>
      {floats.map((f, i) => (
        <div
          key={f.id}
          className="mine-juice"
          style={{
            position: "absolute",
            left: "50%",
            top: `calc(50% - ${i * 18}px)`,
            transform: "translateX(-50%)",
            color: f.color,
            fontWeight: 700,
            fontSize: "1.05rem",
            letterSpacing: 0,
            textShadow: `0 1px 6px rgba(0,0,0,0.8), ${f.glow}`,
            pointerEvents: "none",
            animation: "mine-float-up 0.95s ease-out forwards",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            borderRadius: 999,
            background: "rgba(9, 12, 18, 0.72)",
            padding: "4px 10px",
            boxShadow: f.glow,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              marginRight: 6,
              borderRadius: 999,
              background: f.color,
              verticalAlign: "middle",
              boxShadow: f.glow,
            }}
          />
          {f.text}
        </div>
      ))}
      {fanfare && (
        <div
          className="mine-juice"
          style={{
            position: "absolute",
            top: 140,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(40, 32, 8, 0.95)",
            border: "2px solid #f5c542",
            color: "#f5c542",
            borderRadius: 12,
            padding: "14px 30px",
            fontSize: "1.25rem",
            fontWeight: 700,
            pointerEvents: "none",
            animation: "mine-fanfare-pop 2.8s ease-out forwards",
            boxShadow: "0 0 30px rgba(245, 197, 66, 0.35)",
          }}
        >
          {fanfare}
        </div>
      )}
      {wreck && (
        <button
          type="button"
          onClick={() => {
            setWreck(null);
            clearTerminalResult();
          }}
          aria-label="Dismiss trip report"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            background:
              "radial-gradient(ellipse at center, rgba(60, 10, 10, 0.35), rgba(10, 4, 4, 0.85))",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "rgba(24, 12, 14, 0.96)",
              border: "1px solid #ff6b6b",
              borderRadius: 12,
              padding: "20px 30px",
              maxWidth: 360,
              color: "#ffd9d9",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
              {wreck.fallFatal
                ? "Fell too far"
                : wreck.crushed
                  ? "Crushed by falling rock"
                  : wreck.abandoned
                    ? "Abandoned the dig"
                    : "Battery drained"}
            </p>
            <p style={{ margin: "10px 0 0", fontSize: "0.95rem" }}>
              {wreck.value > 0 || wreck.parts > 0
                ? `The bag stayed below: resources worth ${wreck.value} vibes${wreck.parts > 0 ? ` and ${wreck.parts} part${wreck.parts > 1 ? "s" : ""}` : ""}.`
                : "At least the hold was empty."}
            </p>
            {wreck.nearMiss && (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: "0.9rem",
                  color: "#f5c542",
                }}
              >
                So close: {wreck.nearMiss}
              </p>
            )}
            <p style={{ margin: "12px 0 0", fontSize: "0.8rem", opacity: 0.7 }}>
              tap anywhere for one more trip
            </p>
          </div>
        </button>
      )}
    </>
  );
}

export function MinePanel({
  appRelease,
  functionalRendererBypass = false,
}: {
  appRelease: AppRelease;
  functionalRendererBypass?: boolean;
}) {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const miner = mine.miner;
  const lastResult = useMineStore((s) => s.lastResult);
  const lastAction = useMineStore((s) => s.lastAction);
  const resumeElevatorDirection = useMineStore(
    (s) => s.resumeElevatorDirection,
  );
  const move = useMineStore((s) => s.move);
  const seed = useMineStore((s) => s.seed);
  const tripIndex = useMineStore((s) => s.tripIndex);
  const tripBaseDiff = useMineStore((s) => s.tripBaseDiff);
  const movesLength = useMineStore((s) => s.moves.length);
  // Whether this trip altered the world. `moves` is pushed in place, so
  // the selector reads it fresh on each store tick and returns a plain
  // boolean for zustand to compare.
  const carvedThisTrip = useMineStore((s) => tripChangedWorld(s.moves));
  const pendingBunker = useMineStore((s) => s.pendingBunker);
  const cashOut = useMineStore((s) => s.cashOut);
  const submitCashOut = useMineStore((s) => s.submitCashOut);
  const claimPendingBunker = useMineStore((s) => s.claimPendingBunker);
  const placePendingBunkerPart = useMineStore((s) => s.placePendingBunkerPart);
  const removePendingBunkerPart = useMineStore(
    (s) => s.removePendingBunkerPart,
  );
  const excavatePendingBunkerCell = useMineStore(
    (s) => s.excavatePendingBunkerCell,
  );
  const recordBankedBunkerDig = useMineStore((s) => s.recordBankedBunkerDig);
  const resetPendingBunker = useMineStore((s) => s.resetPendingBunker);
  const gear = useMineStore((s) => s.gear);
  const worldLoaded = useMineStore((s) => s.worldLoaded);
  const loadGear = useMineStore((s) => s.loadGear);
  const loadWorld = useMineStore((s) => s.loadWorld);
  const saveSlots = useMineStore((s) => s.saveSlots);
  const accountSync = useMineStore((s) => s.accountSync);
  const activeSlot = useMineStore((s) => s.activeSlot);
  const loadSaveSlots = useMineStore((s) => s.loadSaveSlots);
  const loadAccountStatus = useMineStore((s) => s.loadAccountStatus);
  const startAccountSignIn = useMineStore((s) => s.startAccountSignIn);
  const finishAccountSignIn = useMineStore((s) => s.finishAccountSignIn);
  const claimAccountSave = useMineStore((s) => s.claimAccountSave);
  const loadAccountSave = useMineStore((s) => s.loadAccountSave);
  const saveConflict = useMineStore((s) => s.saveConflict);
  const checkWorldFreshness = useMineStore((s) => s.checkWorldFreshness);
  const resolveSaveConflict = useMineStore((s) => s.resolveSaveConflict);
  const switchSaveSlot = useMineStore((s) => s.switchSaveSlot);
  const deleteSaveSlot = useMineStore((s) => s.deleteSaveSlot);
  const saveCurrentTrip = useMineStore((s) => s.saveCurrentTrip);
  const balance = useMineStore((s) => s.balance);
  const playerLevel = useMineStore((s) => s.playerLevel);
  const deepestDepth = useMineStore((s) => s.deepestDepth);
  const elevatorPlacementRequired = useMineStore(
    (s) => s.elevatorPlacementRequired,
  );
  const shopNote = useMineStore((s) => s.shopNote);
  const railResyncFailed = useMineStore((s) => s.railResyncFailed);
  const retryRailResync = useMineStore((s) => s.retryRailResync);
  const buyConsumable = useMineStore((s) => s.buyConsumable);
  const buyGearUpgrade = useMineStore((s) => s.buyGearUpgrade);
  const buyElevator = useMineStore((s) => s.buyElevator);
  const teleportToBase = useMineStore((s) => s.teleportToBase);
  const bunker = useBunkerStore((s) => s.bunker);
  const bunkerInventory = useBunkerStore((s) => s.inventory);
  const bunkerPlayer = useBunkerStore((s) => s.player);
  const loadBunker = useBunkerStore((s) => s.loadBunker);
  const buyBasePart = useBunkerStore((s) => s.buyBasePart);
  const placeBunkerPart = useBunkerStore((s) => s.placePart);
  const removeBunkerPart = useBunkerStore((s) => s.removePart);
  const excavateBunkerCellRemote = useBunkerStore((s) => s.excavateCell);
  const collectBunkerLootRemote = useBunkerStore((s) => s.collectLoot);
  const activeBunkerLiveRaid = useBunkerStore((s) => s.activeLiveRaid);
  const startBunkerLiveRaid = useBunkerStore((s) => s.startLiveRaid);
  const bunkerNextRaidAvailableAtMs = useBunkerStore(
    (s) => s.nextRaidAvailableAtMs,
  );
  const resolveBunkerLiveRaid = useBunkerStore((s) => s.resolveLiveRaid);
  const forfeitBunkerLiveRaid = useBunkerStore((s) => s.forfeitLiveRaid);
  const repairBunker = useBunkerStore((s) => s.repairBunker);
  const resetBankedBunker = useBunkerStore((s) => s.resetBunker);
  const startFreshBankedBunker = useBunkerStore((s) => s.startFreshBunker);
  const setBunkerSkin = useBunkerStore((s) => s.setSkin);
  const router = useRouter();
  const [dynamiteMenuOpen, setDynamiteMenuOpen] = useState(false);
  const [recoveryMenuOpen, setRecoveryMenuOpen] = useState(false);
  const [selectedDynamiteTier, setSelectedDynamiteTier] =
    useState<DynamiteTier>(1);
  const [abandonArmed, setAbandonArmed] = useState(false);
  const [collectMode, setCollectMode] = useState(false);
  const [collectSelection, setCollectSelection] = useState<string[]>([]);
  const [elevatorAutoDir, setElevatorAutoDir] =
    useState<ElevatorRideAction | null>(null);
  const [elevatorPresentation, setElevatorPresentation] =
    useState<ElevatorPresentation>(() => initialElevatorPresentation(0));
  const [elevatorPlacementMode, setElevatorPlacementMode] = useState(false);
  const [elevatorPurchasePending, setElevatorPurchasePending] = useState(false);
  const [railRetryPending, setRailRetryPending] = useState(false);
  const [elevatorPlacementError, setElevatorPlacementError] = useState<
    string | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // "Replay bunker tutorial" confirmation: shows an inline "next
  // entry" note after the flag clears, reset whenever the menu closes.
  const [tutorialReplayArmed, setTutorialReplayArmed] = useState(false);
  useEffect(() => {
    if (!settingsOpen) setTutorialReplayArmed(false);
  }, [settingsOpen]);
  const [stampBookOpen, setStampBookOpen] = useState(false);
  const [stampBookFocusId, setStampBookFocusId] = useState<string | null>(null);
  const openStampBookAt = useCallback((achievementId: string) => {
    setStampBookFocusId(achievementId);
    setStampBookOpen(true);
  }, []);
  const [saveSlotsOpen, setSaveSlotsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountFallbackPreflightDone, setAccountFallbackPreflightDone] =
    useState(false);
  const accountHandoffHandledRef = useRef<string | null>(null);
  const accountHandoffAttemptsRef = useRef<Record<string, number>>({});
  const accountFallbackPreflightPromiseRef = useRef<Promise<void> | null>(null);
  const [accountHandoffRetryTick, setAccountHandoffRetryTick] = useState(0);
  // Stable handlers so the memoized account popup skips per-tick re-renders.
  const closeAccountPopup = useCallback(() => setAccountOpen(false), []);
  const startAccountSignInFromMine = useCallback(
    () => startAccountSignIn("/mine"),
    [startAccountSignIn],
  );
  // Multi-device freshness: revalidate the cloud save whenever this device
  // comes back to the foreground (the store gates the probe to cloud-loaded
  // saves and throttles bursts).
  const probeSaveFreshness = useCallback(
    () => void checkWorldFreshness(),
    [checkWorldFreshness],
  );
  useForegroundReturn(probeSaveFreshness);
  // A peer tab in this browser just banked: resync immediately, skipping
  // the lifecycle throttle.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SAVE_SYNC_CHANNEL);
    channel.onmessage = () => void checkWorldFreshness({ force: true });
    return () => channel.close();
  }, [checkWorldFreshness]);
  // The conflict prompt and the Account dialog share the modal layer; close
  // Account so the two never stack competing focus traps.
  useEffect(() => {
    if (saveConflict === "prompt") setAccountOpen(false);
  }, [saveConflict]);
  // An interrupted sign-in handoff retries when the player returns.
  const retryHandoffOnReturn = useCallback(() => {
    if (!new URL(window.location.href).searchParams.has("accountHandoff")) {
      return;
    }
    setAccountHandoffRetryTick((tick) => tick + 1);
  }, []);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [feedbackContext, setFeedbackContext] = useState<FeedbackContext>({
    source: "pause",
  });
  const [releaseNotesOpenCount, setReleaseNotesOpenCount] = useState(0);
  const [releaseNotesVisible, setReleaseNotesVisible] = useState(false);
  const [mineSceneStatus, setMineSceneStatus] =
    useState<MineSceneStatus>("loading");
  const [mineSceneMessage, setMineSceneMessage] = useState<string | null>(null);
  const [mineCanvasKey, setMineCanvasKey] = useState(0);
  const [mineCanvasPainted, setMineCanvasPainted] = useState(false);
  const handleMineFirstFrame = useCallback(
    () => setMineCanvasPainted(true),
    [],
  );
  // A fresh scene load starts unpainted again (canvas remounts via
  // retryMineSceneLoad also pass through status "loading", so one reset
  // covers both). The probe's first-frame signal waits for a frame that
  // drew real content (not just its sentinel), so on a slow device it can
  // trail the compile-gate deadline; the 2x-deadline fallback stays as
  // the ceiling so a stalled signal can never trap the veil on screen.
  useEffect(() => {
    if (mineSceneStatus !== "ready") {
      setMineCanvasPainted(false);
      return;
    }
    if (functionalRendererBypass) {
      setMineCanvasPainted(true);
      return;
    }
    if (mineCanvasPainted) return;
    const fallback = window.setTimeout(
      () => setMineCanvasPainted(true),
      COMPILE_GATE_DEADLINE_MS * 2,
    );
    return () => window.clearTimeout(fallback);
  }, [functionalRendererBypass, mineSceneStatus, mineCanvasPainted]);
  const [cashNoteVisible, setCashNoteVisible] = useState(false);
  const [pickaxeGateHint, setPickaxeGateHint] = useState<{
    key: number;
    level: number;
  } | null>(null);
  const [cameraZoom, setCameraZoom] = useState(MINE_CAMERA_ZOOM_DEFAULT);
  const [bagPanelOpen, setBagPanelOpen] = useState(false);
  const [bagFullFlash, setBagFullFlash] = useState(false);
  const [selectedBagCells, setSelectedBagCells] = useState<Set<string>>(
    () => new Set(),
  );
  const [viewportSize, setViewportSize] = useState<ViewportSize>({
    width: 1024,
    height: 768,
  });
  const [mineViewportFrame, setMineViewportFrame] =
    useState<MineViewportFrame | null>(null);
  const [baseReturnOpen, setBaseReturnOpen] = useState(false);
  const [baseReturnConfirm, setBaseReturnConfirm] = useState(false);
  const [baseReturnPending, setBaseReturnPending] = useState(false);
  const [teleportBurstKey, setTeleportBurstKey] = useState(0);
  const [mineSurfaceTip, setMineSurfaceTip] = useState<string | null>(null);
  const mineSurfaceTipRef = useRef<string | null>(null);
  const [bunkerClaimMode, setBunkerClaimMode] = useState(false);
  const [bunkerPanelOpen, setBunkerPanelOpen] = useState(false);
  // First-person bunker viewer mode: the fp canvas replaces MineCanvas
  // and the 2D movement inputs are suppressed while it is on.
  const [fpBunkerActive, setFpBunkerActive] = useState(false);
  // Performance telemetry is attributed to whichever surface owns the
  // canvas right now (F-100): the fp canvas swaps in while active, so
  // both the compact sampler and the deep collector report bunker-fp
  // and read the bunker probe instead of mislabeling it as mine.
  const perfSurfaceSource = fpBunkerActive ? "bunker-fp" : "mine";
  useMinePerformanceSampling(appRelease, perfSurfaceSource);
  // Tool state lives here (not in the fp canvas) so exits and forced
  // exits can always reset it; only the fp hotbar writes it now.
  const [bunkerToolSelection, setBunkerToolSelection] =
    useState<BunkerToolSelection>(null);
  // Brief first-person deny chip (F-099): prying a damaged part
  // refuses with repair-first copy; the timer clears it.
  const [fpDenyNotice, setFpDenyNotice] = useState<string | null>(null);
  const fpDenyNoticeTimerRef = useRef<number>(0);
  // The column whose stall sheet is open. Standing on a stall no longer
  // auto-opens it: a prompt button appears and tapping it sets this.
  // Stepping off clears it, so walking by never pops the menu.
  const [openStallCol, setOpenStallCol] = useState<number | null>(null);
  // Touch players never see keyboard copy (matches the renderer's
  // coarse-pointer heuristic). False during SSR; set before paint.
  const [coarsePointer, setCoarsePointer] = useState(false);
  // TV browsers (Fire TV Silk) drive a virtual cursor with the remote,
  // so movement gets the click-first TV deck instead of drag gestures.
  // False during SSR; set before paint.
  const [tvMode, setTvMode] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsMenuRef = useRef<HTMLElement | null>(null);
  const baseReturnButtonRef = useRef<HTMLButtonElement | null>(null);
  const baseReturnMenuRef = useRef<HTMLElement | null>(null);
  const stallSheetRef = useRef<HTMLElement | null>(null);
  const elevatorPlacementRef = useRef<HTMLElement | null>(null);
  const placeElevatorAtCurrentColumnRef = useRef<() => void>(() => {});
  const previousElevatorPlacementModeRef = useRef(false);
  const dynamiteMenuRef = useRef<HTMLDivElement | null>(null);
  const recoveryMenuRef = useRef<HTMLDivElement | null>(null);
  const lastCashOutStateRef = useRef(cashOut.state);
  const lastShopNoteRef = useRef<string | null>(null);
  const lastGamepadZoomRef = useRef(0);
  const lastGamepadBagCloseRef = useRef(false);
  const gamepadMoveDirRef = useRef<Direction | null>(null);
  const gamepadSelectRef = useRef(false);
  const directionActionRef = useRef<
    (dir: Direction, isAutoRepeat: boolean) => boolean
  >(() => false);
  const directionCadenceRef =
    useRef<DirectionCadenceController<Direction> | null>(null);
  const elevatorPresentationRef = useRef(elevatorPresentation);
  elevatorPresentationRef.current = elevatorPresentation;
  const elevatorSequenceRef = useRef(0);
  const pendingElevatorEntryRef = useRef<{
    sequence: number;
    direction: Direction;
  } | null>(null);
  const elevatorDestinationRef = useRef<
    (direction: ElevatorRideAction) => void
  >(() => {});
  const lastAutoCashOutKeyRef = useRef<string | null>(null);
  const previousMinerRowRef = useRef(mine.miner.row);
  const inputDiagnosticKeysRef = useRef<Set<string>>(new Set());
  void tick;
  const activeBunker = pendingBunker?.bunker ?? bunker;
  const activeBunkerInventory = pendingBunker?.inventory ?? bunkerInventory;
  const pendingBunkerActive = pendingBunker !== null;
  const terminalMineState = Boolean(lastResult?.ok && lastResult.collapsed);
  // A banked bunker built under an older layout model cannot be entered or
  // edited (F-117): it fails fast in the 2D status sheet and offers Start
  // fresh instead. A pending (unbanked) claim is born current, so it is
  // never gated here (and its version is stamped server-side at bank).
  const bunkerLayoutIncompatible =
    !pendingBunkerActive &&
    activeBunker !== null &&
    isBunkerLayoutIncompatible(activeBunker);
  // The one first-person gate (used by the Enter affordance path and the
  // forced-exit effect only). The interim 2D raid used to freeze bunker
  // editing/entry; it is retired, and a live raid is fought in first person
  // with its own forfeit/exit lifecycle, so nothing raid-related gates this now.
  const fpBunkerAllowed =
    Boolean(activeBunker) && !terminalMineState && !bunkerLayoutIncompatible;
  // THE build entry point: the floating Enter bunker pill shows while
  // the miner stands inside an editable claim, and it REPLACES the
  // collapsed Bunker status trigger in that state (one bunker button at
  // a time, F-119 fold; the sheet is reached through the fp view's
  // Bunker button instead). Shares the fpBunkerAllowed gate with the
  // forced-exit effect so the two never drift.
  const fpEnterTriggerVisible =
    fpBunkerAllowed &&
    activeBunker !== null &&
    containsBunkerCell(activeBunker.footprint, miner.col, miner.row);
  const selectedBasePart: BasePartId =
    bunkerToolSelection &&
    bunkerToolSelection !== "pry" &&
    bunkerToolSelection !== "dig"
      ? bunkerToolSelection
      : "wall-panel";
  const bunkerToolAction: BunkerToolAction =
    bunkerToolSelection === "pry"
      ? "pry"
      : bunkerToolSelection === "dig"
        ? "dig"
        : bunkerToolSelection === null
          ? "none"
          : "build";

  useEffect(() => {
    if (mine.miner.row !== 0) return;
    const rotateMineSurfaceTip = () => {
      const next = randomMineSurfaceTip(mineSurfaceTipRef.current);
      mineSurfaceTipRef.current = next;
      setMineSurfaceTip(next);
    };
    rotateMineSurfaceTip();
    const rotationMs =
      (window as Window & MineSurfaceTipTestWindow)
        .__vibebotsSurfaceTipRotationMs ?? MINE_SURFACE_TIP_ROTATION_MS;
    const timer = window.setInterval(() => {
      rotateMineSurfaceTip();
    }, rotationMs);
    return () => window.clearInterval(timer);
  }, [mine.miner.row]);

  const persistCameraZoom = useCallback((zoom: number) => {
    try {
      localStorage.setItem(MINE_CAMERA_STORAGE_KEY, String(zoom));
    } catch {
      // Private browsing or blocked storage: keep the preference in memory.
    }
  }, []);

  const adjustCameraZoom = useCallback(
    (delta: number) => {
      setCameraZoom((prev) => {
        const next = clampMineCameraZoom(prev + delta, gear);
        persistCameraZoom(next);
        return next;
      });
    },
    [gear, persistCameraZoom],
  );

  const runAccountFallbackPreflight = useCallback(async () => {
    if (!accountFallbackPreflightRequired()) {
      setAccountFallbackPreflightDone(true);
      return;
    }

    if (!accountFallbackPreflightPromiseRef.current) {
      setSettingsOpen(false);
      accountFallbackPreflightPromiseRef.current = loadAccountStatus()
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          setAccountFallbackPreflightDone(true);
        });
    }

    await accountFallbackPreflightPromiseRef.current;
  }, [loadAccountStatus]);

  const loadMineScene = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const finishIfActive = (status: MineSceneStatus, message?: string) => {
        if (isCancelled()) return;
        setMineSceneStatus(status);
        setMineSceneMessage(message ?? null);
      };

      setMineSceneStatus("loading");
      setMineSceneMessage(null);

      try {
        // Check the account fallback before the world route can create a guest.
        await runAccountFallbackPreflight();
        if (isCancelled()) return;
        await loadWorld();
        await loadGear();
        await loadBunker();
      } catch {
        finishIfActive("error", MINE_SCENE_LOAD_ERROR);
        return;
      }

      if (useMineStore.getState().worldLoaded) {
        finishIfActive("ready");
      } else {
        finishIfActive("error", MINE_SCENE_LOAD_ERROR);
      }
    },
    [runAccountFallbackPreflight, loadWorld, loadGear, loadBunker],
  );

  useEffect(() => {
    let cancelled = false;
    void loadMineScene(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [loadMineScene]);

  useEffect(() => {
    void accountHandoffRetryTick;
    const url = new URL(window.location.href);
    const handoffId = url.searchParams.get("accountHandoff");
    if (!handoffId || accountHandoffHandledRef.current === handoffId) return;
    const attempts = (accountHandoffAttemptsRef.current[handoffId] ?? 0) + 1;
    accountHandoffAttemptsRef.current[handoffId] = attempts;
    accountHandoffHandledRef.current = handoffId;
    setAccountOpen(true);
    void finishAccountSignIn(handoffId).then((handled) => {
      const state = useMineStore.getState().accountSync;
      const resolved =
        handled ||
        state.mode === "conflict" ||
        state.mode === "cloud_loaded" ||
        // sign_in_required (a 401) is deliberately NOT terminal: right
        // after the OAuth redirect the Clerk session cookie can settle a
        // beat late, and the bounded retry below recovers the handoff
        // instead of stranding the player signed out (F-069).
        (state.state === "error" &&
          (state.code === "handoff_expired" ||
            state.code === "device_save_linked_to_other_account" ||
            state.code === "device_save_slot_full")) ||
        attempts >= 3;
      accountHandoffHandledRef.current = null;
      if (resolved) {
        delete accountHandoffAttemptsRef.current[handoffId];
        stripQueryParam("accountHandoff");
        return;
      }
      window.setTimeout(() => {
        setAccountHandoffRetryTick((tick) => tick + 1);
      }, 750);
    });
  }, [finishAccountSignIn, accountHandoffRetryTick]);

  useForegroundReturn(retryHandoffOnReturn);

  useEffect(() => {
    if (
      accountSync.mode !== "conflict" &&
      accountSync.mode !== "cloud_loaded" &&
      accountSync.mode !== "signed_in"
    ) {
      return;
    }
    stripQueryParam("accountHandoff");
  }, [accountSync.mode]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("account") !== "1") return;
    if (!accountFallbackPreflightDone) return;
    setSettingsOpen(false);
    setAccountOpen(true);
    const cleanupHandle = window.setTimeout(() => {
      const next = new URL(window.location.href);
      if (next.searchParams.get("account") !== "1") return;
      stripQueryParam("account");
    }, 0);
    return () => window.clearTimeout(cleanupHandle);
  }, [accountFallbackPreflightDone]);

  useEffect(() => {
    setCoarsePointer(window.matchMedia?.("(pointer: coarse)").matches ?? false);
    setTvMode(detectTvMode());
  }, []);

  useEffect(() => {
    const nonPassive = { passive: false } as AddEventListenerOptions;
    const preventGestureZoom = (event: Event) => {
      event.preventDefault();
    };
    const preventDocumentPinch = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      event.preventDefault();
    };
    window.addEventListener("gesturestart", preventGestureZoom, nonPassive);
    window.addEventListener("gesturechange", preventGestureZoom, nonPassive);
    window.addEventListener("gestureend", preventGestureZoom, nonPassive);
    document.addEventListener("touchmove", preventDocumentPinch, nonPassive);
    return () => {
      window.removeEventListener("gesturestart", preventGestureZoom);
      window.removeEventListener("gesturechange", preventGestureZoom);
      window.removeEventListener("gestureend", preventGestureZoom);
      document.removeEventListener("touchmove", preventDocumentPinch);
    };
  }, []);

  useEffect(() => {
    const updateViewport = () =>
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useLayoutEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    const documentStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const previousDocumentHeight = documentStyle.height;
    const previousDocumentOverflow = documentStyle.overflow;
    const previousDocumentOverscroll = documentStyle.overscrollBehavior;
    const previousBodyHeight = bodyStyle.height;
    const previousBodyInset = bodyStyle.inset;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousBodyOverscroll = bodyStyle.overscrollBehavior;
    const previousBodyPosition = bodyStyle.position;
    const previousBodyWidth = bodyStyle.width;
    let refreshEntry = "none";
    try {
      refreshEntry = sessionStorage.getItem(MINE_REFRESH_ENTRY_KEY) ?? "none";
      sessionStorage.removeItem(MINE_REFRESH_ENTRY_KEY);
    } catch {
      // Storage can be unavailable in hardened browser modes.
    }
    let frame: number | null = null;
    const timeouts: number[] = [];
    const lockMineViewport = () => {
      window.scrollTo(0, 0);
      documentStyle.height = "100%";
      documentStyle.overflow = "hidden";
      documentStyle.overscrollBehavior = "none";
      bodyStyle.height = "100%";
      bodyStyle.inset = "0";
      bodyStyle.overflow = "hidden";
      bodyStyle.overscrollBehavior = "none";
      bodyStyle.position = "fixed";
      bodyStyle.width = "100%";
      setMineViewportFrame(readMineViewportFrame(refreshEntry));
    };
    const scheduleMineViewportLock = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        lockMineViewport();
      });
    };

    window.history.scrollRestoration = "manual";
    lockMineViewport();
    for (const delayMs of [40, 120, 300]) {
      timeouts.push(window.setTimeout(lockMineViewport, delayMs));
    }
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", scheduleMineViewportLock);
    visualViewport?.addEventListener("scroll", scheduleMineViewportLock);
    visualViewport?.addEventListener("scrollend", scheduleMineViewportLock);
    window.addEventListener("resize", scheduleMineViewportLock);
    window.addEventListener("focus", scheduleMineViewportLock);
    window.addEventListener("pageshow", scheduleMineViewportLock);
    document.addEventListener("visibilitychange", scheduleMineViewportLock);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      for (const timeout of timeouts) window.clearTimeout(timeout);
      visualViewport?.removeEventListener("resize", scheduleMineViewportLock);
      visualViewport?.removeEventListener("scroll", scheduleMineViewportLock);
      visualViewport?.removeEventListener(
        "scrollend",
        scheduleMineViewportLock,
      );
      window.removeEventListener("resize", scheduleMineViewportLock);
      window.removeEventListener("focus", scheduleMineViewportLock);
      window.removeEventListener("pageshow", scheduleMineViewportLock);
      document.removeEventListener(
        "visibilitychange",
        scheduleMineViewportLock,
      );
      window.history.scrollRestoration = previousScrollRestoration;
      documentStyle.height = previousDocumentHeight;
      documentStyle.overflow = previousDocumentOverflow;
      documentStyle.overscrollBehavior = previousDocumentOverscroll;
      bodyStyle.height = previousBodyHeight;
      bodyStyle.inset = previousBodyInset;
      bodyStyle.overflow = previousBodyOverflow;
      bodyStyle.overscrollBehavior = previousBodyOverscroll;
      bodyStyle.position = previousBodyPosition;
      bodyStyle.width = previousBodyWidth;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MINE_CAMERA_STORAGE_KEY);
      if (!raw) return;
      setCameraZoom(clampMineCameraZoom(Number(raw), gear));
    } catch {
      // Storage unavailable: default zoom remains active.
    }
  }, [gear]);

  useEffect(() => {
    setCameraZoom((prev) => {
      const next = clampMineCameraZoom(prev, gear);
      if (next !== prev) persistCameraZoom(next);
      return next;
    });
  }, [gear, persistCameraZoom]);

  useEffect(() => {
    let frame = 0;
    const pollGamepadZoom = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const now = Date.now();
      for (const pad of pads) {
        if (!pad) continue;
        const modifier =
          pad.buttons[6]?.pressed ||
          pad.buttons[7]?.pressed ||
          pad.buttons[4]?.pressed ||
          pad.buttons[5]?.pressed;
        if (!modifier) continue;
        const zoomIn = pad.buttons[12]?.pressed;
        const zoomOut = pad.buttons[13]?.pressed;
        if (!zoomIn && !zoomOut) continue;
        if (now - lastGamepadZoomRef.current < 160) break;
        lastGamepadZoomRef.current = now;
        adjustCameraZoom(zoomOut ? 0.1 : -0.1);
        break;
      }
      frame = requestAnimationFrame(pollGamepadZoom);
    };
    frame = requestAnimationFrame(pollGamepadZoom);
    return () => cancelAnimationFrame(frame);
  }, [adjustCameraZoom]);

  useTvBackDismiss(bagPanelOpen, () => setBagPanelOpen(false));

  useEffect(() => {
    if (!bagPanelOpen) {
      lastGamepadBagCloseRef.current = false;
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setBagPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    let frame = 0;
    const pollGamepadClose = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const closePressed = pads.some(
        (pad) =>
          Boolean(pad?.buttons[1]?.pressed) ||
          Boolean(pad?.buttons[8]?.pressed),
      );
      if (closePressed && !lastGamepadBagCloseRef.current) {
        setBagPanelOpen(false);
      }
      lastGamepadBagCloseRef.current = closePressed;
      frame = requestAnimationFrame(pollGamepadClose);
    };
    frame = requestAnimationFrame(pollGamepadClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
    };
  }, [bagPanelOpen]);

  useEffect(() => {
    if (lastCashOutStateRef.current === cashOut.state) return;
    lastCashOutStateRef.current = cashOut.state;
    if (cashOut.state === "done") playMineSfxEvent("sell");
    else if (cashOut.state === "error" || cashOut.state === "unavailable") {
      playMineSfxEvent("deny");
    }
  }, [cashOut.state]);

  useEffect(() => {
    if (cashOut.state !== "done" || !cashOut.bunkerClaimed) return;
    void loadBunker();
  }, [cashOut, loadBunker]);

  useEffect(() => {
    if (cashOut.state === "idle" || cashOut.state === "pending") {
      setCashNoteVisible(false);
      return;
    }
    setCashNoteVisible(true);
    const timer = setTimeout(() => setCashNoteVisible(false), 3600);
    return () => clearTimeout(timer);
  }, [cashOut]);

  useEffect(() => {
    if (!shopNote || shopNote === lastShopNoteRef.current) return;
    lastShopNoteRef.current = shopNote;
    const event = mineShopNoteSfxEvent(shopNote);
    if (!event) return;
    playMineSfxEvent(event);
    triggerShopHaptic(event === "deny" ? "deny" : "commit");
  }, [shopNote]);

  useEffect(() => {
    if (
      lastResult?.ok &&
      (lastAction === "warp-home" ||
        lastAction?.startsWith("warp-down") ||
        lastAction?.startsWith("portal-warp"))
    ) {
      setTeleportBurstKey((key) => key + 1);
    }
  }, [lastAction, lastResult]);

  useEffect(() => {
    if (
      !lastResult ||
      lastResult.ok ||
      lastResult.reason !== "rock" ||
      !lastResult.requiredPickaxeLevel
    ) {
      setPickaxeGateHint((hint) => (hint ? null : hint));
      return;
    }
    const key = tick;
    setPickaxeGateHint({
      key,
      level: lastResult.requiredPickaxeLevel,
    });
    const timer = window.setTimeout(() => {
      setPickaxeGateHint((hint) => (hint?.key === key ? null : hint));
    }, PICKAXE_GATE_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [lastResult, tick]);

  const mineSceneReady = worldLoaded && mineSceneStatus === "ready";
  const elevatorStage = elevatorPresentation.stage;
  const elevatorBusy =
    elevatorAutoDir !== null ||
    elevatorStage === "calling" ||
    elevatorStage === "boarding" ||
    elevatorStage === "riding";
  const elevatorInteractionActive = elevatorStage !== "idle";
  // The veil and the loading notice cover the canvas together until the
  // first frame has actually painted (data-ready alone leaves the canvas
  // as an unpainted black buffer through the compile warm-up).
  const showFirstPaintVeil = mineSceneReady && !mineCanvasPainted;

  const directionCadence = useCallback(() => {
    if (!directionCadenceRef.current) {
      directionCadenceRef.current = createDirectionCadenceController({
        clock: {
          now: () => Date.now(),
          setTimeout: (callback, delayMs) =>
            window.setTimeout(callback, delayMs),
          clearTimeout: (timer) => window.clearTimeout(timer),
        },
        onAction: (dir: Direction, isAutoRepeat: boolean) =>
          directionActionRef.current(dir, isAutoRepeat),
        isOpposite: (a: Direction, b: Direction) => OPPOSITE_DIRECTION[a] === b,
      });
    }
    return directionCadenceRef.current;
  }, []);

  const cancelMovementControls = useCallback(() => {
    directionCadenceRef.current?.cancel();
  }, []);

  const performDirectionAction = useCallback(
    (dir: Direction, isAutoRepeat: boolean): boolean => {
      if (!mineSceneReady) return false;
      if (elevatorBusy || elevatorPurchasePending) return false;
      const state = useMineStore.getState();
      if (state.lastResult?.ok && state.lastResult.collapsed) return false;
      if (elevatorPresentationRef.current.stage === "choosing") {
        if (dir === "up" || dir === "down") {
          const ride = dir === "up" ? "ride-up" : "ride-down";
          elevatorDestinationRef.current(ride);
          return false;
        }
        state.move(dir);
        const nextState = useMineStore.getState();
        if (nextState.mine.elevatorPhase === "idle") {
          pendingElevatorEntryRef.current = null;
          setElevatorPresentation((current) => ({
            ...current,
            stage: "idle",
            carRow: nextState.mine.miner.row,
            entryDirection: null,
          }));
        }
        return false;
      }
      const boarding = elevatorBoardingTarget(state.mine, dir);
      if (boarding) {
        const sequence = elevatorSequenceRef.current + 1;
        elevatorSequenceRef.current = sequence;
        pendingElevatorEntryRef.current = { sequence, direction: dir };
        setOpenStallCol(null);
        setDynamiteMenuOpen(false);
        setRecoveryMenuOpen(false);
        setElevatorPresentation((current) => ({
          ...current,
          sequence,
          stage: "calling",
          carRow: boarding.row,
          entryDirection: dir,
        }));
        return false;
      }
      // A held "up" may keep mining the ceiling, but never plants a
      // ladder: consuming a ladder and committing to an ascent (including
      // right after a jump-dig drops the miner back down) always takes a
      // deliberate release-and-press. Returning false ends the held chain.
      if (dir === "up" && isAutoRepeat && climbWouldPlaceLadder(state.mine)) {
        return false;
      }
      state.move(dir);
      return true;
    },
    [elevatorBusy, elevatorPurchasePending, mineSceneReady],
  );

  const handleElevatorStageComplete = useCallback(
    (sequence: number, stage: ElevatorPresentationStage) => {
      const current = elevatorPresentationRef.current;
      if (current.sequence !== sequence || current.stage !== stage) return;
      if (stage === "calling") {
        const pending = pendingElevatorEntryRef.current;
        if (!pending || pending.sequence !== sequence) return;
        const state = useMineStore.getState();
        if (!elevatorBoardingTarget(state.mine, pending.direction)) {
          pendingElevatorEntryRef.current = null;
          setElevatorPresentation((value) => ({
            ...value,
            stage: "idle",
            entryDirection: null,
          }));
          return;
        }
        const result = state.move(pending.direction);
        const next = useMineStore.getState();
        if (
          result?.ok &&
          result.elevatorEntered &&
          !result.collapsed &&
          next.mine.elevatorPhase === "boarded"
        ) {
          setElevatorPresentation((value) => ({
            ...value,
            stage: "boarding",
          }));
          return;
        }
        pendingElevatorEntryRef.current = null;
        setElevatorPresentation((value) => ({
          ...value,
          stage: "idle",
          entryDirection: null,
        }));
        return;
      }
      if (stage === "riding") {
        const state = useMineStore.getState();
        if (state.mine.elevatorPhase !== "boarded") return;
        setElevatorAutoDir(null);
        setElevatorPresentation((value) => ({
          ...value,
          stage: "choosing",
          carRow: state.mine.miner.row,
          entryDirection: null,
        }));
        return;
      }
      if (stage !== "boarding") return;
      const state = useMineStore.getState();
      pendingElevatorEntryRef.current = null;
      setElevatorPresentation((value) => ({
        ...value,
        stage: state.mine.elevatorPhase === "boarded" ? "choosing" : "idle",
        carRow: state.mine.miner.row,
        entryDirection: null,
      }));
    },
    [],
  );

  directionActionRef.current = performDirectionAction;

  const fireDirection = useCallback(
    (dir: Direction) => {
      const repeatMs = actionRepeatMs(useMineStore.getState().mine.gear);
      directionCadence().press(dir, repeatMs);
    },
    [directionCadence],
  );

  const fireJump = useCallback(() => {
    if (!mineSceneReady) return;
    if (elevatorInteractionActive || elevatorPurchasePending) return;
    if (terminalMineState || creditsOpen) return;
    const state = useMineStore.getState();
    if (!canJump(state.mine)) return;
    state.move("jump");
  }, [
    creditsOpen,
    elevatorInteractionActive,
    elevatorPurchasePending,
    mineSceneReady,
    terminalMineState,
  ]);

  // Shift + Down (F-059): drop through the plank underfoot. Only fires when
  // a plank is actually there, so it never mines the way a plain Down does.
  const firePlankDrop = useCallback(() => {
    if (!mineSceneReady) return;
    if (elevatorInteractionActive || elevatorPurchasePending) return;
    if (terminalMineState || creditsOpen) return;
    const state = useMineStore.getState();
    if (!canDropThroughPlank(state.mine)) return;
    state.move("down");
  }, [
    creditsOpen,
    elevatorInteractionActive,
    elevatorPurchasePending,
    mineSceneReady,
    terminalMineState,
  ]);

  const releaseDirection = useCallback((dir: Direction | null) => {
    directionCadenceRef.current?.release(dir);
  }, []);

  // Gamepad D-pad movement (a paired controller, or a TV remote surfaced
  // as a gamepad): buttons 12-15 hold the shared direction cadence like a
  // held arrow key, and A/Select (button 0) jumps, or enters the building
  // on the current surface column. Zoom keeps its trigger/shoulder chord
  // (pollGamepadZoom above), so a held modifier pauses plain-D-pad moves
  // instead of fighting the zoom gesture.
  useEffect(() => {
    if (
      !mineSceneReady ||
      elevatorBusy ||
      elevatorPurchasePending ||
      terminalMineState ||
      creditsOpen ||
      fpBunkerActive
    ) {
      return;
    }
    let frame = 0;
    const pollGamepadMove = () => {
      const pads = navigator.getGamepads?.() ?? [];
      let dir: Direction | null = null;
      let select = false;
      for (const pad of pads) {
        if (!pad) continue;
        const modifier =
          pad.buttons[6]?.pressed ||
          pad.buttons[7]?.pressed ||
          pad.buttons[4]?.pressed ||
          pad.buttons[5]?.pressed;
        if (!modifier && dir === null) {
          if (pad.buttons[12]?.pressed) dir = "up";
          else if (pad.buttons[13]?.pressed) dir = "down";
          else if (pad.buttons[14]?.pressed) dir = "left";
          else if (pad.buttons[15]?.pressed) dir = "right";
        }
        if (pad.buttons[0]?.pressed) select = true;
      }
      if (dir !== gamepadMoveDirRef.current) {
        const prev = gamepadMoveDirRef.current;
        gamepadMoveDirRef.current = dir;
        if (dir) fireDirection(dir);
        else releaseDirection(prev);
      }
      if (select && !gamepadSelectRef.current) {
        if (elevatorPlacementMode) {
          placeElevatorAtCurrentColumnRef.current();
          gamepadSelectRef.current = select;
          frame = requestAnimationFrame(pollGamepadMove);
          return;
        }
        const state = useMineStore.getState();
        const surfaceMiner = state.mine.miner;
        const dest =
          surfaceMiner.row === 0 ? destinationAt(surfaceMiner.col) : null;
        if (dest) router.push(dest.href);
        else fireJump();
      }
      gamepadSelectRef.current = select;
      frame = requestAnimationFrame(pollGamepadMove);
    };
    frame = requestAnimationFrame(pollGamepadMove);
    return () => {
      cancelAnimationFrame(frame);
      if (gamepadMoveDirRef.current !== null) {
        releaseDirection(gamepadMoveDirRef.current);
        gamepadMoveDirRef.current = null;
      }
      gamepadSelectRef.current = false;
    };
  }, [
    creditsOpen,
    elevatorBusy,
    elevatorPlacementMode,
    elevatorPurchasePending,
    fireDirection,
    fireJump,
    fpBunkerActive,
    mineSceneReady,
    releaseDirection,
    router,
    terminalMineState,
  ]);

  useEffect(() => {
    if (
      mineSceneReady &&
      !elevatorBusy &&
      !elevatorPurchasePending &&
      !creditsOpen &&
      !terminalMineState &&
      !fpBunkerActive
    )
      return;
    cancelMovementControls();
  }, [
    cancelMovementControls,
    creditsOpen,
    elevatorBusy,
    elevatorPurchasePending,
    fpBunkerActive,
    mineSceneReady,
    terminalMineState,
  ]);

  useEffect(() => {
    return () => cancelMovementControls();
  }, [cancelMovementControls]);

  // Moving off the column closes any open sheet, so the menu never
  // follows the miner and a return shows the prompt, not the open sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: column is the reset trigger, not read in the body; dropping it would fire once and never re-close
  useEffect(() => {
    setOpenStallCol(null);
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
  }, [mine.miner.col]);

  useEffect(() => {
    if (!elevatorPlacementMode) return;
    if (
      (gear.elevator <= 0 || elevatorPlacementRequired) &&
      miner.row === 0 &&
      !terminalMineState
    ) {
      return;
    }
    setElevatorPlacementMode(false);
    setElevatorPurchasePending(false);
    setElevatorPlacementError(null);
  }, [
    elevatorPlacementMode,
    elevatorPlacementRequired,
    gear.elevator,
    miner.row,
    terminalMineState,
  ]);

  useEffect(() => {
    if (!elevatorPlacementMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (bunkerToolKeyIgnored(event)) return;
      if (elevatorPurchasePending) return;
      event.preventDefault();
      setElevatorPlacementMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [elevatorPlacementMode, elevatorPurchasePending]);

  useEffect(() => {
    if (elevatorPlacementMode) {
      previousElevatorPlacementModeRef.current = true;
      const frame = requestAnimationFrame(() =>
        elevatorPlacementRef.current?.focus(),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (!previousElevatorPlacementModeRef.current) return;
    previousElevatorPlacementModeRef.current = false;
    const frame = requestAnimationFrame(() =>
      settingsButtonRef.current?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [elevatorPlacementMode]);

  const dismissFloatingMenus = useCallback(() => {
    setSettingsOpen(false);
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
    setOpenStallCol(null);
    setDynamiteMenuOpen(false);
    setRecoveryMenuOpen(false);
    setAbandonArmed(false);
  }, []);

  const chooseElevatorShaft = useCallback(() => {
    setOpenStallCol(null);
    setCollectMode(false);
    setBunkerClaimMode(false);
    setBunkerPanelOpen(false);
    setElevatorPlacementError(null);
    setElevatorPlacementMode(true);
  }, []);

  const placeElevatorAtCurrentColumn = useCallback(async () => {
    if (elevatorPurchasePending || miner.row !== 0) return;
    setElevatorPlacementError(null);
    setElevatorPurchasePending(true);
    try {
      const placed = await buyElevator(miner.col);
      if (placed) setElevatorPlacementMode(false);
      else {
        setElevatorPlacementError(
          useMineStore.getState().shopNote ??
            "The elevator could not be placed.",
        );
      }
    } finally {
      setElevatorPurchasePending(false);
    }
  }, [buyElevator, elevatorPurchasePending, miner.col, miner.row]);
  placeElevatorAtCurrentColumnRef.current = () => {
    void placeElevatorAtCurrentColumn();
  };

  const purchaseNextElevatorRail = useCallback(async () => {
    if (elevatorPurchasePending) return;
    setElevatorPurchasePending(true);
    try {
      await buyElevator();
    } finally {
      setElevatorPurchasePending(false);
    }
  }, [buyElevator, elevatorPurchasePending]);

  const purchaseHardwarePart = useCallback(
    async (partId: BasePartId, quantity: number) => {
      const result = await buyBasePart(partId, quantity);
      if (result) {
        useMineStore.setState({ balance: result.player.balance });
      }
    },
    [buyBasePart],
  );

  // Recover from a rail resync that failed offline mid-conflict. The buy and
  // retry controls never show at once (the buy is blocked while the recovery
  // box is up), so a dedicated pending flag keeps each label honest.
  const retryRailResyncNow = useCallback(async () => {
    if (railRetryPending) return;
    setRailRetryPending(true);
    try {
      await retryRailResync();
    } finally {
      setRailRetryPending(false);
    }
  }, [retryRailResync, railRetryPending]);

  const isInsideOpenFloatingMenu = useCallback(
    (target: EventTarget | null, path: readonly EventTarget[]) => {
      if (
        settingsOpen &&
        (eventInsideRef(settingsButtonRef, target, path) ||
          eventInsideRef(settingsMenuRef, target, path))
      ) {
        return true;
      }
      if (
        baseReturnOpen &&
        (eventInsideRef(baseReturnButtonRef, target, path) ||
          eventInsideRef(baseReturnMenuRef, target, path))
      ) {
        return true;
      }
      if (
        openStallCol !== null &&
        eventInsideRef(stallSheetRef, target, path)
      ) {
        return true;
      }
      if (dynamiteMenuOpen && eventInsideRef(dynamiteMenuRef, target, path)) {
        return true;
      }
      if (recoveryMenuOpen && eventInsideRef(recoveryMenuRef, target, path)) {
        return true;
      }
      return false;
    },
    [
      baseReturnOpen,
      dynamiteMenuOpen,
      openStallCol,
      recoveryMenuOpen,
      settingsOpen,
    ],
  );

  useOutsidePointerDismiss(
    settingsOpen ||
      baseReturnOpen ||
      openStallCol !== null ||
      dynamiteMenuOpen ||
      recoveryMenuOpen,
    isInsideOpenFloatingMenu,
    dismissFloatingMenus,
  );

  // On a TV the remote's Back button (a history back) closes whatever
  // floating menu or sheet is open instead of leaving the game.
  useTvBackDismiss(
    settingsOpen ||
      baseReturnOpen ||
      openStallCol !== null ||
      dynamiteMenuOpen ||
      recoveryMenuOpen,
    dismissFloatingMenus,
  );

  // The abandon confirm disarms itself; a stray thumb cannot torch a
  // haul twenty minutes deep.
  useEffect(() => {
    if (!abandonArmed) return;
    // Generous on purpose: the guard exists to stop double-tap
    // accidents (sub-second), and slow devices can take seconds
    // between deliberate taps.
    const timer = setTimeout(() => setAbandonArmed(false), 8000);
    return () => clearTimeout(timer);
  }, [abandonArmed]);

  useEffect(() => {
    // First-person mode owns the keyboard (bunker-fp-input); the 2D
    // movement listeners detach entirely so a held key cannot leak a
    // mine move while the player walks the bunker.
    if (fpBunkerActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const targetEl = event.target as HTMLElement | null;
      if (
        targetEl &&
        (targetEl.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(targetEl.tagName))
      ) {
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        if (targetEl?.closest("button,a,[role='button']")) return;
        event.preventDefault();
        if (!creditsOpen) fireJump();
        return;
      }
      // Select stays Silk's click and Back stays browser history. The channel
      // rocker plus transport row provide four physical mine directions.
      // The onscreen TV deck remains available when Silk withholds a key.
      const remoteDir = tvMode
        ? tvRemoteDirection({ key: event.key, keyCode: event.keyCode })
        : null;
      if (remoteDir) {
        event.preventDefault();
        if (terminalMineState || creditsOpen) return;
        fireDirection(remoteDir);
        return;
      }
      // Play/Pause remains jump. Outside TV mode, Rewind and Fast Forward
      // keep their camera zoom behavior. Older stacks may supply only the
      // legacy Android key codes.
      if (event.key === "MediaPlayPause" || event.keyCode === 179) {
        event.preventDefault();
        if (!creditsOpen) fireJump();
        return;
      }
      if (event.key === "MediaRewind" || event.keyCode === 227) {
        event.preventDefault();
        adjustCameraZoom(MINE_CAMERA_BUTTON_STEP);
        return;
      }
      if (event.key === "MediaFastForward" || event.keyCode === 228) {
        event.preventDefault();
        adjustCameraZoom(-MINE_CAMERA_BUTTON_STEP);
        return;
      }
      // Enter walks the miner into the building on the current surface
      // column (F-061). A focused button keeps its own activation.
      if (event.key === "Enter") {
        if (targetEl?.closest("button,a,[role='button']")) return;
        if (elevatorPlacementMode) {
          event.preventDefault();
          placeElevatorAtCurrentColumnRef.current();
          return;
        }
        const state = useMineStore.getState();
        const surfaceMiner = state.mine.miner;
        const dest =
          surfaceMiner.row === 0 ? destinationAt(surfaceMiner.col) : null;
        if (!dest) return;
        event.preventDefault();
        if (terminalMineState || creditsOpen) return;
        router.push(dest.href);
        return;
      }
      // Shift uppercases the WASD letters, so normalize before matching so
      // Shift + a lateral letter still resolves like the arrows do.
      const key = normalizeKeyName(event.key);
      // Shift modifies the vertical keys (F-059): Shift + Up jumps instead
      // of climbing, Shift + Down drops through a plank instead of mining.
      // Lateral keys ignore Shift and keep the normal move.
      if (event.shiftKey) {
        if (key === "ArrowUp" || key === "w") {
          event.preventDefault();
          if (!creditsOpen) fireJump();
          return;
        }
        if (key === "ArrowDown" || key === "s") {
          event.preventDefault();
          if (!terminalMineState && !creditsOpen) firePlankDrop();
          return;
        }
      }
      const dir = KEY_DIRECTIONS[key];
      if (!dir) return;
      event.preventDefault();
      // Browser auto-repeat keydowns are not new intent: the cadence
      // controller's own timer repeats a held direction. Letting repeats
      // through would resurrect a chain the controller cancelled (the
      // ladder rule relies on "release and press again" being literal).
      if (event.repeat) return;
      if (terminalMineState) return;
      if (creditsOpen) return;
      fireDirection(dir);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const dir =
        (tvMode
          ? tvRemoteDirection({ key: event.key, keyCode: event.keyCode })
          : null) ?? KEY_DIRECTIONS[normalizeKeyName(event.key)];
      if (dir) releaseDirection(dir);
    };
    const onBlur = () => releaseDirection(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [
    adjustCameraZoom,
    creditsOpen,
    fireDirection,
    fireJump,
    firePlankDrop,
    elevatorPlacementMode,
    fpBunkerActive,
    releaseDirection,
    router,
    terminalMineState,
    tvMode,
  ]);

  const currentCell = cellAt(mine, miner.col, miner.row);
  const stratum = stratumAt(miner.row);
  const horizontalDistance = miner.col - START_COL;
  const horizontalDistanceLabel =
    horizontalDistance > 0 ? `+${horizontalDistance}` : `${horizontalDistance}`;
  const bagCapacity = cargoCapacity(mine.gear);
  const carriedOreCount = carriedCount(miner);
  const carriedOreStackCount = carriedStackCount(miner);
  const bagCells = oreBagCells(miner.carried);
  const bagCellKeyList = bagCells.map((cell) => cell.key).join("|");
  const selectedBagDrop = selectedOrePileFromBagCells(
    bagCells,
    selectedBagCells,
  );
  const selectedBagCount = selectedBagDrop.count;
  const canDropSelectedBagCells = miner.row > 0 && selectedBagCount > 0;
  const emptyBagSlots = Math.max(0, bagCapacity - carriedOreStackCount);
  const emptyBagCellKeys = Array.from(
    { length: emptyBagSlots },
    (_, index) => `empty-${carriedOreStackCount + index}`,
  );
  const bagDetails = bagDetailSummary(miner);
  const returnEstimate = returnHomeEstimate(mine);
  const climbCost = returnEstimate.reachable
    ? returnEstimate.energyCost
    : returnEnergyCost(miner);
  // The route estimate prices known clear paths back home (REQ-017).
  const batteryLow = miner.row > 0 && miner.energy < climbCost * 1.25 + 2;
  const laddersNeeded = returnEstimate.laddersNeeded;
  const returnRouteBlocked = miner.row > 0 && !returnEstimate.reachable;
  const ladderShort =
    miner.row > 0 &&
    returnEstimate.reachable &&
    laddersNeeded > mine.consumables.ladder;
  const returnRouteState =
    miner.row <= 0
      ? "surface"
      : returnRouteBlocked
        ? "blocked"
        : ladderShort
          ? "short"
          : "clear";
  // The village (REQ-021): standing on a stall's column opens its menu,
  // unless the player just closed it here (swipe-down or close button).
  const stall = miner.row === 0 ? stallAt(miner.col) : null;
  // Destination buildings (Workshop, Battles) route to another screen
  // instead of opening a sheet. The surface is the overworld hub.
  const destination = miner.row === 0 ? destinationAt(miner.col) : null;
  const portalHere =
    miner.row === 0 ? authoredPortalAt(miner.col, miner.row) : null;
  const activePortalHere =
    miner.row === 0 ? activePortalAt(mine, miner.col, miner.row) : null;
  const otherActivePortals = activePortalHere
    ? findPortalBeacons(mine).filter(
        (portal) => portal.active && portal.id !== activePortalHere.id,
      )
    : [];
  const lostCargo = miner.lostCargo;
  const lostDistance = lostCargo
    ? Math.abs(lostCargo.col - miner.col) + Math.abs(lostCargo.row - miner.row)
    : 0;
  const lostPulseSeconds = lostCargo
    ? Math.max(0.45, Math.min(1.6, 0.35 + lostDistance * 0.08))
    : 1;
  const visibleSupports = collectablePlacements(mine);
  const visibleSupportKeyList = visibleSupports.map(collectTargetKey).join("|");
  const selectedSupports = visibleSupports.filter((target) =>
    collectSelection.includes(collectTargetKey(target)),
  );
  const selectedSupportValue = selectedSupports.reduce(
    (sum, target) => sum + supportSalvageValue(target.type),
    0,
  );
  const bunkerCanvasEditing = Boolean(
    miner.row > 0 && activeBunker && bunkerPanelOpen && !terminalMineState,
  );
  const jumpAvailable = canJump(mine);
  const jumpButtonVisible =
    jumpAvailable &&
    !terminalMineState &&
    !bunkerCanvasEditing &&
    !fpBunkerActive;
  const jumpEnabled =
    jumpButtonVisible &&
    mineSceneReady &&
    !elevatorInteractionActive &&
    !elevatorPurchasePending &&
    !creditsOpen;
  // TV deck center button: on a destination column it walks into the
  // building (the remote's Select-click stand-in for the keyboard Enter);
  // everywhere else it fires the jump jets once those unlock.
  const tvCenterAction: TvCenterAction | null = !tvMode
    ? null
    : destination
      ? {
          label: `Enter ${destination.name}`,
          disabled: !mineSceneReady || terminalMineState || creditsOpen,
          onAct: () => router.push(destination.href),
        }
      : jumpButtonVisible
        ? { label: "Jump", disabled: !jumpEnabled, onAct: fireJump }
        : null;
  const leftPlankEnabled =
    !elevatorInteractionActive && canPlacePlank(mine, "left");
  const rightPlankEnabled =
    !elevatorInteractionActive && canPlacePlank(mine, "right");
  const beaconRange = warpRange(mine.gear);
  const beaconDepthAllowed = miner.row <= beaconRange;
  const beaconButtonDisabled = elevatorInteractionActive || !beaconDepthAllowed;
  const ownedElevatorColumn = elevatorColumn(mine.gear);
  const elevatorPurchaseFunds =
    balance === null ? null : balance + miner.bankedCredits;
  const elevatorPlacementIsFree =
    elevatorPlacementRequired && gear.elevator > 0;
  const elevatorPlacementVisible =
    elevatorPlacementMode &&
    miner.row === 0 &&
    (gear.elevator <= 0 || elevatorPlacementRequired);
  const usableElevatorDepth = Math.min(mine.gear.elevator, MINE_BOTTOM_ROW - 1);
  const minerOnElevatorRail = miner.col === ownedElevatorColumn;
  const salvagedSupportCount =
    lastResult?.ok && lastResult.supportCollected
      ? (lastResult.supportCollected.ladder ?? 0) +
        (lastResult.supportCollected.plank ?? 0) +
        (lastResult.supportCollected.beacon ?? 0)
      : 0;
  const salvagedSupportValue =
    lastResult?.ok && lastResult.supportSalvageValue
      ? lastResult.supportSalvageValue
      : 0;
  const bankedCredits = miner.bankedCredits;
  const bankedPartsCount = miner.bankedParts.length;
  const currentRecallRange = recallRopeRange(mine.gear);
  const baseReturn =
    miner.row === 0
      ? baseReturnTarget(miner.col, cameraZoom, viewportSize)
      : null;
  const baseReturnDisabled =
    !baseReturn ||
    baseReturnPending ||
    balance === null ||
    balance < baseReturn.cost ||
    cashOut.state === "pending";
  const baseReturnButtonLabel =
    balance === null
      ? "Ledger offline"
      : baseReturn && balance < baseReturn.cost
        ? `Need ${baseReturn.cost} vibes`
        : baseReturnConfirm && baseReturn
          ? `Confirm for ${baseReturn.cost} vibes`
          : baseReturn
            ? `Teleport for ${baseReturn.cost} vibes`
            : "Base visible";
  const baseReturnConfirmActive = baseReturnConfirm && !baseReturnDisabled;
  const baseReturnButtonColors = baseReturnDisabled
    ? {
        border: "1px solid #343b52",
        background: "#1b2030",
        color: "#6f7892",
      }
    : baseReturnConfirmActive
      ? {
          border: "1px solid #ff6b6b",
          background: "#4a1f28",
          color: "#ffd9d9",
        }
      : {
          border: "1px solid #54e0c7",
          background: "#173033",
          color: "#54e0c7",
        };
  const bunkerPreview =
    miner.row > 0 &&
    !activeBunker &&
    bunkerClaimMode &&
    !collectMode &&
    !terminalMineState
      ? (() => {
          const footprint = proposedBunkerFootprint(miner.col, miner.row);
          return footprint.row >= 1 ? footprint : null;
        })()
      : null;
  const localBlockedBunkerCells = useMemo(() => {
    void tick;
    return bunkerPreview
      ? bunkerCells(bunkerPreview).filter(
          ({ col, row }) => cellAt(mine, col, row)?.kind !== "empty",
        )
      : [];
  }, [bunkerPreview, mine, tick]);
  const handleBaseReturn = async () => {
    if (!baseReturn || baseReturnDisabled) return;
    if (!baseReturnConfirm) {
      setBaseReturnConfirm(true);
      return;
    }
    setBaseReturnPending(true);
    const ok = await teleportToBase(baseReturn.cost);
    setBaseReturnPending(false);
    if (!ok) return;
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
    setTeleportBurstKey((key) => key + 1);
    playMineSfxEvent("warp");
  };

  useEffect(() => {
    const visibleSupportKeys = new Set(
      visibleSupportKeyList ? visibleSupportKeyList.split("|") : [],
    );
    setCollectSelection((prev) =>
      prev.filter((key) => visibleSupportKeys.has(key)),
    );
  }, [visibleSupportKeyList]);

  useEffect(() => {
    if (bagPanelOpen) return;
    setSelectedBagCells((prev) => (prev.size === 0 ? prev : new Set()));
  }, [bagPanelOpen]);

  useEffect(() => {
    const validBagKeys = new Set(
      bagCellKeyList ? bagCellKeyList.split("|") : [],
    );
    setSelectedBagCells((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const key of prev) {
        if (validBagKeys.has(key)) next.add(key);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [bagCellKeyList]);

  useEffect(() => {
    if (!(lastResult?.ok && lastResult.bagFull)) return;
    setBagFullFlash(false);
    const frame = window.requestAnimationFrame(() => setBagFullFlash(true));
    const timer = window.setTimeout(() => setBagFullFlash(false), 620);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [lastResult]);

  useEffect(() => {
    if (baseReturn) return;
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
  }, [baseReturn]);

  useEffect(() => {
    if (activeBunker || miner.row <= 0) setBunkerClaimMode(false);
  }, [activeBunker, miner.row]);

  useEffect(() => {
    if (!collectMode) return;
    setBunkerClaimMode(false);
    setBunkerPanelOpen(false);
    setBunkerToolSelection(null);
  }, [collectMode]);

  useEffect(() => {
    if (!terminalMineState && miner.row > 0) return;
    setBunkerClaimMode(false);
    setBunkerPanelOpen(false);
    setBunkerToolSelection(null);
  }, [miner.row, terminalMineState]);

  useEffect(() => {
    if (activeBunker) return;
    setBunkerToolSelection(null);
  }, [activeBunker]);

  const showFpDenyNotice = useCallback((notice: string) => {
    setFpDenyNotice(notice);
    window.clearTimeout(fpDenyNoticeTimerRef.current);
    fpDenyNoticeTimerRef.current = window.setTimeout(
      () => setFpDenyNotice(null),
      2400,
    );
  }, []);
  useEffect(() => {
    return () => window.clearTimeout(fpDenyNoticeTimerRef.current);
  }, []);

  const enterFpBunker = useCallback(() => {
    // Every Enter affordance (floating button, panel row, "f" key)
    // funnels through this single guard.
    if (!fpBunkerAllowed || elevatorInteractionActive) return;
    const currentMiner = useMineStore.getState().mine.miner;
    if (
      !activeBunker ||
      !containsBunkerCell(
        activeBunker.footprint,
        currentMiner.col,
        currentMiner.row,
      )
    ) {
      return;
    }
    // Close the sheet and any floating menus, and re-arm the
    // first-paint veil so the canvas swap hides behind it.
    dismissFloatingMenus();
    setBunkerPanelOpen(false);
    setMineCanvasPainted(false);
    // Arrive with the pick out: digging deep claim rock is the first
    // move in a fresh claim and the first tool the tutorial teaches, so
    // Pick is the default rather than the build ghost.
    setBunkerToolSelection("dig");
    setFpBunkerActive(true);
  }, [
    activeBunker,
    dismissFloatingMenus,
    elevatorInteractionActive,
    fpBunkerAllowed,
  ]);

  const exitFpBunker = useCallback(() => {
    setFpBunkerActive(false);
    // The veil also covers the swap back to the 2D canvas.
    setMineCanvasPainted(false);
  }, []);

  // The fp HUD's Upkeep button opens the sheet as an overlay over the
  // live first-person canvas (no mode switch). Releasing the pointer
  // lock frees the cursor; the fp keyboard/tool/Escape effects pause
  // while the sheet is open (they gate on bunkerPanelOpen like the bag).
  const openStatusFromFp = useCallback(() => {
    if (typeof document !== "undefined") document.exitPointerLock?.();
    setBunkerPanelOpen(true);
  }, []);

  // Open the cargo bag from inside first person. Releasing the pointer
  // lock frees the cursor for the panel; the keyboard and tool-key
  // effects detach while the bag is open (they gate on bagPanelOpen), and
  // the bag overlay (z 36) sits above the fp touch zones, so digging and
  // walking pause behind it and the miner stays put.
  const openBagFromFp = useCallback(() => {
    if (typeof document !== "undefined") document.exitPointerLock?.();
    setBagPanelOpen(true);
  }, []);

  // Forced exit: if the gate closes while inside (raid resolves against
  // the player, terminal collapse, bunker vanishes), drop back to 2D.
  useEffect(() => {
    if (fpBunkerAllowed) return;
    setFpBunkerActive(false);
  }, [fpBunkerAllowed]);

  // Tool state exists only inside the first-person view: any way out
  // (exit button, Escape, forced exit) clears the selection and any
  // lingering deny chip. Pried parts already refunded on the spot
  // (F-099), so there is nothing else to restore.
  useEffect(() => {
    if (fpBunkerActive) return;
    setBunkerToolSelection(null);
    setFpDenyNotice(null);
  }, [fpBunkerActive]);

  /**
   * Applies a first-person edit intent from the canvas: the same
   * pending/banked store split as the 2D hammer flow, plus its haptic
   * and sfx feedback. The canvas pre-guards reach, target kind, and
   * capsule overlap; stock and sim rules are re-checked here.
   */
  const applyFpBunkerEdit = useCallback(
    (intent: FpEditIntent) => {
      if (!activeBunker) return;
      const { col, row, depth } = intent.cell;
      const feedback = (ok: boolean, sfx: "plank" | "clang" | "dig-rock") => {
        triggerShopHaptic(ok ? "commit" : "deny");
        playMineSfxEvent(ok ? sfx : "deny");
      };
      // Pending trips edit the local store synchronously; banked bunkers
      // go through the remote store. Either way the result drives the
      // same feedback.
      const commit = (
        sync: () => boolean,
        remote: () => Promise<unknown>,
        sfx: "plank" | "clang" | "dig-rock",
      ) => {
        if (pendingBunkerActive) {
          feedback(sync(), sfx);
          return;
        }
        void remote().then((result) => {
          feedback(Boolean(result), sfx);
        });
      };

      if (intent.kind === "chip") {
        // A non-breaking pickaxe hit (multi-hit digging, REQ-013 parity):
        // feedback only, no store commit. The block's ore still credits
        // in full when the breaking hit lands, so a chip's fleck is a
        // preview, not a payout.
        triggerShopHaptic("commit");
        playMineSfxEvent("dig-rock");
        return;
      }

      if (intent.kind === "collect") {
        // Only banked bunkers carry overflow loot; a pending claim settles
        // its overflow at bank, so there is nothing to collect mid-trip.
        if (pendingBunkerActive) return;
        void collectBunkerLootRemote(col, row, depth).then((ok) => {
          if (ok) {
            triggerShopHaptic("commit");
            playMineSfxEvent("dig-rock");
          }
        });
        return;
      }

      if (intent.kind === "dig") {
        if (pendingBunkerActive) {
          // A pending claim settles its ore at bank into its own bag; the
          // local excavate records the dug cell only.
          feedback(excavatePendingBunkerCell(col, row, depth), "dig-rock");
          return;
        }
        // A banked bunker persists the dug cell server-side first, then the
        // drop is logged into the trip so it rides the shared bag and sells
        // at the surface (the bank replay credits it). We only log after the
        // authoritative excavate lands, so the cell is in the durable dug set
        // the server validates against.
        void excavateBunkerCellRemote(col, row, depth).then((ok) => {
          if (ok) recordBankedBunkerDig(activeBunker, col, row, depth);
          feedback(Boolean(ok), "dig-rock");
        });
        return;
      }

      if (intent.kind === "pry") {
        const part =
          intent.slot === undefined
            ? bunkerPartAtWholeCell(activeBunker, col, row, depth)
            : bunkerPartAtSlot(
                activeBunker,
                canonicalWallSlot(
                  activeBunker.footprint,
                  col,
                  row,
                  depth,
                  intent.slot,
                ),
              );
        if (!part) {
          feedback(false, "clang");
          return;
        }
        // Refunding a damaged part at full count would launder its
        // damage (the removeBasePart contract), so the pry refuses
        // with repair-first guidance. Sharing the sim's predicate keeps
        // this pre-check from drifting; the sim re-checks underneath.
        if (isBasePartDamaged(part)) {
          feedback(false, "clang");
          showFpDenyNotice("Damaged: repair from the Bunker sheet first");
          return;
        }
        // F-099 auto-stow: the pry returns the part straight to
        // inventory so the next pry can follow immediately. Pry the exact
        // slot of the part found at the cell so a thin wall comes out, not a
        // whole-cell match (F-117); the sim canonicalizes the wall face.
        commit(
          () => removePendingBunkerPart(col, row, depth, part.slot),
          () => removeBunkerPart(col, row, depth, part.slot),
          "clang",
        );
        return;
      }

      const partId = selectedBasePart;
      if (activeBunkerInventory[partId] <= 0) {
        feedback(false, "plank");
        return;
      }
      // The slot the canvas aimed at (F-117), including the explicit mount
      // slot for current whole-cell parts. Orientation rides along for a
      // rotatable part (the staircase) and is absent otherwise.
      commit(
        () =>
          placePendingBunkerPart(
            partId,
            col,
            row,
            depth,
            intent.slot,
            intent.orientation,
          ),
        () =>
          placeBunkerPart(
            partId,
            col,
            row,
            depth,
            intent.slot,
            intent.orientation,
          ),
        "plank",
      );
    },
    [
      activeBunker,
      activeBunkerInventory,
      collectBunkerLootRemote,
      excavateBunkerCellRemote,
      excavatePendingBunkerCell,
      recordBankedBunkerDig,
      pendingBunkerActive,
      placeBunkerPart,
      placePendingBunkerPart,
      removeBunkerPart,
      removePendingBunkerPart,
      selectedBasePart,
      showFpDenyNotice,
    ],
  );

  // First-person hotbar selection: direct state writes; fp mode never
  // issues move-log actions.
  // Facing for a rotatable build part (the staircase). The rotate control
  // cycles it through the four quarter turns; fixed parts ignore it.
  const [selectedFpOrientation, setSelectedFpOrientation] =
    useState<BunkerOrientation>(0);
  const rotateFpPart = useCallback(() => {
    setSelectedFpOrientation((prev) => ((prev + 1) % 4) as BunkerOrientation);
  }, []);
  // Tapping the already-armed tool clears it (nothing selected), so the
  // player can walk and look with no ghost, outline, or accidental act.
  const selectFpPart = useCallback((partId: BasePartId) => {
    setBunkerToolSelection((prev) => (prev === partId ? null : partId));
  }, []);
  const selectFpPick = useCallback(() => {
    setBunkerToolSelection((prev) => (prev === "dig" ? null : "dig"));
  }, []);
  const toggleFpPry = useCallback(() => {
    setBunkerToolSelection((prev) => (prev === "pry" ? null : "pry"));
  }, []);

  // First-person tool keys: 0 or backtick = pick, 1-6 = part slots,
  // q = pry toggle. Movement keys live in attachFpKeyboard. Both pause
  // while the bag panel is open so typing does not reselect a tool.
  useEffect(() => {
    if (!fpBunkerActive || bagPanelOpen || bunkerPanelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (bunkerToolKeyIgnored(event)) return;
      if (event.key === "0" || event.code === "Backquote") {
        event.preventDefault();
        selectFpPick();
        return;
      }
      if (event.key === "q" || event.key === "Q") {
        event.preventDefault();
        toggleFpPry();
        return;
      }
      // Rotate a rotatable build part (the staircase) through its four
      // facings; a no-op for every fixed part.
      if (event.key === "r" || event.key === "R") {
        if (!isRotatableBasePart(selectedBasePart)) return;
        event.preventDefault();
        rotateFpPart();
        return;
      }
      const slot = Number(event.key) - 1;
      const partId = AVAILABLE_BASE_PART_IDS[slot];
      if (!partId) return;
      event.preventDefault();
      if (activeBunkerInventory[partId] <= 0) return;
      selectFpPart(partId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeBunkerInventory,
    fpBunkerActive,
    bagPanelOpen,
    bunkerPanelOpen,
    selectedBasePart,
    selectFpPart,
    selectFpPick,
    toggleFpPry,
    rotateFpPart,
  ]);

  // First-person keyboard: WASD/arrows plus Space live in the shared
  // fp input singleton while the mode is on; detach zeroes everything.
  useEffect(() => {
    // Detached while the bag or upkeep panel is open so WASD and dig do
    // not drive the miner behind the modal; resetFpInput zeroes any held
    // input.
    if (!fpBunkerActive || bagPanelOpen || bunkerPanelOpen) return;
    const detach = attachFpKeyboard();
    return () => {
      detach();
      resetFpInput();
    };
  }, [fpBunkerActive, bagPanelOpen, bunkerPanelOpen]);

  // Second-Escape exit: while pointer lock is held the browser consumes
  // the first Escape to leave the lock, so any Escape that reaches this
  // handler means "leave the bunker view". Paused while the bag or the
  // upkeep sheet is open so Escape closes that overlay (their own
  // handlers) instead of exiting the view.
  useEffect(() => {
    if (!fpBunkerActive || bagPanelOpen || bunkerPanelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.pointerLockElement) return;
      event.preventDefault();
      exitFpBunker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitFpBunker, fpBunkerActive, bagPanelOpen, bunkerPanelOpen]);

  // The flat view's only bunker key: "f" enters first person. The old
  // 2D part-selection digits and Escape-stow retired with the hammer,
  // so digits and direction keys always mean normal mine movement here.
  useEffect(() => {
    const onBunkerEnterKey = (event: KeyboardEvent) => {
      if (fpBunkerActive) return;
      if (bunkerToolKeyIgnored(event)) return;
      if (event.key !== "f" && event.key !== "F") return;
      if (!activeBunker) return;
      event.preventDefault();
      enterFpBunker();
    };
    window.addEventListener("keydown", onBunkerEnterKey);
    return () => window.removeEventListener("keydown", onBunkerEnterKey);
  }, [activeBunker, enterFpBunker, fpBunkerActive]);

  useEffect(() => {
    if (
      !resumeElevatorDirection ||
      !worldLoaded ||
      !mineSceneReady ||
      !mineCanvasPainted
    )
      return;
    useMineStore.setState({ resumeElevatorDirection: null });
    if (
      terminalMineState ||
      cashOut.state === "pending" ||
      !minerOnElevatorRail ||
      (resumeElevatorDirection === "ride-down"
        ? miner.row >= usableElevatorDepth
        : miner.row <= 0)
    ) {
      return;
    }
    const sequence = elevatorSequenceRef.current + 1;
    elevatorSequenceRef.current = sequence;
    setElevatorPresentation({
      sequence,
      stage: "riding",
      carRow: miner.row,
      entryDirection: null,
    });
    setElevatorAutoDir(resumeElevatorDirection);
  }, [
    cashOut.state,
    miner.row,
    minerOnElevatorRail,
    mineCanvasPainted,
    mineSceneReady,
    resumeElevatorDirection,
    terminalMineState,
    usableElevatorDepth,
    worldLoaded,
  ]);

  useEffect(() => {
    if (!elevatorAutoDir) return;
    if (terminalMineState) {
      setElevatorAutoDir(null);
      pendingElevatorEntryRef.current = null;
      setElevatorPresentation((current) => ({
        ...current,
        stage: "idle",
        entryDirection: null,
      }));
      return;
    }
    const atEnd =
      elevatorAutoDir === "ride-down"
        ? !minerOnElevatorRail || miner.row >= usableElevatorDepth
        : !minerOnElevatorRail || miner.row <= 0;
    if (atEnd || cashOut.state === "pending") {
      if (useMineStore.getState().mine.elevatorPhase === "idle") {
        setElevatorAutoDir(null);
        setElevatorPresentation((current) => ({
          ...current,
          stage: "idle",
          carRow: useMineStore.getState().mine.miner.row,
          entryDirection: null,
        }));
      }
      return;
    }
    const timer = setTimeout(() => {
      move(elevatorAutoDir);
    }, elevatorAutoDelayMs(mine.gear));
    return () => clearTimeout(timer);
  }, [
    cashOut.state,
    elevatorAutoDir,
    mine.gear,
    miner.row,
    minerOnElevatorRail,
    move,
    terminalMineState,
    usableElevatorDepth,
  ]);

  useEffect(() => {
    if (!worldLoaded || !mineSceneReady || !mineCanvasPainted) return;
    if (
      mine.elevatorPhase === "boarded" &&
      elevatorPresentationRef.current.stage === "idle"
    ) {
      const sequence = elevatorSequenceRef.current + 1;
      elevatorSequenceRef.current = sequence;
      setElevatorPresentation({
        sequence,
        stage: "choosing",
        carRow: miner.row,
        entryDirection: null,
      });
      return;
    }
    if (
      mine.elevatorPhase === "idle" &&
      (elevatorPresentationRef.current.stage === "choosing" ||
        elevatorPresentationRef.current.stage === "riding")
    ) {
      setElevatorAutoDir(null);
      pendingElevatorEntryRef.current = null;
      setElevatorPresentation((current) => ({
        ...current,
        stage: "idle",
        carRow: miner.row,
        entryDirection: null,
      }));
    }
  }, [
    mine.elevatorPhase,
    mineCanvasPainted,
    mineSceneReady,
    miner.row,
    worldLoaded,
  ]);

  useEffect(() => {
    const previousRow = previousMinerRowRef.current;
    previousMinerRowRef.current = miner.row;
    if (cashOut.state === "pending") return;
    const arrivedAtSurface = previousRow > 0 && miner.row === 0;
    const restoredAtElevatorSurface =
      worldLoaded &&
      miner.row === 0 &&
      mine.elevatorPhase === "boarded" &&
      movesLength > 0;
    if (!arrivedAtSurface && !restoredAtElevatorSurface) return;
    // Bank whenever the trip is worth persisting, which is not only when
    // the hold has something to sell. A carved shaft, a placed ladder, or
    // any other change to the world is progress the server must checkpoint
    // (REQ-026), and the bank route already accepts a zero-value trip for
    // exactly this reason. Gating on loot alone meant an ore-less digging
    // trip never reached the server: the carving lived only in the device's
    // move log, the stored world stayed frozen at the last loot-bearing
    // trip, and the two trip counters drifted apart from there.
    if (
      bankedCredits <= 0 &&
      bankedPartsCount <= 0 &&
      !pendingBunkerActive &&
      !carvedThisTrip
    ) {
      return;
    }
    const key = `${seed}:${tripIndex}:${movesLength}:${bankedCredits}:${bankedPartsCount}:${pendingBunkerActive ? "bunker" : "mine"}`;
    if (lastAutoCashOutKeyRef.current === key) return;
    lastAutoCashOutKeyRef.current = key;
    void submitCashOut();
  }, [
    bankedCredits,
    bankedPartsCount,
    cashOut.state,
    miner.row,
    movesLength,
    pendingBunkerActive,
    seed,
    submitCashOut,
    carvedThisTrip,
    tripIndex,
    mine.elevatorPhase,
    worldLoaded,
  ]);

  // A carving trip that surfaced and could NOT be banked leaves the only
  // copy of that work on this device. The server cannot notice this for
  // itself: a bank that is refused or never sent leaves no request behind,
  // and that silence reads exactly like nobody playing, which is how
  // ore-less digs went unbanked for days before a player reported it
  // (F-220). Reporting it from the client is the only way the absence
  // becomes visible. Deduped per trip and settled state, so a player stuck
  // offline reports once rather than on every surface arrival.
  useEffect(() => {
    if (!worldLoaded || !carvedThisTrip) return;
    if (cashOut.state !== "error" && cashOut.state !== "unavailable") return;
    // The report is about surfacing with unbanked work, so it only counts
    // at the surface. A failed cash-out leaves its state settled while the
    // player keeps going, and without this the next descent would report
    // from underground.
    if (miner.row !== 0) return;
    // Keyed by trip and settled state only. Including the move count would
    // mint a fresh key on every action, turning "report once" into a report
    // per swing for a player who simply carries on after a failed bank.
    const key = `unbanked:${seed}:${tripIndex}:${cashOut.state}`;
    if (inputDiagnosticKeysRef.current.has(key)) return;
    inputDiagnosticKeysRef.current.add(key);
    void fetch("/api/mine/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        code: "surfaced_carving_unbanked",
        appVersion: appRelease.version,
        appBuild: appRelease.build,
        mineVersion: MINE_VERSION,
        activeSlot,
        minerRow: miner.row,
        cashOutState: cashOut.state,
        moveCount: movesLength,
      }),
    }).catch(() => {
      // Offline is the likeliest reason the bank failed in the first
      // place, so a failed report must never surface to the player.
    });
  }, [
    activeSlot,
    appRelease.build,
    appRelease.version,
    carvedThisTrip,
    cashOut.state,
    miner.row,
    movesLength,
    seed,
    tripIndex,
    worldLoaded,
  ]);

  const startElevatorRide = (dir: MineAction) => {
    setDynamiteMenuOpen(false);
    if (dir === "ride-down" || dir === "ride-up") {
      const state = useMineStore.getState();
      if (
        elevatorPresentationRef.current.stage !== "choosing" ||
        state.mine.elevatorPhase !== "boarded"
      ) {
        return;
      }
      const bottom = Math.min(state.mine.gear.elevator, MINE_BOTTOM_ROW - 1);
      if (
        (dir === "ride-up" && state.mine.miner.row <= 0) ||
        (dir === "ride-down" && state.mine.miner.row >= bottom)
      ) {
        return;
      }
      const startRow = state.mine.miner.row;
      const result = state.move(dir);
      if (!result?.ok || result.collapsed) return;
      const sequence = elevatorSequenceRef.current + 1;
      elevatorSequenceRef.current = sequence;
      setRecoveryMenuOpen(false);
      setElevatorPresentation((current) => ({
        ...current,
        sequence,
        stage: "riding",
        carRow: startRow,
        entryDirection: null,
      }));
      setElevatorAutoDir(dir);
      return;
    }
    move(dir);
  };
  elevatorDestinationRef.current = (direction) => startElevatorRide(direction);

  const openFeedback = useCallback((context: FeedbackContext) => {
    setFeedbackContext(context);
    setFeedbackOpen(true);
  }, []);

  const toggleCollectTarget = useCallback((target: CollectTarget) => {
    const key = collectTargetKey(target);
    setCollectSelection((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }, []);

  const toggleBagCell = useCallback((key: string) => {
    setSelectedBagCells((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearBagSelection = useCallback(() => {
    setSelectedBagCells((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const dropSelectedBagCells = useCallback(() => {
    if (miner.row < 1 || selectedBagCells.size === 0) return;
    const currentBagCells = oreBagCells(
      useMineStore.getState().mine.miner.carried,
    );
    const currentBagDrop = selectedOrePileFromBagCells(
      currentBagCells,
      selectedBagCells,
    );
    if (currentBagDrop.count <= 0) return;
    move(dropOreAction(currentBagDrop.pile));
    setSelectedBagCells(new Set());
  }, [miner.row, move, selectedBagCells]);

  // One terse toast, game-style: the chips carry the numbers.
  const statusLine =
    lastResult && !lastResult.ok
      ? lastResult.reason === "rock"
        ? lastResult.requiredPickaxeLevel
          ? `Pickaxe level ${lastResult.requiredPickaxeLevel} needed.`
          : "Too hard for this pickaxe."
        : lastResult.reason === "hold-full"
          ? "Hold full. Bank it topside."
          : lastResult.reason === "no-dynamite"
            ? "No dynamite."
            : lastResult.reason === "no-ladder"
              ? "No ladders to climb. Recall or Abandon."
              : lastResult.reason === "no-plank"
                ? "No planks to bridge that drop."
                : lastResult.reason === "no-beacon"
                  ? "No planted beacon. Buy kits at the Supply Depot."
                  : lastResult.reason === "out-of-range"
                    ? "Beacon is beyond Warpcoil range. Upgrade Warpcoil."
                    : lastResult.reason === "rope-range"
                      ? "Too deep for Recall Rope. Upgrade Recall Rope."
                      : lastResult.reason === "no-rope"
                        ? "No Recall Rope."
                        : lastResult.reason === "surface"
                          ? undefined
                          : lastResult.reason === "blocked"
                            ? "No way through."
                            : "Edge of the mine."
      : lastResult?.ok && lastResult.fallFatal
        ? "Fell too far. The crew hauled you out; the cargo stayed below."
        : lastResult?.ok && lastResult.crushed
          ? "Crushed! The crew dug you out; the cargo stayed behind."
          : lastResult?.ok && lastResult.abandoned
            ? "Abandoned the dig; the bag stayed behind."
            : lastResult?.ok && lastResult.collapsed
              ? "Battery drained. Hauled up empty."
              : lastResult?.ok && lastResult.recalled
                ? "Roped home; resources sold."
                : lastResult?.ok && lastResult.exploded
                  ? "Boom!"
                  : lastResult?.ok && lastResult.dynamitePlanted
                    ? "Fuse lit. Move away."
                    : lastResult?.ok && lastResult.plankPlaced
                      ? "Plank placed."
                      : lastResult?.ok && lastResult.jumped
                        ? "Jump jets fired."
                        : salvagedSupportCount > 0
                          ? `Scrapped ${salvagedSupportCount} support${salvagedSupportCount > 1 ? "s" : ""}. Scrap sells for ${salvagedSupportValue} vibes at surface.`
                          : lastResult?.ok &&
                              (lastResult.droppedFromBag ?? 0) > 0
                            ? `Dropped ${lastResult.droppedFromBag} ore from bag.`
                            : lastResult?.ok && (lastResult.dropped ?? 0) > 0
                              ? `${lastResult.dropped} ore dropped.`
                              : lastResult?.ok && lastResult.pickedUpBag
                                ? `Recovered bag: ${lastResult.pickedUpBag.value} vibes${lastResult.pickedUpBag.parts > 0 ? ` and ${lastResult.pickedUpBag.parts} part${lastResult.pickedUpBag.parts > 1 ? "s" : ""}` : ""}.`
                                : lastResult?.ok &&
                                    (lastResult.pickedUp ?? 0) > 0
                                  ? `Collected ${lastResult.pickedUp} ore.`
                                  : lastResult?.ok &&
                                      (lastResult.vented ?? 0) > 0
                                    ? `Gas! ${(lastResult.vented ?? 0) * 8} charge burned.`
                                    : miner.row === 0 &&
                                        (bankedCredits > 0 ||
                                          bankedPartsCount > 0)
                                      ? cashOut.state === "pending"
                                        ? "Selling haul..."
                                        : undefined
                                      : undefined;
  const cashNote =
    cashOut.state === "done"
      ? soldHaulLine(cashOut.soldHaul, cashOut.credits, cashOut.parts)
      : cashOut.state === "unavailable"
        ? "Couldn't sell; loot is safe, try again."
        : cashOut.state === "error"
          ? cashOut.message
          : null;
  const autoSellStatusLine = cashNoteVisible ? cashNote : null;
  const surfaceInfoLine = autoSellStatusLine ?? mineSurfaceTip;
  const surfaceInfoColor = autoSellStatusLine
    ? cashOut.state === "error"
      ? "#ff6b6b"
      : "#54e0c7"
    : "#f5c542";
  const showSurfaceInfoLine =
    miner.row === 0 &&
    surfaceInfoLine !== null &&
    (autoSellStatusLine !== null || !statusLine);

  const act = fireDirection;
  const unlockedDynamiteTier = dynamiteTier(mine.gear);
  const selectedDynamiteLocked = selectedDynamiteTier > unlockedDynamiteTier;
  const selectedDynamitePreview = dynamiteMenuOpen
    ? dynamitePreviewCells(mine, selectedDynamiteTier)
    : [];
  const canConfirmDynamite =
    dynamiteMenuOpen &&
    !selectedDynamiteLocked &&
    mine.consumables.dynamite > 0 &&
    !elevatorInteractionActive &&
    !mine.pendingDynamite;
  const minCameraZoomReached =
    cameraZoom <= MINE_CAMERA_MIN_ZOOM + MINE_CAMERA_BUTTON_STEP / 4;
  const maxCameraZoom = maxMineCameraZoom(mine.gear);
  const maxCameraZoomReached =
    cameraZoom >= maxCameraZoom - MINE_CAMERA_BUTTON_STEP / 4;
  const dynamiteHelperText = selectedDynamiteLocked
    ? "Locked. Buy this dynamite tier at the Upgrades stall."
    : mine.consumables.dynamite <= 0
      ? "No dynamite packed. Buy sticks at the Supply Depot."
      : mine.pendingDynamite
        ? "One fuse is already lit."
        : null;
  const movementTouchEnabled =
    mineSceneReady &&
    !elevatorBusy &&
    !elevatorPurchasePending &&
    !collectMode &&
    !bunkerCanvasEditing &&
    !creditsOpen &&
    !terminalMineState &&
    !fpBunkerActive;

  useEffect(() => {
    if (releaseNotesVisible) return;
    if (!coarsePointer && navigator.maxTouchPoints <= 0) return;
    const code =
      terminalMineState && lastAction === null && movesLength > 0
        ? "saved_trip_replay_collapsed"
        : terminalMineState && (bunkerClaimMode || bunkerPanelOpen)
          ? "bunker_overlay_during_terminal"
          : null;
    if (!code) return;
    const key = [
      "state",
      code,
      activeSlot,
      miner.row,
      activeBunker ? "bunker" : "mine",
      bunkerPanelOpen ? "panel" : "closed",
      terminalMineState ? "terminal" : "play",
    ].join(":");
    if (inputDiagnosticKeysRef.current.has(key)) return;
    inputDiagnosticKeysRef.current.add(key);
    void fetch("/api/mine/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        code,
        appVersion: appRelease.version,
        appBuild: appRelease.build,
        mineVersion: MINE_VERSION,
        activeSlot,
        minerRow: miner.row,
        hasActiveBunker: Boolean(activeBunker),
        bunkerPanelOpen,
        collectMode,
        creditsOpen,
        mineSceneReady,
        movementTouchEnabled,
        displayMode: mineViewportFrame?.displayMode ?? null,
        detail:
          code === "saved_trip_replay_collapsed"
            ? "saved trip replay restored a terminal collapse result"
            : "bunker overlay remained open during a terminal mine result",
      }),
    }).catch(() => {});
  }, [
    activeBunker,
    activeSlot,
    appRelease,
    bunkerClaimMode,
    bunkerPanelOpen,
    coarsePointer,
    collectMode,
    creditsOpen,
    lastAction,
    mineSceneReady,
    mineViewportFrame,
    miner.row,
    movementTouchEnabled,
    movesLength,
    releaseNotesVisible,
    terminalMineState,
  ]);

  useEffect(() => {
    if (!movementTouchEnabled) return;
    if (releaseNotesVisible) return;
    if (!coarsePointer && navigator.maxTouchPoints <= 0) return;
    const key = [
      activeSlot,
      miner.row,
      activeBunker ? "bunker" : "mine",
      bunkerPanelOpen ? "panel" : "closed",
      collectMode ? "collect" : "move",
      creditsOpen ? "credits" : "play",
    ].join(":");
    if (inputDiagnosticKeysRef.current.has(key)) return;

    const frame = window.requestAnimationFrame(() => {
      if (document.querySelector("[role='dialog']")) return;
      const surface = document.querySelector("[data-touch-surface]");
      const visual = window.visualViewport;
      const viewport = {
        width: Math.round(window.innerWidth),
        height: Math.round(window.innerHeight),
        visualWidth: visual ? Math.round(visual.width) : null,
        visualHeight: visual ? Math.round(visual.height) : null,
        visualScale: visual ? visual.scale : null,
      };
      const samplePoints = [
        { x: 0.38, y: 0.62 },
        { x: 0.62, y: 0.62 },
        { x: 0.5, y: 0.52 },
        { x: 0.5, y: 0.72 },
      ].map((point) => ({
        x: Math.round(
          Math.min(viewport.width - 24, Math.max(24, viewport.width * point.x)),
        ),
        y: Math.round(
          Math.min(
            viewport.height - 96,
            Math.max(24, viewport.height * point.y),
          ),
        ),
      }));
      const samples = samplePoints.map((point) => {
        const target = document.elementFromPoint(point.x, point.y);
        return {
          target,
          touchTarget: target?.closest("[data-touch-surface]") ?? null,
          interactiveTarget:
            target?.closest(
              "button,[role='button'],[role='status'],[role='alert']",
            ) ?? null,
        };
      });
      const openSample = samples.find((sample) => sample.touchTarget);
      const blocker = samples.find(
        (sample) => !sample.touchTarget && !sample.interactiveTarget,
      );
      const code = !surface
        ? "touch_surface_missing"
        : !openSample && blocker
          ? "touch_surface_not_topmost"
          : null;
      if (!code) return;
      const target = blocker?.target ?? samples[0]?.target ?? null;
      inputDiagnosticKeysRef.current.add(key);
      void fetch("/api/mine/diagnostics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          code,
          appVersion: appRelease.version,
          appBuild: appRelease.build,
          mineVersion: MINE_VERSION,
          activeSlot,
          minerRow: miner.row,
          hasActiveBunker: Boolean(activeBunker),
          bunkerPanelOpen,
          collectMode,
          creditsOpen,
          mineSceneReady,
          movementTouchEnabled,
          displayMode: mineViewportFrame?.displayMode ?? null,
          viewport,
          target: {
            tag: target instanceof Element ? target.tagName : null,
            role:
              target instanceof Element ? target.getAttribute("role") : null,
            ariaLabel:
              target instanceof Element
                ? target.getAttribute("aria-label")
                : null,
            hasTouchSurface: Boolean(
              samples.find((sample) => sample.target === target)?.touchTarget,
            ),
          },
          detail:
            code === "touch_surface_missing"
              ? "movement touch surface missing while movement is enabled"
              : "movement touch surface is not the topmost open mine target",
        }),
      }).catch(() => {});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeBunker,
    activeSlot,
    appRelease,
    bunkerPanelOpen,
    coarsePointer,
    collectMode,
    creditsOpen,
    mineSceneReady,
    mineViewportFrame,
    miner.row,
    movementTouchEnabled,
    releaseNotesVisible,
  ]);
  const retryMineSceneLoad = () => {
    setMineCanvasKey((key) => key + 1);
    void loadMineScene();
  };
  const reportMineSceneError = (message: string) => {
    setMineSceneStatus("error");
    setMineSceneMessage(message || "The mine renderer failed to start.");
  };
  // TV overscan safe area: TVs can crop the outer edges of the picture,
  // which cut edge-anchored chrome (the pause menu sat half off the right
  // side of a Fire TV screen). Every mine overlay anchors to this shell,
  // so shrinking the shell itself keeps all of them, plus dialogs that
  // center inside it, within the visible screen with one rule.
  const tvSafe =
    tvMode && mineViewportFrame
      ? tvSafeInsets(mineViewportFrame.width, mineViewportFrame.height)
      : { x: 0, y: 0 };
  const measuredMineShellStyle: React.CSSProperties = mineViewportFrame
    ? {
        ...mineShellStyle,
        inset: "auto",
        left: `${mineViewportFrame.left + tvSafe.x}px`,
        top: `${mineViewportFrame.top + tvSafe.y}px`,
        width: `${mineViewportFrame.width - 2 * tvSafe.x}px`,
        height: `${mineViewportFrame.height - 2 * tvSafe.y}px`,
      }
    : mineShellStyle;

  return (
    <div
      data-mine-shell="true"
      data-tv-safe-area={tvMode ? "on" : "off"}
      data-display-mode={mineViewportFrame?.displayMode ?? "unknown"}
      data-layout-viewport-height={mineViewportValue(
        mineViewportFrame?.layoutHeight,
      )}
      data-layout-viewport-width={mineViewportValue(
        mineViewportFrame?.layoutWidth,
      )}
      data-refresh-entry={mineViewportFrame?.refreshEntry ?? "none"}
      data-visual-viewport-height={mineViewportValue(mineViewportFrame?.height)}
      data-visual-viewport-left={mineViewportValue(mineViewportFrame?.left)}
      data-visual-viewport-top={mineViewportValue(mineViewportFrame?.top)}
      data-visual-viewport-width={mineViewportValue(mineViewportFrame?.width)}
      style={measuredMineShellStyle}
    >
      {mineSceneReady && functionalRendererBypass ? (
        <MineSceneBackdrop />
      ) : mineSceneReady ? (
        <MineSceneErrorBoundary
          key={mineCanvasKey}
          onError={reportMineSceneError}
        >
          {fpBunkerActive && activeBunker ? (
            <BunkerFpCanvas
              bunker={activeBunker}
              entry={{ col: miner.col, row: miner.row }}
              tool={bunkerToolAction}
              gear={mine.gear}
              selectedPartId={selectedBasePart}
              selectedOrientation={selectedFpOrientation}
              onEdit={applyFpBunkerEdit}
              onExit={exitFpBunker}
              onFirstFrame={handleMineFirstFrame}
              liveRaid={activeBunkerLiveRaid}
              onResolveRaid={(report) => void resolveBunkerLiveRaid(report)}
              onForfeitRaid={() => void forfeitBunkerLiveRaid()}
            />
          ) : (
            <MineCanvas
              zoom={cameraZoom}
              elevatorPresentation={elevatorPresentation}
              collectMode={collectMode}
              selectedSupportKeys={collectSelection}
              dynamitePreviewCells={selectedDynamitePreview}
              bunkerPreview={bunkerPreview}
              bunkerBlockedCells={localBlockedBunkerCells}
              bunker={activeBunker}
              onToggleSupport={toggleCollectTarget}
              onElevatorStageComplete={handleElevatorStageComplete}
              onFirstFrame={handleMineFirstFrame}
            />
          )}
        </MineSceneErrorBoundary>
      ) : (
        <MineSceneBackdrop />
      )}
      {fpBunkerActive && mineSceneReady && (
        <BunkerFpHud
          inventory={activeBunkerInventory}
          tool={bunkerToolAction}
          selectedPartId={selectedBasePart}
          selectedOrientation={selectedFpOrientation}
          onRotate={rotateFpPart}
          denyNotice={fpDenyNotice}
          bagOreCount={carriedOreCount}
          bagStackCount={carriedOreStackCount}
          bagCapacity={bagCapacity}
          bagOpen={bagPanelOpen}
          onSelectPart={selectFpPart}
          onSelectPick={selectFpPick}
          onTogglePry={toggleFpPry}
          onOpenBag={openBagFromFp}
          onOpenStatus={openStatusFromFp}
          player={bunkerPlayer}
          onExit={exitFpBunker}
          onStartLiveRaid={(tier) => void startBunkerLiveRaid(tier)}
          raidTierCeiling={maxBunkerRaidTier(bunkerPlayer?.overallLevel ?? 1)}
          raidStartAllowed={!pendingBunkerActive}
          nextRaidAvailableAtMs={bunkerNextRaidAvailableAtMs}
        />
      )}
      {!fpBunkerActive && mineSceneReady && (
        <MineElevatorControls
          stage={elevatorStage}
          ride={elevatorAutoDir}
          row={miner.row}
          bottomRow={usableElevatorDepth}
          onRide={startElevatorRide}
        />
      )}
      {showFirstPaintVeil && <MineSceneBackdrop veil />}
      {(mineSceneStatus === "loading" || showFirstPaintVeil) && (
        <MineSceneNotice status="loading" />
      )}
      {mineSceneStatus === "error" && (
        <MineSceneNotice
          status="error"
          message={mineSceneMessage ?? undefined}
          onRetry={retryMineSceneLoad}
        />
      )}
      {batteryLow && !fpBunkerActive && (
        <div
          className="mine-battery-edge-warning"
          data-battery-edge-warning="true"
          aria-hidden="true"
        />
      )}
      {mineSceneReady && movementTouchEnabled && (
        <MineTouchControls
          onDirection={act}
          onReleaseDirection={releaseDirection}
          onZoomChange={adjustCameraZoom}
        />
      )}
      {mineSceneReady && movementTouchEnabled && tvMode && (
        <MineTvControls
          onDirectionPress={act}
          onDirectionRelease={releaseDirection}
          centerAction={tvCenterAction}
        />
      )}
      {!fpBunkerActive && <StratumBanner row={miner.row} />}
      <StampCollectAlert onOpenStampBook={openStampBookAt} />
      <JuiceOverlays />
      {pickaxeGateHint && (
        <div
          key={pickaxeGateHint.key}
          className="mine-pickaxe-gate-hint"
          role="status"
        >
          Pickaxe level {pickaxeGateHint.level} needed
        </div>
      )}
      {teleportBurstKey > 0 && (
        <div
          key={teleportBurstKey}
          className="mine-base-teleport-burst"
          aria-hidden="true"
          onAnimationEnd={() => setTeleportBurstKey(0)}
        >
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <ReleaseNotesPopup
        release={appRelease}
        manualOpenCount={releaseNotesOpenCount}
        onVisibleChange={setReleaseNotesVisible}
      />
      <IosHomeScreenPrompt disabled={releaseNotesVisible} />
      <FallingRockHazardAlert />
      <LadderGravityFeedbackPrompt
        appVersion={appRelease.version}
        onFeedbackNow={() =>
          openFeedback({
            source: "ladder-gravity",
            prompt: "ladder-fall-after-mining-support",
          })
        }
      />
      <FeedbackDialog
        open={feedbackOpen}
        context={feedbackContext}
        appVersion={appRelease.version}
        onClose={() => setFeedbackOpen(false)}
      />
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <StampBookPopup
        open={stampBookOpen}
        focusAchievementId={stampBookFocusId}
        onClose={() => {
          setStampBookOpen(false);
          setStampBookFocusId(null);
        }}
        onBeforeLoad={saveCurrentTrip}
      />
      <SaveSlotsPopup
        open={saveSlotsOpen}
        state={saveSlots}
        onClose={() => setSaveSlotsOpen(false)}
        onRefresh={loadSaveSlots}
        onLoad={switchSaveSlot}
        onDelete={deleteSaveSlot}
      />
      <AccountSyncPopup
        open={accountOpen}
        state={accountSync}
        onClose={closeAccountPopup}
        onRefresh={loadAccountStatus}
        onStartSignIn={startAccountSignInFromMine}
        onClaim={claimAccountSave}
        onLoadCloud={loadAccountSave}
      />
      <SaveConflictPopup
        open={saveConflict === "prompt"}
        onResolve={resolveSaveConflict}
      />
      <PerfTelemetry
        source={perfSurfaceSource}
        appVersion={appRelease.version}
        appBuild={appRelease.build}
        mineVersion={MINE_VERSION}
      />
      {/* Mine-shell chrome hides while first-person mode owns the
          screen (the fp HUD has its own exit and hotbar): settings
          gear and menu, zoom cluster, the consumable cluster below,
          and the scrap panel. Dialogs and popups stay. */}
      {!fpBunkerActive && (
        <>
          <button
            ref={settingsButtonRef}
            type="button"
            aria-label="Open settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
            style={{
              position: "absolute",
              top: 58,
              right: 14,
              zIndex: 7,
              width: 42,
              height: 42,
              borderRadius: 12,
              border: "1px solid #26304a",
              background: "rgba(17, 21, 31, 0.88)",
              color: "#e6e8ee",
              fontSize: "1.12rem",
              fontWeight: 800,
              pointerEvents: "auto",
              cursor: "pointer",
            }}
          >
            &#9881;
          </button>
          <section
            aria-label="Zoom controls"
            data-camera-zoom={cameraZoom.toFixed(2)}
            data-camera-zoom-max={maxCameraZoom.toFixed(2)}
            style={{
              position: "absolute",
              top: 108,
              right: 14,
              zIndex: 7,
              display: "grid",
              gridTemplateRows: "42px 42px",
              gap: 6,
              pointerEvents: "none",
            }}
          >
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={minCameraZoomReached}
              onClick={() => adjustCameraZoom(-MINE_CAMERA_BUTTON_STEP)}
              style={{
                ...zoomButtonStyle,
                opacity: minCameraZoomReached ? 0.42 : 1,
                cursor: minCameraZoomReached ? "default" : "pointer",
              }}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={maxCameraZoomReached}
              onClick={() => adjustCameraZoom(MINE_CAMERA_BUTTON_STEP)}
              style={{
                ...zoomButtonStyle,
                opacity: maxCameraZoomReached ? 0.42 : 1,
                cursor: maxCameraZoomReached ? "default" : "pointer",
              }}
            >
              -
            </button>
          </section>
          {settingsOpen && (
            <section
              ref={settingsMenuRef}
              aria-label="Settings"
              style={{
                position: "absolute",
                top: SETTINGS_MENU_TOP,
                right: SETTINGS_MENU_EDGE_GAP,
                zIndex: 7,
                width: 238,
                // The shell clips at its bottom edge (overflow hidden), so
                // on short viewports the menu scrolls instead of losing
                // its lower buttons past the edge.
                maxHeight: `calc(100% - ${SETTINGS_MENU_TOP + SETTINGS_MENU_EDGE_GAP}px)`,
                overflowY: "auto",
                border: "1px solid #26304a",
                borderRadius: 12,
                background: "rgba(17, 21, 31, 0.96)",
                boxShadow: "0 12px 34px rgba(0, 0, 0, 0.42)",
                padding: 10,
                color: "#e6e8ee",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setStampBookFocusId(null);
                  setStampBookOpen(true);
                }}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid #f5c542",
                  background: "#2d2616",
                  color: "#f5c542",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  marginBottom: 8,
                }}
              >
                Stamp Book
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setSaveSlotsOpen(true);
                }}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid #cdd6ea",
                  background: "#20283a",
                  color: "#e6e8ee",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  marginBottom: 8,
                }}
              >
                Load game
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setAccountOpen(true);
                }}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid #9fb6ff",
                  background: "#1c2440",
                  color: "#c7d4ff",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  marginBottom: 8,
                }}
              >
                Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setReleaseNotesOpenCount((count) => count + 1);
                }}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid #54e0c7",
                  background: "#172b30",
                  color: "#54e0c7",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Release notes
              </button>
              <button
                type="button"
                data-testid="replay-bunker-tutorial"
                onClick={() => {
                  clearFpTutorialDone();
                  setTutorialReplayArmed(true);
                }}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid #cdd6ea",
                  background: "#20283a",
                  color: "#e6e8ee",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  marginTop: 8,
                }}
              >
                Replay bunker tutorial
              </button>
              {tutorialReplayArmed && (
                <div
                  role="status"
                  style={{
                    marginTop: 6,
                    fontSize: "0.76rem",
                    color: "#9aa3b2",
                    textAlign: "center",
                  }}
                >
                  Shows the next time you enter your bunker.
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  openFeedback({ source: "pause" });
                }}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid #f0c36b",
                  background: "#2d2616",
                  color: "#f0c36b",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  marginTop: 8,
                }}
              >
                Feedback
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  setCreditsOpen(true);
                }}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid #9fb6ff",
                  background: "#1c2440",
                  color: "#c7d4ff",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  marginTop: 8,
                }}
              >
                Credits
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  router.push("/holodeck");
                }}
                style={{
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid #54e0c7",
                  background: "#172b30",
                  color: "#54e0c7",
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  marginTop: 8,
                }}
              >
                Holodeck
              </button>
              <ReleaseNotificationControl />
              <PerfTelemetryControl />
            </section>
          )}
        </>
      )}
      {!fpBunkerActive && baseReturn && (
        <>
          <button
            ref={baseReturnButtonRef}
            type="button"
            className={`mine-base-indicator mine-base-indicator-${baseReturn.direction}`}
            aria-label={`Base is ${baseReturn.direction}`}
            aria-expanded={baseReturnOpen}
            data-base-direction={baseReturn.direction}
            onClick={() => {
              setBaseReturnOpen((open) => !open);
              setBaseReturnConfirm(false);
            }}
          >
            <span aria-hidden="true">
              {baseReturn.direction === "left" ? "\u2190" : "\u2192"}
            </span>
            <span aria-hidden="true">⌂</span>
          </button>
          {baseReturnOpen && (
            <section
              ref={baseReturnMenuRef}
              aria-label="Base return"
              className={`mine-base-return-menu mine-base-return-menu-${baseReturn.direction}`}
            >
              <div style={{ fontWeight: 800, color: "#e6e8ee" }}>
                Base is {baseReturn.distance} cells {baseReturn.direction}
              </div>
              <div style={{ fontSize: "0.82rem", color: "#aab2c7" }}>
                Return to the shaft center on the surface.
              </div>
              <button
                type="button"
                disabled={baseReturnDisabled}
                onClick={() => void handleBaseReturn()}
                style={{
                  width: "100%",
                  minHeight: 44,
                  marginTop: 10,
                  borderRadius: 10,
                  ...baseReturnButtonColors,
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: baseReturnDisabled ? "not-allowed" : "pointer",
                }}
              >
                {baseReturnPending ? "Teleporting..." : baseReturnButtonLabel}
              </button>
            </section>
          )}
        </>
      )}
      {elevatorPlacementVisible && (
        <section
          ref={elevatorPlacementRef}
          tabIndex={-1}
          aria-label="Place elevator shaft"
          aria-live="polite"
          data-testid="elevator-placement"
          style={{
            ...surfaceActionPromptAnchorStyle,
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
            minWidth: "min(360px, calc(100vw - 24px))",
            padding: 10,
            borderRadius: 14,
            border: "2px solid #9aa7ff",
            background: "rgba(17, 21, 31, 0.95)",
            color: "#e6e8ee",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
          }}
        >
          <span style={{ gridColumn: "1 / -1", fontWeight: 800 }}>
            {elevatorPlacementIsFree
              ? `Move your ${gear.elevator}-row shaft to column ${miner.col}. Your old shaft stays open.`
              : `Shaft column ${miner.col}. Walk to any surface spot, then build.`}
          </span>
          {elevatorPlacementError && (
            <span
              role="status"
              style={{ gridColumn: "1 / -1", color: "#ff9b9b" }}
            >
              {elevatorPlacementError}
            </span>
          )}
          <button
            type="button"
            onClick={() => void placeElevatorAtCurrentColumn()}
            disabled={
              elevatorPurchasePending ||
              cashOut.state === "pending" ||
              (!elevatorPlacementIsFree &&
                (elevatorPurchaseFunds === null ||
                  elevatorPurchaseFunds < elevatorRailPrice(0)))
            }
            style={{
              ...sheetButtonStyle(
                !elevatorPurchasePending &&
                  cashOut.state !== "pending" &&
                  (elevatorPlacementIsFree ||
                    (elevatorPurchaseFunds !== null &&
                      elevatorPurchaseFunds >= elevatorRailPrice(0))),
              ),
              minHeight: 42,
            }}
          >
            {elevatorPurchasePending
              ? elevatorPlacementIsFree
                ? "Moving..."
                : "Building..."
              : elevatorPlacementIsFree
                ? "Move here: Free"
                : `${miner.bankedCredits > 0 ? "Bank + " : ""}Build here: ${elevatorRailPrice(0)} vibes`}
          </button>
          <button
            type="button"
            onClick={() => setElevatorPlacementMode(false)}
            disabled={elevatorPurchasePending}
            style={{
              ...sheetButtonStyle(!elevatorPurchasePending),
              minHeight: 42,
              minWidth: 76,
            }}
          >
            Cancel
          </button>
        </section>
      )}
      {/* Standing on a stall shows a prompt; the menu opens on tap, not
          on walk-by. Tapping again after close needs another tap. */}
      {!elevatorPlacementMode && stall && openStallCol !== miner.col && (
        <button
          type="button"
          aria-label={`Open ${stall.name}`}
          onClick={() => setOpenStallCol(miner.col)}
          style={{
            ...surfaceActionPromptAnchorStyle,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 999,
            border: `2px solid ${stall.color}`,
            background: "rgba(17, 21, 31, 0.92)",
            color: "#e6e8ee",
            fontWeight: 700,
            fontSize: "0.95rem",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>{STALL_ICONS[stall.id]}</span>
          <span style={{ color: stall.color }}>{stall.name}</span>
          <span style={{ opacity: 0.6, fontSize: "0.82rem" }}>Tap to open</span>
        </button>
      )}
      {/* Destination buildings route to another screen on tap. */}
      {!elevatorPlacementMode && destination && (
        <button
          type="button"
          aria-label={`Enter ${destination.name}`}
          onClick={() => router.push(destination.href)}
          style={{
            ...surfaceActionPromptAnchorStyle,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 999,
            border: `2px solid ${destination.color}`,
            background: "rgba(17, 21, 31, 0.92)",
            color: "#e6e8ee",
            fontWeight: 700,
            fontSize: "0.95rem",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>{destination.icon}</span>
          <span style={{ color: destination.color }}>{destination.name}</span>
          <span style={{ opacity: 0.6, fontSize: "0.82rem" }}>
            Tap to enter
          </span>
        </button>
      )}
      {!elevatorPlacementMode && portalHere && !activePortalHere && (
        <button
          type="button"
          aria-label={`Activate ${portalHere.name}`}
          onClick={() => move(activatePortalAction(portalHere.id))}
          style={{
            ...surfaceActionPromptAnchorStyle,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 999,
            border: `2px solid ${portalHere.color}`,
            background: "rgba(17, 21, 31, 0.92)",
            color: "#e6e8ee",
            fontWeight: 700,
            fontSize: "0.95rem",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>&#128225;</span>
          <span style={{ color: portalHere.color }}>{portalHere.name}</span>
          <span style={{ opacity: 0.6, fontSize: "0.82rem" }}>
            Tap to activate
          </span>
        </button>
      )}
      {!elevatorPlacementMode && activePortalHere && (
        <section
          aria-label={`${activePortalHere.name} portal`}
          style={{
            ...surfaceActionPromptAnchorStyle,
            display: "grid",
            gridAutoFlow: "column",
            gap: 8,
            alignItems: "center",
            padding: "8px",
            borderRadius: 999,
            border: `2px solid ${activePortalHere.color}`,
            background: "rgba(17, 21, 31, 0.94)",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
          }}
        >
          <button
            type="button"
            onClick={() => move(portalWarpAction("base"))}
            style={{
              ...sheetButtonStyle(true),
              minHeight: 36,
              borderRadius: 999,
            }}
          >
            Base
          </button>
          {otherActivePortals.map((portal) => (
            <button
              key={portal.id}
              type="button"
              onClick={() => move(portalWarpAction(portal.id))}
              style={{
                ...sheetButtonStyle(true),
                minHeight: 36,
                borderRadius: 999,
                borderColor: portal.color,
              }}
            >
              {portal.name}
            </button>
          ))}
        </section>
      )}
      <BunkerControlPanel
        minerRow={miner.row}
        claimMode={bunkerClaimMode}
        panelOpen={bunkerPanelOpen}
        bunker={activeBunker}
        pendingClaim={pendingBunkerActive}
        preview={bunkerPreview}
        localBlockedCells={localBlockedBunkerCells}
        onStartClaim={() => {
          setBunkerPanelOpen(true);
          setBunkerClaimMode(true);
        }}
        onCancelClaim={() => setBunkerClaimMode(false)}
        onOpenPanel={() => setBunkerPanelOpen(true)}
        onDismissPanel={() => setBunkerPanelOpen(false)}
        onClaim={() => {
          if (claimPendingBunker(miner.col, miner.row)) {
            setBunkerClaimMode(false);
            setBunkerPanelOpen(true);
          }
        }}
        onRepair={() => void repairBunker()}
        onReset={() => {
          // A confirmed reset invalidates the geometry under the live
          // first-person canvas, so it exits the view first (F-119
          // monitoring note); repair and skins are paint/durability
          // only and run over the live canvas.
          if (fpBunkerActive) exitFpBunker();
          // The same pending/banked branch as every other bunker
          // edit: a mid-trip claim resets locally, a banked bunker
          // resets through the server route.
          if (pendingBunkerActive) {
            resetPendingBunker();
          } else {
            void resetBankedBunker();
          }
        }}
        // Only a banked bunker is ever layout-incompatible (F-117): a
        // pending claim is born current, so Start fresh always runs the
        // server hard-reset route.
        onStartFresh={() => void startFreshBankedBunker()}
        onSelectSkin={(skinId) => void setBunkerSkin(skinId)}
        entryButtonVisible={fpEnterTriggerVisible || fpBunkerActive}
      />
      {/* THE build entry point: a single floating button enters the
          first-person builder while the miner stands inside an editable
          claim. It takes the collapsed status trigger's slot (the
          trigger hides via entryButtonVisible), so exactly one bunker
          pill is on screen at a time; while the status sheet is open
          (e.g. right after the fp Bunker doorway) it yields entirely. */}
      {!fpBunkerActive && !bunkerPanelOpen && fpEnterTriggerVisible && (
        <button
          type="button"
          className="bunker-fp-enter-trigger"
          data-testid="bunker-fp-enter"
          aria-label="Enter bunker"
          onClick={enterFpBunker}
        >
          Enter bunker
        </button>
      )}
      {!elevatorPlacementMode && stall && openStallCol === miner.col && (
        <StallMenu
          stall={stall}
          mine={mine}
          gear={gear}
          balance={balance}
          playerLevel={bunkerPlayer?.overallLevel ?? playerLevel}
          deepestDepth={deepestDepth}
          beaconLimit={bunkerPlayer?.beaconLimit ?? MAX_BEACONS}
          shopNote={shopNote}
          cashOutPending={cashOut.state === "pending"}
          elevatorPurchasePending={elevatorPurchasePending}
          elevatorPlacementRequired={elevatorPlacementRequired}
          railResyncFailed={railResyncFailed}
          railRetryPending={railRetryPending}
          onRetryRailResync={() => void retryRailResyncNow()}
          onBuyConsumable={(item, quantity) =>
            void buyConsumable(item, quantity)
          }
          onBuyBasePart={(partId, quantity) =>
            void purchaseHardwarePart(partId, quantity)
          }
          onBuyGear={(track) => void buyGearUpgrade(track)}
          onBuyElevator={() => void purchaseNextElevatorRail()}
          onChooseElevatorShaft={chooseElevatorShaft}
          onRide={startElevatorRide}
          onClose={() => setOpenStallCol(null)}
          sheetRef={stallSheetRef}
        />
      )}

      {/* Chip HUD (REQ-024): thin, glanceable, game-first. Data
          attributes are the stable test surface; copy can change. */}
      <section
        aria-label="Mine status"
        data-col={miner.col}
        data-depth={miner.row}
        data-elevator-col={ownedElevatorColumn ?? ""}
        data-elevator-depth={mine.gear.elevator}
        data-elevator-placement={elevatorPlacementMode ? "true" : "false"}
        data-elevator-phase={mine.elevatorPhase}
        data-elevator-stage={elevatorStage}
        data-elevator-riding={elevatorAutoDir ?? ""}
        data-scene-ready={mineSceneReady ? "true" : "false"}
        data-scene-painted={mineCanvasPainted ? "true" : "false"}
        data-fp-mode={fpBunkerActive ? "1" : "0"}
        data-horizontal-distance={horizontalDistance}
        data-energy={miner.energy.toFixed(1)}
        data-ladders={mine.consumables.ladder}
        data-planks={mine.consumables.plank}
        data-banked={miner.bankedCredits}
        data-wallet={balance ?? ""}
        data-climb-ladders={laddersNeeded}
        data-return-route={returnRouteState}
        data-return-steps={returnEstimate.steps}
        data-return-capped={returnEstimate.capped ? "true" : "false"}
        data-battery-low={batteryLow ? "true" : "false"}
        data-ladder-short={ladderShort ? "true" : "false"}
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          right: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 6,
          pointerEvents: "none",
          zIndex: 5,
          // The element stays mounted while first-person mode is on
          // (it carries data-scene-ready/painted and data-fp-mode), but
          // its 2D chips hide under the fp view.
          visibility: fpBunkerActive ? "hidden" : "visible",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            maxWidth: "calc(100% - 250px)",
          }}
        >
          <span style={{ ...chipStyle, color: "#f5c542", fontWeight: 700 }}>
            &#129689; {balance === null ? "offline" : `${balance} vibes`}
          </span>
          <span style={chipStyle}>
            <span style={{ opacity: 0.65 }}>&#9660;</span> Depth {miner.row}{" "}
            <span style={{ opacity: 0.65 }}>{stratum.name}</span>
            <span style={{ opacity: 0.65 }}> | Base </span>
            {horizontalDistanceLabel}
          </span>
          <span
            className={batteryLow ? "mine-hud-chip-danger" : undefined}
            data-battery-chip="true"
            style={{
              ...chipStyle,
              position: "relative",
              overflow: "hidden",
              minWidth: 118,
              color: batteryLow ? "#ffe7e7" : "#e6e8ee",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                width: `${Math.max(0, Math.min(100, (miner.energy / maxEnergy(mine.gear)) * 100))}%`,
                background: batteryLow ? "#ff2f2f" : "#54e0c7",
                opacity: batteryLow ? 0.62 : 0.3,
              }}
            />
            <span style={{ position: "relative" }}>
              &#128267; {miner.energy.toFixed(1)}/{maxEnergy(mine.gear)}
              {batteryLow ? (
                <strong className="mine-chip-alert"> Low</strong>
              ) : null}
            </span>
          </span>
          <button
            type="button"
            aria-label="Open bag"
            aria-controls="mine-bag-panel"
            aria-expanded={bagPanelOpen}
            data-bag-full-flash={bagFullFlash ? "true" : "false"}
            title={`Open bag. ${carriedOreCount} ore chunks in ${carriedOreStackCount}/${bagCapacity} stack slots.`}
            onClick={() => setBagPanelOpen(true)}
            style={{
              ...chipStyle,
              color: "#f5c542",
              pointerEvents: "auto",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            &#127890; {carriedOreCount} ore ({carriedOreStackCount}/
            {bagCapacity})
          </button>
        </div>
        {statusLine && (
          <span
            data-mine-status-tip="true"
            style={{ ...statusChipStyle, color: "#f5c542" }}
          >
            {statusLine}
          </span>
        )}
        {showSurfaceInfoLine && (
          <span style={{ ...statusChipStyle, color: surfaceInfoColor }}>
            {surfaceInfoLine}
          </span>
        )}
        {lostCargo && (
          <span
            className="mine-lost-locator"
            title={`Dropped cargo locator, ${lostDistance} cells away`}
            style={{
              ...chipStyle,
              color: lostDistance <= 1 ? "#f5c542" : "#ff9f6b",
              borderColor:
                lostDistance <= 1
                  ? "rgba(245, 197, 66, 0.75)"
                  : "rgba(255, 159, 107, 0.55)",
              animationDuration: `${lostPulseSeconds}s`,
            }}
          >
            &#128229;{" "}
            {lostDistance === 0
              ? "Dropped cargo here"
              : `Dropped cargo ${lostDistance} cells away`}
          </span>
        )}
      </section>

      <MineBagPanel
        open={bagPanelOpen}
        capacity={bagCapacity}
        filledStackCount={carriedOreStackCount}
        oreCount={carriedOreCount}
        stackLimit={BAG_STACK_LIMIT}
        scrapCredits={miner.carriedSalvageCredits}
        partsCount={miner.carriedParts.length}
        details={bagDetails}
        cells={bagCells}
        emptyCellKeys={emptyBagCellKeys}
        selectedKeys={selectedBagCells}
        canDropSelected={canDropSelectedBagCells}
        selectedCount={selectedBagCount}
        onClose={() => setBagPanelOpen(false)}
        onDropSelected={dropSelectedBagCells}
        onClearSelection={clearBagSelection}
        onToggleCell={toggleBagCell}
      />

      {collectMode && !fpBunkerActive && (
        <section
          aria-label="Scrap mode"
          style={{
            position: "absolute",
            right: 12,
            bottom: 82,
            zIndex: 10,
            width: "min(300px, calc(100vw - 24px))",
            border: "1px solid #26304a",
            borderRadius: 12,
            background: "rgba(17, 21, 31, 0.96)",
            boxShadow: "0 12px 34px rgba(0, 0, 0, 0.42)",
            padding: 10,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                ...compactChipStyle,
                flex: "1 1 132px",
                color: "#8b93a7",
              }}
            >
              {visibleSupports.length === 0
                ? "nothing to scrap"
                : "tap supports to scrap"}
            </span>
            <span
              style={{
                ...compactChipStyle,
                flex: "1 1 166px",
                color: "#54e0c7",
              }}
            >
              {`${selectedSupports.length} selected, scrap value: ${selectedSupportValue}`}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              aria-label="Confirm scrap"
              disabled={selectedSupports.length === 0}
              onClick={() => {
                move(collectAction(selectedSupports));
                setCollectSelection([]);
                setCollectMode(false);
              }}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: 10,
                border: "1px solid #54e0c7",
                background:
                  selectedSupports.length > 0
                    ? "#172b30"
                    : "rgba(23, 43, 48, 0.35)",
                color: selectedSupports.length > 0 ? "#54e0c7" : "#8b93a7",
                fontWeight: 800,
                cursor: selectedSupports.length > 0 ? "pointer" : "default",
              }}
            >
              Scrap
            </button>
            <button
              type="button"
              aria-label="Cancel scrap"
              onClick={() => {
                setCollectSelection([]);
                setCollectMode(false);
              }}
              style={{
                minWidth: 78,
                minHeight: 40,
                borderRadius: 10,
                border: "1px solid #2c3a5c",
                background: "rgba(38, 48, 74, 0.55)",
                color: "#cdd6ea",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {jumpButtonVisible && (
        <button
          type="button"
          aria-label="Jump jets"
          title="Jump up one cell"
          onClick={() => {
            setDynamiteMenuOpen(false);
            setRecoveryMenuOpen(false);
            fireJump();
          }}
          disabled={!jumpEnabled}
          style={{
            ...jumpButtonStyle,
            position: "absolute",
            right: 14,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 6,
            opacity: jumpEnabled ? 1 : 0.46,
            cursor: jumpEnabled ? "pointer" : "default",
          }}
        >
          Jump
        </button>
      )}

      {/* Consumable cluster: thumb-reach icon buttons. Movement is the
          thumbstick (or WASD/arrows); the D-pad is gone. Hidden while
          the first-person view owns the screen (its HUD replaces it). */}
      {!fpBunkerActive && (
        <section
          aria-label="Dig controls"
          style={{
            position: "absolute",
            right: 12,
            bottom: 18,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            maxWidth: "calc(100vw - 24px)",
            zIndex: 9,
            pointerEvents: "none",
          }}
        >
          <span
            className={
              ladderShort || returnRouteBlocked
                ? "mine-hud-chip-danger"
                : undefined
            }
            data-ladder-chip="true"
            style={{
              ...chipStyle,
              color: ladderShort || returnRouteBlocked ? "#ffe7e7" : "#8b93a7",
            }}
          >
            {ladderShort || returnRouteBlocked ? "!" : ""} &#129692;{" "}
            {mine.consumables.ladder}
            {returnRouteBlocked
              ? " route blocked"
              : ladderShort
                ? `/${laddersNeeded} needed`
                : ""}
          </span>
          <span style={{ ...chipStyle, color: "#8b93a7" }}>
            &#129717; {mine.consumables.plank}
          </span>
          <button
            type="button"
            aria-label="Place plank left"
            onClick={() => {
              setDynamiteMenuOpen(false);
              setRecoveryMenuOpen(false);
              move("plank-left");
            }}
            disabled={!leftPlankEnabled}
            style={{
              ...iconButtonStyle,
              opacity: leftPlankEnabled ? 1 : 0.42,
              cursor: leftPlankEnabled ? "pointer" : "default",
            }}
          >
            &#129717; {"\u25C0"}
          </button>
          <button
            type="button"
            aria-label="Place plank right"
            onClick={() => {
              setDynamiteMenuOpen(false);
              setRecoveryMenuOpen(false);
              move("plank-right");
            }}
            disabled={!rightPlankEnabled}
            style={{
              ...iconButtonStyle,
              opacity: rightPlankEnabled ? 1 : 0.42,
              cursor: rightPlankEnabled ? "pointer" : "default",
            }}
          >
            &#129717; {"\u25B6"}
          </button>
          <button
            type="button"
            aria-label="Scrap placed supports"
            aria-pressed={collectMode}
            onClick={() => {
              if (elevatorInteractionActive) return;
              setDynamiteMenuOpen(false);
              setRecoveryMenuOpen(false);
              setCollectMode((open) => {
                const next = !open;
                if (next) {
                  setBunkerClaimMode(false);
                  setBunkerPanelOpen(false);
                }
                return next;
              });
            }}
            disabled={
              elevatorInteractionActive ||
              (!collectMode && visibleSupports.length === 0)
            }
            style={{
              ...iconButtonStyle,
              opacity: collectMode || visibleSupports.length > 0 ? 1 : 0.42,
              cursor:
                collectMode || visibleSupports.length > 0
                  ? "pointer"
                  : "default",
              ...(collectMode
                ? {
                    background: "#172b30",
                    borderColor: "#54e0c7",
                    color: "#54e0c7",
                  }
                : null),
            }}
          >
            &#8635;
          </button>
          <div
            ref={dynamiteMenuRef}
            style={{ position: "relative", pointerEvents: "auto" }}
          >
            <button
              type="button"
              aria-label={`Dynamite ${DYNAMITE_TIER_LABELS[selectedDynamiteTier]} (${mine.consumables.dynamite})`}
              onClick={() => {
                setRecoveryMenuOpen(false);
                setDynamiteMenuOpen((open) => !open);
              }}
              disabled={elevatorInteractionActive}
              aria-pressed={dynamiteMenuOpen}
              style={{
                ...iconButtonStyle,
                ...(dynamiteMenuOpen
                  ? {
                      background: "#3a2430",
                      borderColor: "#ffb347",
                      boxShadow: "0 0 12px rgba(255, 179, 71, 0.42)",
                    }
                  : null),
              }}
            >
              &#129512; {mine.consumables.dynamite} &#9662;
            </button>
            {dynamiteMenuOpen && (
              <div
                role="menu"
                aria-label="Dynamite tiers"
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 54,
                  width: 260,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #34415f",
                  background: "rgba(10, 13, 20, 0.96)",
                  color: "#e6e8ee",
                  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.38)",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 6,
                  }}
                >
                  {DYNAMITE_TIERS.map((tier) => {
                    const selected = tier === selectedDynamiteTier;
                    const locked = tier > unlockedDynamiteTier;
                    return (
                      <button
                        key={tier}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        onClick={() => setSelectedDynamiteTier(tier)}
                        style={{
                          border: selected
                            ? "1px solid #ffb347"
                            : "1px solid #2c3a5c",
                          background: selected
                            ? "rgba(255, 179, 71, 0.16)"
                            : "rgba(38, 48, 74, 0.55)",
                          color: locked ? "#8b93a7" : "#f5efe3",
                          borderRadius: 8,
                          padding: "8px 6px",
                          textAlign: "left",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        T{tier} {DYNAMITE_TIER_LABELS[tier]}
                        {locked ? " lock" : ""}
                      </button>
                    );
                  })}
                </div>
                <p
                  style={{
                    margin: "8px 0 10px",
                    fontSize: "0.72rem",
                    opacity: 0.78,
                  }}
                >
                  {DYNAMITE_TIER_BLURBS[selectedDynamiteTier]}
                </p>
                {dynamiteHelperText && (
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: "0.72rem",
                      color: "#ffcf7a",
                    }}
                  >
                    {dynamiteHelperText}
                  </p>
                )}
                <button
                  type="button"
                  aria-label={`Deploy tier ${selectedDynamiteTier} dynamite`}
                  disabled={!canConfirmDynamite}
                  onClick={() => {
                    if (!canConfirmDynamite) return;
                    setDynamiteMenuOpen(false);
                    move(`dynamite-${selectedDynamiteTier}` as MineAction);
                  }}
                  style={{
                    ...sheetButtonStyle(canConfirmDynamite),
                    width: "100%",
                    minHeight: 36,
                  }}
                >
                  &#10003; Deploy
                </button>
              </div>
            )}
          </div>
          <div
            ref={recoveryMenuRef}
            style={{ position: "relative", pointerEvents: "auto" }}
          >
            <button
              type="button"
              aria-label="Recovery options"
              onClick={() => {
                setDynamiteMenuOpen(false);
                if (recoveryMenuOpen) setAbandonArmed(false);
                setRecoveryMenuOpen(!recoveryMenuOpen);
              }}
              aria-pressed={recoveryMenuOpen}
              style={{
                ...iconButtonStyle,
                ...(recoveryMenuOpen
                  ? {
                      background: "#21314a",
                      borderColor: "#8fb8ff",
                      boxShadow: "0 0 12px rgba(143, 184, 255, 0.34)",
                    }
                  : null),
              }}
            >
              &#129526; {mine.consumables.rope} &#9662;
            </button>
            {recoveryMenuOpen && (
              <div
                role="menu"
                aria-label="Recovery actions"
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 54,
                  width: 244,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #34415f",
                  background: "rgba(10, 13, 20, 0.96)",
                  color: "#e6e8ee",
                  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.38)",
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`Recall (${mine.consumables.rope}, range ${currentRecallRange})`}
                  onClick={() => {
                    setRecoveryMenuOpen(false);
                    setAbandonArmed(false);
                    const result = move("recall");
                    const state = useMineStore.getState();
                    if (result?.ok) {
                      setElevatorAutoDir(null);
                      pendingElevatorEntryRef.current = null;
                      setElevatorPresentation((current) => ({
                        ...current,
                        stage: "idle",
                        carRow: state.mine.miner.row,
                        entryDirection: null,
                      }));
                    }
                  }}
                  disabled={
                    mine.consumables.rope <= 0 ||
                    miner.row === 0 ||
                    miner.row > currentRecallRange
                  }
                  style={{
                    ...sheetButtonStyle(
                      mine.consumables.rope > 0 &&
                        miner.row > 0 &&
                        miner.row <= currentRecallRange,
                    ),
                    width: "100%",
                    minHeight: 36,
                    marginBottom: 8,
                  }}
                >
                  &#129526; Recall ({mine.consumables.rope}) row{" "}
                  {currentRecallRange}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Abandon trip"
                  onClick={() => {
                    if (abandonArmed) {
                      setAbandonArmed(false);
                      setRecoveryMenuOpen(false);
                      const result = move("abandon");
                      const state = useMineStore.getState();
                      if (result?.ok) {
                        setElevatorAutoDir(null);
                        pendingElevatorEntryRef.current = null;
                        setElevatorPresentation((current) => ({
                          ...current,
                          stage: "idle",
                          carRow: state.mine.miner.row,
                          entryDirection: null,
                        }));
                      }
                    } else {
                      setAbandonArmed(true);
                    }
                  }}
                  disabled={miner.row === 0}
                  style={{
                    ...sheetButtonStyle(miner.row > 0),
                    width: "100%",
                    minHeight: 36,
                    ...(abandonArmed
                      ? {
                          background: "#7a2c2c",
                          borderColor: "#ff6b6b",
                          color: "#ffd9d9",
                        }
                      : null),
                  }}
                >
                  {abandonArmed ? "Sure?" : "Abandon"}
                </button>
              </div>
            )}
          </div>
          {miner.row >= 1 && mine.consumables.beacon > 0 && (
            <button
              type="button"
              aria-label="Plant warp beacon"
              aria-disabled={beaconButtonDisabled}
              onClick={() => {
                if (elevatorInteractionActive) return;
                setDynamiteMenuOpen(false);
                setRecoveryMenuOpen(false);
                move("place-beacon");
              }}
              disabled={elevatorInteractionActive}
              title={
                beaconDepthAllowed
                  ? "Plant warp beacon"
                  : `Warpcoil range ${beaconRange} rows`
              }
              style={{
                ...iconButtonStyle,
                opacity: beaconButtonDisabled ? 0.42 : 1,
                cursor: beaconButtonDisabled ? "default" : "pointer",
              }}
            >
              &#128225; {mine.consumables.beacon}
            </button>
          )}
          {(() => {
            const onBeacon = currentCell?.beacon;
            return (
              onBeacon &&
              miner.row <= warpRange(mine.gear) && (
                <button
                  type="button"
                  aria-label="Warp home"
                  onClick={() => {
                    if (!elevatorInteractionActive) {
                      setRecoveryMenuOpen(false);
                      move("warp-home");
                    }
                  }}
                  disabled={elevatorInteractionActive}
                  style={iconButtonStyle}
                >
                  &#127756;
                </button>
              )
            );
          })()}
        </section>
      )}

      {/* One-shot onboarding: gone after the first action. */}
      {tick === 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 88,
            left: "50%",
            transform: "translateX(-50%)",
            ...chipStyle,
            color: "#8b93a7",
            pointerEvents: "none",
          }}
        >
          {tvMode
            ? "channel up/down + rewind/fast-forward move \u00b7 pad fallback"
            : coarsePointer
              ? "drag anywhere to move"
              : "drag anywhere to move \u00b7 WASD works too"}
        </div>
      )}
    </div>
  );
}
