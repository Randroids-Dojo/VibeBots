"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Component,
  type ErrorInfo,
  type HTMLAttributes,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
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
import type { PlayerAchievementView } from "@/lib/achievements";
import type { AppRelease } from "@/lib/app-release-types";
import {
  FEEDBACK_CATEGORY_OPTIONS,
  type FeedbackCategory,
} from "@/lib/feedback";
import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BunkerFootprint,
  basePartMinimumLevel,
  basePartOwnedCount,
  basePartOwnedLimit,
  bunkerCells,
  containsBunkerCell,
  DEFENSE_XP_PER_LEVEL,
  proposedBunkerFootprint,
} from "@/sim/bunker";
import {
  activatePortalAction,
  activePortalAt,
  authoredPortalAt,
  BAG_STACK_LIMIT,
  BEACON_LABEL_MAX_LENGTH,
  CONSUMABLE_PRICES,
  type CollectTarget,
  canPlacePlank,
  cargoCapacity,
  carriedCount,
  carriedStackCount,
  cellAt,
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
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  elevatorSegmentPrice,
  elevatorSpeedRows,
  findBeacons,
  findPortalBeacons,
  GEAR_TRACKS,
  gearUpgradeRequirements,
  MAX_BEACONS,
  MINE_VERSION,
  type MineAction,
  type MineCoord,
  type MineGear,
  type MineGearTrack,
  type MineState,
  maxEnergy,
  maxGearLevel,
  NO_CONSUMABLES,
  normalizeBeaconLabel,
  type OreId,
  oreDef,
  portalWarpAction,
  recallRopeRange,
  renameBeaconAction,
  returnEnergyCost,
  returnLadderNeed,
  type SoldHaul,
  START_COL,
  stratumAt,
  supportSalvageValue,
  warpRange,
} from "@/sim/mine";
import { PART_CATALOG } from "@/sim/parts";
import { useBunkerStore } from "@/state/bunker-store";
import {
  type SaveSlotSummary,
  type SaveSlotsState,
  useMineStore,
} from "@/state/mine-store";
import { DESTINATIONS, destinationAt } from "./mine-destinations";
import {
  createDirectionCadenceController,
  type DirectionCadenceController,
} from "./mine-input-cadence";
import { actionRepeatMs } from "./mine-pacing";
import { useMinePerformanceSampling } from "./mine-performance-sampling";
import { mineShopNoteSfxEvent, playMineSfxEvent } from "./mine-sfx";
import { STALLS, type StallDef, stallAt } from "./mine-stalls";
import { MineTouchControls } from "./mine-touch-controls";

type MineSceneStatus = "loading" | "ready" | "error";
const MINE_SCENE_LOAD_ERROR =
  "The network dropped before the mine could load. Your save was not changed. Check the connection and retry.";

function MineSceneBackdrop() {
  return <div className="mine-scene-backdrop" aria-hidden="true" />;
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
  loading: () => (
    <>
      <MineSceneBackdrop />
      <MineSceneNotice status="loading" />
    </>
  ),
});

const RELEASE_LAST_PLAYED_KEY = "vibebots-last-played-app-version";
const RELEASE_LAST_PLAYED_BUILD_KEY = "vibebots-last-played-app-build";
const RELEASE_DISMISSED_KEY = "vibebots-release-notes-dismissed-id";
const RELEASE_PENDING_FROM_BUILD_KEY = "vibebots-release-notes-from-build";
const FALLING_ROCK_ALERT_DISMISSED_KEY =
  "vibebots-falling-rock-alert-dismissed";
const LADDER_GRAVITY_FEEDBACK_NEVER_KEY =
  "vibebots-ladder-gravity-feedback-never";
const IOS_HOME_SCREEN_PROMPT_NEVER_KEY =
  "vibebots-ios-home-screen-prompt-never";
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

function useDismissControls(active: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  const gamepadDismissPressedRef = useRef(false);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active) {
      gamepadDismissPressedRef.current = false;
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismissRef.current();
    };
    window.addEventListener("keydown", onKey);
    let frame = 0;
    const pollGamepadDismiss = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const dismissPressed = pads.some(
        (pad) =>
          Boolean(pad?.buttons[1]?.pressed) ||
          Boolean(pad?.buttons[8]?.pressed),
      );
      if (dismissPressed && !gamepadDismissPressedRef.current) {
        onDismissRef.current();
      }
      gamepadDismissPressedRef.current = dismissPressed;
      frame = requestAnimationFrame(pollGamepadDismiss);
    };
    frame = requestAnimationFrame(pollGamepadDismiss);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
    };
  }, [active]);
}

function useOutsidePointerDismiss(
  active: boolean,
  isInsideOpenSurface: (
    target: EventTarget | null,
    path: readonly EventTarget[],
  ) => boolean,
  onDismiss: () => void,
) {
  const isInsideOpenSurfaceRef = useRef(isInsideOpenSurface);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    isInsideOpenSurfaceRef.current = isInsideOpenSurface;
    onDismissRef.current = onDismiss;
  }, [isInsideOpenSurface, onDismiss]);

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (isInsideOpenSurfaceRef.current(event.target, path)) return;
      event.preventDefault();
      event.stopPropagation();
      onDismissRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [active]);
}

function eventInsideRef(
  ref: RefObject<HTMLElement | null>,
  target: EventTarget | null,
  path: readonly EventTarget[],
): boolean {
  const element = ref.current;
  if (!element) return false;
  if (path.includes(element)) return true;
  return target instanceof Node && element.contains(target);
}

function DismissibleDialogFrame({
  active = true,
  onDismiss,
  children,
  onPointerDown,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  useDismissControls(active, onDismiss);
  return (
    <div
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented) return;
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </div>
  );
}

const MINE_SURFACE_TIPS = [
  "Tip: rich ore may need several hits. Every swing still costs battery.",
  "Tip: press up into solid ground to dig overhead without using a ladder.",
  "Tip: falling rocks drop after two moves and need at least two hits to break.",
  "Tip: Lantern upgrades reveal more rows and let you zoom out farther.",
  "Tip: Buy ladders and planks at the Supply Depot before heading deeper.",
  "Tip: Dynamite collects the ore and parts it breaks if your hold has room.",
  "Tip: Upgrade Blast Charge to unlock larger dynamite blast shapes.",
  "Tip: Upgrade Recall Rope to bank from deeper rows.",
  "Tip: Planted beacons only work within your current Warpcoil range.",
  "Tip: Distant biome beacons become free portals back to base.",
  "Tip: Bunker defenses raise player level for later upgrades.",
  "Tip: Row 1,000 needs rail, Warpcoil, Recall Rope, cargo, and battery upgrades.",
  "Tip: Use the Stamp Book for depth, tool, haul, and portal goals.",
] as const;
const MINE_SURFACE_TIP_EMPTY_SLOTS = 3;
const MINE_SURFACE_TIP_ROTATION_MS = 15_000;
const MINE_SURFACE_TIP_CHOICES: readonly (string | null)[] = [
  ...MINE_SURFACE_TIPS,
  ...Array.from({ length: MINE_SURFACE_TIP_EMPTY_SLOTS }, () => null),
];
const BUNKER_PART_DOUBLE_TAP_MS = 450;
const PICKAXE_GATE_HINT_MS = 1800;

interface MineSurfaceTipTestWindow {
  __vibebotsSurfaceTipSequence?: (string | null)[];
  __vibebotsSurfaceTipRotationMs?: number;
}

interface NotificationConfig {
  configured: boolean;
  vapidPublicKey: string | null;
  releaseNoticeId: string;
  releaseSummary: string;
}

type NotificationUiState =
  | "checking"
  | "unsupported"
  | "ios-install"
  | "unconfigured"
  | "default"
  | "enabled"
  | "denied"
  | "saving"
  | "error";

type FeedbackSource = "pause" | "ladder-gravity";

interface FeedbackContext {
  source: FeedbackSource;
  prompt?: string;
}

function isIosDevice(): boolean {
  const platform = navigator.platform;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneWebApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

function isMobileSafari(): boolean {
  const userAgent = navigator.userAgent;
  return (
    isIosDevice() &&
    /Safari/.test(userAgent) &&
    !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(userAgent)
  );
}

function notificationPlatform(): string {
  if (isIosDevice()) return "ios";
  if (/Android/.test(navigator.userAgent)) return "android";
  return "desktop";
}

function pushApiSupported(): boolean {
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function loadNotificationConfig(): Promise<NotificationConfig> {
  const res = await fetch("/api/notifications/config", { cache: "no-store" });
  if (!res.ok) throw new Error("notification config unavailable");
  return res.json() as Promise<NotificationConfig>;
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
};

function collectTargetKey(target: CollectTarget): string {
  return `${target.type}:${target.col},${target.row}`;
}

/** Banner shown for a few seconds when the miner enters a new stratum. */
function StratumBanner({ row }: { row: number }) {
  const [banner, setBanner] = useState<string | null>(null);
  const deepestSeen = useRef(0);
  const stratum = stratumAt(row);

  useEffect(() => {
    if (row <= deepestSeen.current) return;
    const wasStratum = stratumAt(deepestSeen.current);
    deepestSeen.current = row;
    if (stratum.name === wasStratum.name) return;
    setBanner(`Entering ${stratum.name}`);
    const timer = setTimeout(() => setBanner(null), 2600);
    return () => clearTimeout(timer);
  }, [row, stratum.name]);

  if (!banner) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 90,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(17, 21, 31, 0.92)",
        border: "1px solid #54e0c7",
        color: "#54e0c7",
        borderRadius: 10,
        padding: "10px 22px",
        fontSize: "1.1rem",
        fontWeight: 600,
        pointerEvents: "none",
      }}
    >
      {banner}
    </div>
  );
}

function storedBuild(key: string): number | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function releaseHistoryContent(release: AppRelease): {
  intro: string | null;
  items: string[];
  sections: Array<{
    version: string;
    date: string;
    title: string;
    intro: string | null;
    items: string[];
  }>;
} {
  const notes = release.notes.length > 0 ? release.notes : [];
  return {
    intro: "Newest first. All shipped notes are kept here.",
    items: [],
    sections: notes.map((note) => ({
      version: note.version,
      date: note.date,
      title: note.title,
      intro: note.intro ?? null,
      items:
        note.changes.length > 0
          ? note.changes.map((change) => change.text)
          : ["Fresh build deployed."],
    })),
  };
}

function ReleaseNotesPopup({
  release,
  manualOpenCount,
  onVisibleChange,
}: {
  release: AppRelease;
  manualOpenCount: number;
  onVisibleChange?: (visible: boolean) => void;
}) {
  const [content, setContent] = useState<{
    intro: string | null;
    items: string[];
    sections: Array<{
      version: string;
      date: string;
      title: string;
      intro: string | null;
      items: string[];
    }>;
  }>({ intro: null, items: [], sections: [] });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [onVisibleChange, visible]);

  useEffect(() => {
    if (manualOpenCount <= 0) return;
    setContent(releaseHistoryContent(release));
    setVisible(true);
  }, [manualOpenCount, release]);

  useEffect(() => {
    const lastPlayed = localStorage.getItem(RELEASE_LAST_PLAYED_KEY);
    const dismissed = localStorage.getItem(RELEASE_DISMISSED_KEY);
    const lastPlayedBuild = storedBuild(RELEASE_LAST_PLAYED_BUILD_KEY);
    let fromBuild = storedBuild(RELEASE_PENDING_FROM_BUILD_KEY);

    if (lastPlayed && lastPlayed !== release.version) {
      fromBuild = lastPlayedBuild;
      if (fromBuild !== null) {
        localStorage.setItem(RELEASE_PENDING_FROM_BUILD_KEY, String(fromBuild));
      } else {
        localStorage.removeItem(RELEASE_PENDING_FROM_BUILD_KEY);
      }
    }

    if (lastPlayed !== release.version) {
      localStorage.setItem(RELEASE_LAST_PLAYED_KEY, release.version);
      if (release.build !== null) {
        localStorage.setItem(
          RELEASE_LAST_PLAYED_BUILD_KEY,
          String(release.build),
        );
      } else {
        localStorage.removeItem(RELEASE_LAST_PLAYED_BUILD_KEY);
      }
    }

    if (dismissed === release.noticeId) return;
    if (!lastPlayed && !release.showToAll) return;

    const unseen = release.showToAll
      ? release.changes.map((change) => change.text)
      : release.changes
          .filter(
            (change) =>
              fromBuild === null ||
              change.build === null ||
              change.build > fromBuild,
          )
          .slice(0, 4)
          .map((change) => change.text);
    setContent({
      intro: release.intro ?? null,
      items: unseen.length > 0 ? unseen : ["Fresh build deployed."],
      sections: [],
    });
    setVisible(true);
  }, [release]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(RELEASE_DISMISSED_KEY, release.noticeId);
    localStorage.removeItem(RELEASE_PENDING_FROM_BUILD_KEY);
    setVisible(false);
  };

  return (
    <DismissibleDialogFrame
      onDismiss={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-notes-title"
      data-app-version={release.version}
      data-release-note-id={release.noticeId}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.58)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 360px)",
          border: "1px solid #54e0c7",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.97)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.52)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <h2
            id="release-notes-title"
            style={{
              margin: 0,
              flex: 1,
              color: "#54e0c7",
              fontSize: "1.02rem",
              lineHeight: 1.2,
            }}
          >
            New in VibeBots
          </h2>
          <span
            style={{
              color: "#8b93a7",
              fontSize: "0.72rem",
              fontWeight: 700,
            }}
          >
            v{release.version}
          </span>
        </header>
        {content.intro && (
          <p
            style={{
              margin: "0 0 12px",
              color: "#dce5f7",
              fontSize: "0.9rem",
              lineHeight: 1.35,
            }}
          >
            {content.intro}
          </p>
        )}
        {content.sections.length > 0 ? (
          <section
            aria-label="Release notes"
            style={{
              display: "grid",
              gap: 12,
              maxHeight: "min(54vh, 420px)",
              overflowY: "auto",
              marginBottom: 14,
            }}
          >
            {content.sections.map((section) => (
              <article
                key={section.version}
                data-release-note={section.version}
              >
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "baseline",
                    marginBottom: 6,
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      color: "#e6e8ee",
                      fontSize: "0.9rem",
                      lineHeight: 1.2,
                    }}
                  >
                    {section.version}: {section.title}
                  </h3>
                  <time
                    style={{
                      color: "#8b93a7",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                    }}
                  >
                    {section.date}
                  </time>
                </header>
                {section.intro && (
                  <p
                    style={{
                      margin: "0 0 6px",
                      color: "#dce5f7",
                      fontSize: "0.78rem",
                      lineHeight: 1.3,
                    }}
                  >
                    {section.intro}
                  </p>
                )}
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: "#cdd6ea",
                    fontSize: "0.78rem",
                    lineHeight: 1.32,
                  }}
                >
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        ) : (
          <ul
            style={{
              margin: "0 0 14px",
              paddingLeft: 18,
              color: "#cdd6ea",
              fontSize: "0.88rem",
              lineHeight: 1.35,
            }}
          >
            {content.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={dismiss}
          style={{
            width: "100%",
            minHeight: 42,
            borderRadius: 10,
            border: "1px solid #54e0c7",
            background: "#172b30",
            color: "#54e0c7",
            fontWeight: 800,
            fontSize: "0.9rem",
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </section>
    </DismissibleDialogFrame>
  );
}

function FallingRockHazardAlert() {
  const lastResult = useMineStore((s) => s.lastResult);
  const [visible, setVisible] = useState(false);
  const [suppressedForSession, setSuppressedForSession] = useState(false);

  useEffect(() => {
    if (!lastResult?.ok || !lastResult.fallingRockTriggered) return;
    if (suppressedForSession) return;
    try {
      if (localStorage.getItem(FALLING_ROCK_ALERT_DISMISSED_KEY) === "true") {
        return;
      }
    } catch {
      // Storage blocked: keep showing until this session suppresses it.
    }
    setVisible(true);
  }, [lastResult, suppressedForSession]);

  if (!visible) return null;

  const dismiss = () => setVisible(false);
  const neverShowAgain = () => {
    try {
      localStorage.setItem(FALLING_ROCK_ALERT_DISMISSED_KEY, "true");
    } catch {
      setSuppressedForSession(true);
    }
    setVisible(false);
  };

  return (
    <DismissibleDialogFrame
      onDismiss={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="falling-rock-alert-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.6)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 360px)",
          border: "1px solid #f5c542",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.97)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.52)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <h2
          id="falling-rock-alert-title"
          style={{
            margin: 0,
            color: "#f5c542",
            fontSize: "1.02rem",
            lineHeight: 1.2,
          }}
        >
          Falling rock
        </h2>
        <p
          style={{
            margin: "10px 0 14px",
            color: "#dce5f7",
            fontSize: "0.92rem",
            lineHeight: 1.4,
          }}
        >
          The miner must avoid being under the rock in the next 2 turns.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={dismiss}
            style={{
              flex: "1 1 88px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: "#173033",
              color: "#54e0c7",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Ok
          </button>
          <button
            type="button"
            onClick={neverShowAgain}
            style={{
              flex: "1 1 150px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#20283a",
              color: "#e6e8ee",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Never Show Again
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

function LadderGravityFeedbackPrompt({
  appVersion,
  onFeedbackNow,
}: {
  appVersion: string;
  onFeedbackNow: () => void;
}) {
  const lastResult = useMineStore((s) => s.lastResult);
  const [visible, setVisible] = useState(false);
  const [suppressedForSession, setSuppressedForSession] = useState(false);

  useEffect(() => {
    if (!lastResult?.ok || !lastResult.ladderFalls?.length) return;
    if (suppressedForSession) return;
    try {
      if (localStorage.getItem(LADDER_GRAVITY_FEEDBACK_NEVER_KEY) === "true") {
        return;
      }
    } catch {
      // Storage blocked: keep the prompt session-scoped.
    }
    const timer = setTimeout(() => setVisible(true), 1100);
    return () => clearTimeout(timer);
  }, [lastResult, suppressedForSession]);

  if (!visible) return null;

  const dismiss = () => setVisible(false);
  const neverShowAgain = () => {
    try {
      localStorage.setItem(LADDER_GRAVITY_FEEDBACK_NEVER_KEY, "true");
    } catch {
      setSuppressedForSession(true);
    }
    setVisible(false);
  };
  const feedbackNow = () => {
    setVisible(false);
    onFeedbackNow();
  };

  return (
    <DismissibleDialogFrame
      onDismiss={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ladder-gravity-feedback-title"
      data-app-version={appVersion}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 35,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.62)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 390px)",
          border: "1px solid #f0c36b",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.98)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.54)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <h2
          id="ladder-gravity-feedback-title"
          style={{
            margin: 0,
            color: "#f0c36b",
            fontSize: "1.02rem",
            lineHeight: 1.2,
          }}
        >
          Ladders can fall now
        </h2>
        <p
          style={{
            margin: "10px 0 14px",
            color: "#dce5f7",
            fontSize: "0.92rem",
            lineHeight: 1.4,
          }}
        >
          A ladder you unsupported just slid down the shaft. How does this new
          mechanic feel?
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={dismiss}
            style={{
              flex: "1 1 64px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: "#173033",
              color: "#54e0c7",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Ok
          </button>
          <button
            type="button"
            onClick={feedbackNow}
            style={{
              flex: "1 1 138px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #f5c542",
              background: "#2d2616",
              color: "#f5c542",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Give Feedback Now
          </button>
          <button
            type="button"
            onClick={neverShowAgain}
            style={{
              flex: "1 1 148px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#20283a",
              color: "#e6e8ee",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Never Show Again
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

function FeedbackDialog({
  open,
  context,
  appVersion,
  onClose,
}: {
  open: boolean;
  context: FeedbackContext;
  appVersion: string;
  onClose: () => void;
}) {
  const mine = useMineStore((s) => s.mine);
  const [category, setCategory] = useState<FeedbackCategory>(
    context.source === "ladder-gravity" ? "confusing" : "bug",
  );
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory(context.source === "ladder-gravity" ? "confusing" : "bug");
    setComment("");
    setEmail("");
    setState("idle");
    setMessage(null);
  }, [open, context.source]);

  if (!open) return null;

  const close = () => {
    if (state === "saving") return;
    onClose();
  };

  const submit = async () => {
    if (state === "saving") return;
    setState("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          comment,
          email,
          context: {
            source: context.source,
            prompt: context.prompt,
            appVersion,
            mineVersion: MINE_VERSION,
            depth: mine.miner.row,
            column: mine.miner.col,
          },
        }),
      });
      if (!res.ok) throw new Error("feedback unavailable");
      setState("saved");
      setMessage("Feedback saved. Thank you.");
    } catch {
      setState("error");
      setMessage("Could not save feedback. Try again later.");
    }
  };

  return (
    <DismissibleDialogFrame
      active={state !== "saving"}
      onDismiss={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(3, 6, 12, 0.72)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(520px, 100%)",
          maxHeight: "calc(100dvh - 42px)",
          overflowY: "auto",
          borderRadius: 12,
          border: "1px solid #54e0c7",
          background: "rgba(16, 20, 31, 0.98)",
          boxShadow: "0 18px 60px rgba(0, 0, 0, 0.58)",
          color: "#e6e8ee",
          padding: 18,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2 id="feedback-title" style={{ margin: 0, fontSize: "1.18rem" }}>
              Feedback
            </h2>
            {context.source === "ladder-gravity" && (
              <p style={{ margin: "6px 0 0", color: "#f5c542" }}>
                Ladder gravity mechanic
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close feedback"
            disabled={state === "saving"}
            onClick={close}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#182033",
              color: "#e6e8ee",
              fontSize: "1rem",
              fontWeight: 900,
              cursor: state === "saving" ? "progress" : "pointer",
            }}
          >
            X
          </button>
        </header>
        <label
          style={{
            display: "grid",
            gap: 6,
            marginTop: 10,
            color: "#cdd6ea",
            fontSize: "0.84rem",
            fontWeight: 800,
          }}
        >
          Common feedback
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as FeedbackCategory)
            }
            disabled={state === "saving" || state === "saved"}
            style={{
              width: "100%",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#121827",
              color: "#e6e8ee",
              fontSize: "1rem",
              padding: "0 10px",
            }}
          >
            {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "grid",
            gap: 6,
            marginTop: 12,
            color: "#cdd6ea",
            fontSize: "0.84rem",
            fontWeight: 800,
          }}
        >
          Comment
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={state === "saving" || state === "saved"}
            maxLength={2000}
            rows={5}
            style={{
              width: "100%",
              minHeight: 124,
              resize: "vertical",
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#121827",
              color: "#e6e8ee",
              fontSize: "1rem",
              lineHeight: 1.4,
              padding: 10,
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          />
        </label>
        <label
          style={{
            display: "grid",
            gap: 6,
            marginTop: 12,
            color: "#cdd6ea",
            fontSize: "0.84rem",
            fontWeight: 800,
          }}
        >
          Email (optional)
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={state === "saving" || state === "saved"}
            style={{
              width: "100%",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#121827",
              color: "#e6e8ee",
              fontSize: "1rem",
              padding: "0 10px",
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          />
        </label>
        {message && (
          <p
            role="status"
            style={{
              margin: "12px 0 0",
              color: state === "error" ? "#ff8a8a" : "#54e0c7",
              fontSize: "0.88rem",
              fontWeight: 800,
            }}
          >
            {message}
          </p>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={() => void submit()}
            disabled={state === "saving" || state === "saved"}
            style={{
              flex: "1 1 160px",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: "#173033",
              color: "#54e0c7",
              fontSize: "0.94rem",
              fontWeight: 900,
              cursor:
                state === "saving" || state === "saved"
                  ? "not-allowed"
                  : "pointer",
              opacity: state === "saving" || state === "saved" ? 0.72 : 1,
            }}
          >
            {state === "saving" ? "Saving..." : "Submit feedback"}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={state === "saving"}
            style={{
              flex: "1 1 100px",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#20283a",
              color: "#e6e8ee",
              fontSize: "0.94rem",
              fontWeight: 800,
              cursor: state === "saving" ? "progress" : "pointer",
            }}
          >
            Close
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

function CreditsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <DismissibleDialogFrame
      onDismiss={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(3, 6, 12, 0.72)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(440px, 100%)",
          borderRadius: 12,
          border: "1px solid #f0c36b",
          background: "rgba(16, 20, 31, 0.98)",
          boxShadow: "0 18px 60px rgba(0, 0, 0, 0.58)",
          color: "#e6e8ee",
          padding: 18,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <p
              style={{
                margin: "0 0 4px",
                color: "#f0c36b",
                fontSize: "0.78rem",
                fontWeight: 900,
                letterSpacing: 0,
                textTransform: "uppercase",
              }}
            >
              Special thanks
            </p>
            <h2 id="credits-title" style={{ margin: 0, fontSize: "1.18rem" }}>
              Credits
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close credits"
            onClick={onClose}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#182033",
              color: "#e6e8ee",
              fontSize: "1rem",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            X
          </button>
        </header>
        <p
          style={{
            margin: "0 0 14px",
            color: "#dce5f7",
            fontSize: "0.98rem",
            lineHeight: 1.45,
          }}
        >
          Thank you to Mason and MJ Lutcavich for testing VibeBots, sharing
          feedback, and bringing great ideas to the mine.
        </p>
        <p
          style={{
            margin: "0 0 16px",
            color: "#9fa9bf",
            fontSize: "0.86rem",
            lineHeight: 1.4,
          }}
        >
          Your play sessions are helping shape what the robots dig, build, and
          survive next.
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            minHeight: 44,
            borderRadius: 10,
            border: "1px solid #f0c36b",
            background: "#2d2616",
            color: "#f0c36b",
            fontSize: "0.94rem",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Back to the mine
        </button>
      </section>
    </DismissibleDialogFrame>
  );
}

function IosHomeScreenPrompt({ disabled }: { disabled: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (disabled) {
      setVisible(false);
      return;
    }
    if (localStorage.getItem(IOS_HOME_SCREEN_PROMPT_NEVER_KEY) === "1") {
      return;
    }
    if (!isMobileSafari() || isStandaloneWebApp()) {
      return;
    }
    setVisible(true);
  }, [disabled]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
  };

  const dismissForever = () => {
    localStorage.setItem(IOS_HOME_SCREEN_PROMPT_NEVER_KEY, "1");
    setVisible(false);
  };

  return (
    <DismissibleDialogFrame
      onDismiss={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-home-screen-prompt-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 29,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.5)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 350px)",
          border: "1px solid #f5c542",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.97)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.52)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <h2
          id="ios-home-screen-prompt-title"
          style={{
            margin: "0 0 8px",
            color: "#f5c542",
            fontSize: "1rem",
            lineHeight: 1.2,
          }}
        >
          Add VibeBots to Home Screen
        </h2>
        <p
          style={{
            margin: "0 0 10px",
            color: "#dce5f7",
            fontSize: "0.88rem",
            lineHeight: 1.35,
          }}
        >
          Mobile Safari needs the Home Screen app before notifications can work.
          Tap Share, then Add to Home Screen.
        </p>
        <p
          style={{
            margin: "0 0 14px",
            color: "#aab3c8",
            fontSize: "0.76rem",
            lineHeight: 1.3,
          }}
        >
          Safari does not let websites open that sheet automatically.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={dismiss}
            style={{
              width: "100%",
              minHeight: 42,
              borderRadius: 10,
              border: "1px solid #f5c542",
              background: "#2d2616",
              color: "#f5c542",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Ok
          </button>
          <button
            type="button"
            onClick={dismissForever}
            style={{
              width: "100%",
              minHeight: 42,
              borderRadius: 10,
              border: "1px solid #8b93a7",
              background: "#20283a",
              color: "#e6e8ee",
              fontSize: "0.86rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Never show again
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

function ReleaseNotificationControl() {
  const [uiState, setUiState] = useState<NotificationUiState>("checking");
  const [summary, setSummary] = useState("");

  const refresh = useCallback(async () => {
    if (!pushApiSupported()) {
      setUiState("unsupported");
      return;
    }
    if (isIosDevice() && !isStandaloneWebApp()) {
      setUiState("ios-install");
      return;
    }
    const config = await loadNotificationConfig();
    setSummary(config.releaseSummary);
    if (!config.configured || !config.vapidPublicKey) {
      setUiState("unconfigured");
      return;
    }
    if (Notification.permission === "denied") {
      setUiState("denied");
      return;
    }
    if (Notification.permission !== "granted") {
      setUiState("default");
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.getSubscription();
    setUiState(subscription ? "enabled" : "default");
  }, []);

  useEffect(() => {
    refresh().catch(() => setUiState("error"));
  }, [refresh]);

  const enable = async () => {
    setUiState("saving");
    try {
      const config = await loadNotificationConfig();
      setSummary(config.releaseSummary);
      if (!config.configured || !config.vapidPublicKey) {
        setUiState("unconfigured");
        return;
      }
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission === "denied") {
          setUiState("denied");
          return;
        }
        if (permission !== "granted") {
          setUiState("default");
          return;
        }
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const ready = await navigator.serviceWorker.ready;
      const existing = await ready.pushManager.getSubscription();
      const subscription =
        existing ??
        (await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey),
        }));
      const res = await fetch("/api/notifications/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          platform: notificationPlatform(),
        }),
      });
      if (!res.ok) throw new Error("subscription save failed");
      await registration.update();
      setUiState("enabled");
    } catch {
      setUiState("error");
    }
  };

  const disable = async () => {
    setUiState("saving");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/notifications/subscription", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setUiState(Notification.permission === "granted" ? "default" : "denied");
    } catch {
      setUiState("error");
    }
  };

  const label =
    uiState === "enabled"
      ? "Update alerts on"
      : uiState === "saving"
        ? "Saving alerts"
        : "Enable update alerts";
  const note =
    uiState === "ios-install"
      ? "On iPhone or iPad, add VibeBots to Home Screen and open it there."
      : uiState === "unsupported"
        ? "Notifications are not available in this browser."
        : uiState === "unconfigured"
          ? "Notification keys are not set on this deploy."
          : uiState === "denied"
            ? "Notifications are blocked in browser settings."
            : uiState === "enabled"
              ? "You will get one-line release summaries."
              : uiState === "error"
                ? "Could not save notification settings."
                : summary || "Get one-line release summaries.";

  return (
    <section
      aria-label="Update alerts"
      style={{
        display: "grid",
        gap: 6,
        marginTop: 8,
      }}
    >
      <button
        type="button"
        disabled={
          uiState === "checking" ||
          uiState === "saving" ||
          uiState === "unsupported" ||
          uiState === "ios-install" ||
          uiState === "unconfigured" ||
          uiState === "denied"
        }
        onClick={uiState === "enabled" ? disable : enable}
        style={{
          width: "100%",
          minHeight: 40,
          borderRadius: 10,
          border: "1px solid #cdd6ea",
          background: uiState === "enabled" ? "#21301f" : "#20283a",
          color: uiState === "enabled" ? "#8ee06f" : "#e6e8ee",
          fontSize: "0.86rem",
          fontWeight: 800,
          cursor:
            uiState === "checking" || uiState === "saving"
              ? "progress"
              : "pointer",
          opacity:
            uiState === "unsupported" ||
            uiState === "ios-install" ||
            uiState === "unconfigured" ||
            uiState === "denied"
              ? 0.68
              : 1,
        }}
      >
        {label}
      </button>
      <p
        style={{
          margin: 0,
          color: "#aab3c8",
          fontSize: "0.72rem",
          lineHeight: 1.25,
        }}
      >
        {note}
      </p>
    </section>
  );
}

const ACHIEVEMENT_CATEGORY_LABELS: Record<string, string> = {
  depth: "Depth",
  haul: "Haul",
  tools: "Tools",
  survival: "Survival",
};

function StampBookPopup({
  open,
  onClose,
  onBeforeLoad,
}: {
  open: boolean;
  onClose: () => void;
  onBeforeLoad: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [achievements, setAchievements] = useState<PlayerAchievementView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    onBeforeLoad();
    fetch("/api/achievements")
      .then(async (res) => {
        if (!res.ok) throw new Error("stamp book unavailable");
        return (await res.json()) as {
          offline?: boolean;
          achievements?: PlayerAchievementView[];
        };
      })
      .then((body) => {
        if (cancelled) return;
        setOffline(Boolean(body.offline));
        setAchievements(body.achievements ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "stamp book unavailable");
        setAchievements([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onBeforeLoad]);

  if (!open) return null;

  const collected = achievements.filter((achievement) => achievement.unlocked);
  const byCategory = achievements.reduce<
    Record<string, PlayerAchievementView[]>
  >((groups, achievement) => {
    groups[achievement.category] ??= [];
    groups[achievement.category].push(achievement);
    return groups;
  }, {});

  return (
    <DismissibleDialogFrame
      onDismiss={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stamp-book-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(3, 6, 12, 0.72)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(560px, 100%)",
          maxHeight: "calc(100dvh - 48px)",
          overflowY: "auto",
          borderRadius: 12,
          border: "1px solid #384564",
          background: "rgba(16, 20, 31, 0.98)",
          boxShadow: "0 18px 60px rgba(0, 0, 0, 0.58)",
          color: "#e6e8ee",
          padding: 18,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2
              id="stamp-book-title"
              style={{ margin: 0, fontSize: "1.25rem" }}
            >
              Stamp Book
            </h2>
            <p style={{ margin: "6px 0 0", color: "#9aa6c4" }}>
              {loading
                ? "Loading stamps..."
                : `${collected.length}/${achievements.length} collected`}
            </p>
            {offline && (
              <p style={{ margin: "6px 0 0", color: "#f5c542" }}>
                Stamp ledger offline. Stamps are visible, progress waits for
                storage.
              </p>
            )}
            {error && (
              <p style={{ margin: "6px 0 0", color: "#ff8a8a" }}>{error}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close Stamp Book"
            onClick={onClose}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#182033",
              color: "#e6e8ee",
              fontSize: "1rem",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            X
          </button>
        </header>

        {(["depth", "haul", "tools", "survival"] as const).map((category) => {
          const items = byCategory[category] ?? [];
          if (items.length === 0) return null;
          return (
            <section key={category} style={{ marginTop: 16 }}>
              <h3
                style={{
                  margin: "0 0 8px",
                  color: "#54e0c7",
                  fontSize: "0.9rem",
                  textTransform: "uppercase",
                  letterSpacing: 0,
                }}
              >
                {ACHIEVEMENT_CATEGORY_LABELS[category]}
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                  gap: 10,
                }}
              >
                {items.map((achievement) => {
                  const done = achievement.unlocked;
                  return (
                    <article
                      key={achievement.id}
                      data-achievement-id={achievement.id}
                      data-achievement-unlocked={done ? "true" : "false"}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "54px 1fr",
                        gap: 10,
                        minHeight: 96,
                        borderRadius: 8,
                        border: done
                          ? "1px solid #54e0c7"
                          : "1px solid #2c3651",
                        background: done
                          ? "rgba(84, 224, 199, 0.1)"
                          : "rgba(38, 48, 74, 0.42)",
                        padding: 10,
                      }}
                    >
                      <div
                        aria-hidden
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 8,
                          display: "grid",
                          placeItems: "center",
                          border: done
                            ? "2px solid #54e0c7"
                            : "2px solid #59647d",
                          color: done ? "#54e0c7" : "#8b93a7",
                          fontWeight: 900,
                          fontSize: "0.8rem",
                          background: done ? "#102a2d" : "#151b2a",
                        }}
                      >
                        {achievement.stamp}
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: "0.94rem" }}>
                          {achievement.title}
                        </h4>
                        <p
                          style={{
                            margin: "4px 0 8px",
                            color: "#aeb8d0",
                            fontSize: "0.8rem",
                          }}
                        >
                          {achievement.description}
                        </p>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 999,
                            background: "#252f47",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.round((achievement.progress.current / achievement.progress.target) * 100))}%`,
                              height: "100%",
                              background: done ? "#54e0c7" : "#f5c542",
                            }}
                          />
                        </div>
                        <p
                          style={{
                            margin: "6px 0 0",
                            color: done ? "#54e0c7" : "#f5c542",
                            fontSize: "0.74rem",
                            fontWeight: 800,
                          }}
                        >
                          {done
                            ? `Collected ${achievement.unlockedAt?.slice(0, 10) ?? ""}`
                            : achievement.progress.label}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </section>
    </DismissibleDialogFrame>
  );
}

function slotMeta(summary: SaveSlotSummary): string {
  if (!summary.exists) return "New game";
  return [
    `${summary.balance} vibes`,
    `depth ${summary.deepestDepth}`,
    `${summary.partsOwned} parts`,
    `${summary.designs} bots`,
    `${summary.stamps} stamps`,
  ].join(" | ");
}

function SaveSlotsPopup({
  open,
  state,
  onClose,
  onRefresh,
  onLoad,
  onDelete,
}: {
  open: boolean;
  state: SaveSlotsState;
  onClose: () => void;
  onRefresh: () => void;
  onLoad: (slot: 1 | 2 | 3, options?: { create?: boolean }) => Promise<boolean>;
  onDelete: (slot: 1 | 2 | 3) => Promise<boolean>;
}) {
  const [pendingSlot, setPendingSlot] = useState<1 | 2 | 3 | null>(null);
  const [deleteConfirmSlot, setDeleteConfirmSlot] = useState<1 | 2 | 3 | null>(
    null,
  );
  const [pendingDeleteSlot, setPendingDeleteSlot] = useState<1 | 2 | 3 | null>(
    null,
  );

  useEffect(() => {
    if (open) onRefresh();
  }, [open, onRefresh]);

  useEffect(() => {
    if (!open) {
      setPendingSlot(null);
      setDeleteConfirmSlot(null);
      setPendingDeleteSlot(null);
    }
  }, [open]);

  if (!open) return null;

  const slots =
    state.slots.length > 0
      ? state.slots
      : ([1, 2, 3] as const).map((slot) => ({
          slot,
          active: state.activeSlot === slot,
          exists: false,
          createdAt: null,
          balance: 0,
          deepestDepth: 0,
          partsOwned: 0,
          designs: 0,
          stamps: 0,
        }));
  const busy =
    state.state === "loading" ||
    state.state === "switching" ||
    state.state === "deleting";
  const status =
    state.state === "unavailable"
      ? "Save slots need server storage."
      : state.state === "error"
        ? state.message
        : state.state === "loading"
          ? "Loading saves..."
          : state.state === "switching"
            ? "Loading slot..."
            : state.state === "deleting"
              ? "Deleting slot..."
              : null;

  return (
    <DismissibleDialogFrame
      onDismiss={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-slots-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(3, 6, 12, 0.72)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(520px, 100%)",
          maxHeight: "calc(100dvh - 48px)",
          overflowY: "auto",
          borderRadius: 12,
          border: "1px solid #384564",
          background: "rgba(16, 20, 31, 0.98)",
          boxShadow: "0 18px 60px rgba(0, 0, 0, 0.58)",
          color: "#e6e8ee",
          padding: 18,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2
              id="save-slots-title"
              style={{ margin: 0, fontSize: "1.25rem" }}
            >
              Load Save Slot
            </h2>
            {status && (
              <p style={{ margin: "6px 0 0", color: "#f5c542" }}>{status}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close Load Save Slot"
            onClick={onClose}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#182033",
              color: "#e6e8ee",
              fontSize: "1rem",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            X
          </button>
        </header>
        <div style={{ display: "grid", gap: 8 }}>
          {slots.map((summary) => {
            const pending = pendingSlot === summary.slot;
            const deleting = pendingDeleteSlot === summary.slot;
            const confirmingDelete = deleteConfirmSlot === summary.slot;
            const loadDisabled =
              busy ||
              pendingSlot !== null ||
              pendingDeleteSlot !== null ||
              summary.active ||
              state.state === "unavailable";
            const deleteDisabled =
              busy ||
              pendingSlot !== null ||
              pendingDeleteSlot !== null ||
              !summary.exists ||
              state.state === "unavailable";
            return (
              <fieldset
                key={summary.slot}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: 10,
                  minHeight: 58,
                  borderRadius: 10,
                  border: summary.active
                    ? "1px solid #54e0c7"
                    : "1px solid #344061",
                  background: summary.active ? "#172b30" : "#171d2b",
                  margin: 0,
                  padding: "10px 12px",
                }}
              >
                <legend
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    overflow: "hidden",
                    clip: "rect(0 0 0 0)",
                  }}
                >
                  Slot {summary.slot}
                  {summary.active ? " current" : ""}
                </legend>
                <div>
                  <strong style={{ display: "block", marginBottom: 3 }}>
                    Slot {summary.slot}
                    {summary.active ? " (current)" : ""}
                  </strong>
                  <span style={{ color: "#9aa6c4", fontSize: "0.82rem" }}>
                    {slotMeta(summary)}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    disabled={loadDisabled}
                    aria-pressed={summary.active}
                    onClick={async () => {
                      setDeleteConfirmSlot(null);
                      setPendingSlot(summary.slot);
                      const loaded = await onLoad(summary.slot, {
                        create: !summary.exists,
                      });
                      if (loaded) window.location.assign("/mine");
                      setPendingSlot(null);
                    }}
                    style={{
                      minWidth: 78,
                      minHeight: 40,
                      flex: "1 1 104px",
                      borderRadius: 10,
                      border: "1px solid #425273",
                      background: summary.active ? "#173635" : "#202a40",
                      color:
                        loadDisabled && !summary.active ? "#778198" : "#e6e8ee",
                      cursor: loadDisabled ? "not-allowed" : "pointer",
                      fontWeight: 800,
                    }}
                  >
                    {summary.active
                      ? "Loaded"
                      : pending
                        ? summary.exists
                          ? "Loading"
                          : "Starting"
                        : summary.exists
                          ? "Load"
                          : "Start"}
                  </button>
                  <button
                    type="button"
                    disabled={deleteDisabled}
                    onClick={async () => {
                      if (!confirmingDelete) {
                        setDeleteConfirmSlot(summary.slot);
                        return;
                      }
                      setPendingDeleteSlot(summary.slot);
                      const deleted = await onDelete(summary.slot);
                      if (deleted && summary.active)
                        window.location.assign("/mine");
                      setPendingDeleteSlot(null);
                      setDeleteConfirmSlot(null);
                    }}
                    style={{
                      minWidth: confirmingDelete ? 176 : 78,
                      minHeight: 40,
                      flex: confirmingDelete ? "2 1 176px" : "1 1 104px",
                      borderRadius: 10,
                      border: "1px solid #8f2630",
                      background: confirmingDelete ? "#651923" : "#321b22",
                      color: deleteDisabled ? "#80636a" : "#ffd7d7",
                      cursor: deleteDisabled ? "not-allowed" : "pointer",
                      fontWeight: 900,
                    }}
                  >
                    {deleting
                      ? "Deleting"
                      : confirmingDelete
                        ? `Delete Slot ${summary.slot} Forever`
                        : "Delete"}
                  </button>
                </div>
                {confirmingDelete && (
                  <p
                    style={{
                      margin: 0,
                      padding: "9px 10px",
                      borderRadius: 8,
                      border: "1px solid #ff5c70",
                      background: "#3d1018",
                      color: "#ff9aa8",
                      fontWeight: 900,
                      letterSpacing: 0,
                      textTransform: "uppercase",
                    }}
                  >
                    Destructive action: this permanently deletes Slot{" "}
                    {summary.slot}. The mine, upgrades, stamps, purchases, bot
                    parts, constructed bots, wallet, and checkpoints cannot be
                    restored.
                  </p>
                )}
              </fieldset>
            );
          })}
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

/**
 * Render-layer near-miss search (REQ-019): the best treasure within
 * reach of where the robot battery died, from rows the client already generated.
 */
function nearMissLine(
  mine: MineState,
  at: { col: number; row: number },
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
  return `${what} sat ${best.dist} block${best.dist > 1 ? "s" : ""} from where the battery died.`;
}

interface FloatNote {
  id: number;
  text: string;
  color: string;
  glow: string;
}

/** Floating pickup text, cache fanfare, and the collapse reveal. */
function JuiceOverlays() {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
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

  useEffect(() => {
    return () => {
      if (wreckTimeout.current != null) {
        window.clearTimeout(wreckTimeout.current);
        wreckTimeout.current = null;
      }
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useEffect(() => {
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
    if (wreckTimeout.current != null) {
      window.clearTimeout(wreckTimeout.current);
      wreckTimeout.current = null;
    }
    if (lastResult.collapsed && lastResult.lost) {
      const nextWreck = {
        crushed: lastResult.crushed ?? false,
        fallFatal: lastResult.fallFatal ?? false,
        abandoned: lastResult.abandoned ?? false,
        value: lastResult.lost.value,
        parts: lastResult.lost.parts.length,
        nearMiss: nearMissLine(mine, lastResult.lost),
      };
      if (lastResult.fallFatal || lastResult.crushed) {
        wreckTimeout.current = window.setTimeout(
          () => {
            setWreck(nextWreck);
            wreckTimeout.current = null;
          },
          lastResult.fallFatal ? 850 : 1300,
        );
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
          onClick={() => setWreck(null)}
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
                  ? "Crushed by a boulder"
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

/** Big-tap-target sheet row: icon tile, label, action button. */
function SheetRow({
  icon,
  name,
  sub,
  badge,
  action,
}: {
  icon: string;
  name: string;
  sub?: string;
  badge?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid rgba(38, 48, 74, 0.55)",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: "rgba(38, 48, 74, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.2rem",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{ display: "block", fontSize: "0.95rem", fontWeight: 600 }}
        >
          {name}
          {badge && (
            <span
              style={{
                marginLeft: 8,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#54e0c7",
              }}
            >
              {badge}
            </span>
          )}
        </span>
        {sub && (
          <span
            style={{ display: "block", fontSize: "0.72rem", opacity: 0.55 }}
          >
            {sub}
          </span>
        )}
      </span>
      {action}
    </div>
  );
}

/** Downward drag distance (px) past which releasing closes the sheet. */
const SWIPE_DISMISS_PX = 70;
const SHEET_DRAG_START_PX = 8;

const sheetButtonStyle = (enabled: boolean): React.CSSProperties => ({
  minWidth: 78,
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid #2c3a5c",
  background: enabled ? "#1d2738" : "rgba(29, 39, 56, 0.4)",
  color: enabled ? "#e6e8ee" : "rgba(230, 232, 238, 0.35)",
  fontWeight: 700,
  fontSize: "0.9rem",
});

const STALL_ICONS: Record<StallDef["id"], string> = {
  buyer: "\u{1F3E6}",
  supply: "\u{1F4E6}",
  upgrades: "\u{1F6E0}\u{FE0F}",
  elevator: "\u{1F6D7}",
  warp: "\u{1F300}",
};

const ITEM_ICONS: Record<string, string> = {
  dynamite: "\u{1F9E8}",
  rope: "\u{1FAA2}",
  ladder: "\u{1FA9C}",
  plank: "\u{1FAB5}",
  beacon: "\u{1F4E1}",
  pickaxe: "\u{26CF}\u{FE0F}",
  battery: "\u{1F50B}",
  cargo: "\u{1F392}",
  lantern: "\u{1F3EE}",
  warpcoil: "\u{1F300}",
  blast: "\u{1F4A5}",
  elevatorSpeed: "\u{1F6D7}",
  fall: "\u{1FA82}",
  recall: "\u{1FAA2}",
};

const BASE_PART_ICONS: Record<BasePartId, string> = {
  "wall-panel": "\u{1F9F1}",
  "floor-panel": "\u{25A3}",
  "roof-panel": "\u{2302}",
  "door-panel": "\u{1F6AA}",
  "basic-turret": "\u{1F6E1}\u{FE0F}",
  "floor-spikes": "\u{1F53A}",
};

function HardwareStorePanel({
  balance,
  buyQuantity,
  setBuyQuantity,
  onBuyBasePart,
}: {
  balance: number | null;
  buyQuantity: number;
  setBuyQuantity: (quantity: number) => void;
  onBuyBasePart: (partId: BasePartId, quantity: number) => void;
}) {
  const inventory = useBunkerStore((s) => s.inventory);
  const bunker = useBunkerStore((s) => s.bunker);
  const player = useBunkerStore((s) => s.player);
  const bunkerStatus = useBunkerStore((s) => s.status);
  const playerLevel = player?.overallLevel ?? 1;

  return (
    <div>
      <p style={{ margin: "12px 0 8px", fontSize: "0.85rem", opacity: 0.72 }}>
        Base stock unlocks by player level. Parts are consumed when placed in
        the bunker builder.
      </p>
      <QuantityPicker value={buyQuantity} onChange={setBuyQuantity} />
      {BASE_PART_IDS.map((partId) => {
        const def = BASE_PART_CATALOG[partId];
        const totalPrice = def.price * buyQuantity;
        const affordable = balance !== null && balance >= totalPrice;
        const minLevel = basePartMinimumLevel(partId);
        const levelLocked = playerLevel < minLevel;
        const ownedCount = basePartOwnedCount(partId, bunker, inventory);
        const ownedLimit = basePartOwnedLimit(partId, playerLevel);
        const capped = ownedCount + buyQuantity > ownedLimit;
        const hasLimit = Number.isFinite(ownedLimit);
        const detail =
          partId === "basic-turret"
            ? `${def.blurb}. Level ${minLevel}. ${def.ammo ?? 0} shots per raid. Breaks after ${def.durability} Clanker hits.`
            : partId === "floor-spikes"
              ? `${def.blurb}. Breaks after ${def.durability} steps. Limit ${ownedLimit} at your level.`
              : def.blurb;
        const canBuy = affordable && !levelLocked && !capped;
        const buttonLabel = levelLocked
          ? `Requires level ${minLevel}`
          : capped
            ? `Limit ${ownedLimit}`
            : `Buy ${buyQuantity} for ${totalPrice} vibes`;
        return (
          <SheetRow
            key={partId}
            icon={BASE_PART_ICONS[partId]}
            name={def.name}
            sub={detail}
            badge={
              hasLimit
                ? `have ${ownedCount} / ${ownedLimit}`
                : `have ${inventory[partId] ?? 0}`
            }
            action={
              <button
                type="button"
                onClick={() => onBuyBasePart(partId, buyQuantity)}
                disabled={!canBuy}
                style={{ ...sheetButtonStyle(canBuy), minWidth: 124 }}
              >
                {buttonLabel}
              </button>
            }
          />
        );
      })}
      <p style={{ margin: "10px 0 0", fontSize: "0.72rem", opacity: 0.58 }}>
        Basic Turrets unlock at level 2 and are capped at one total owned or
        deployed. Floor Spikes are capped at 4 total at level 1 and 6 total from
        level 2. New claims start with 2 walls, 3 floors, 3 roofs, and 1 door.
      </p>
      {bunkerStatus === "unavailable" && (
        <p
          style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#f5c542" }}
        >
          Bunker ledger offline. Base stock can be browsed, but purchases wait
          until storage is online.
        </p>
      )}
      {balance === null && (
        <p
          style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#f5c542" }}
        >
          Wallet ledger offline. The Hardware Store can show the catalog, but
          purchases wait until storage is online.
        </p>
      )}
    </div>
  );
}

function QuantityPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <fieldset
      aria-label="Buy quantity"
      style={{
        display: "flex",
        gap: 8,
        margin: "10px 0 6px",
        padding: 0,
        border: 0,
      }}
    >
      {DEPOT_BUY_QUANTITIES.map((quantity) => {
        const active = value === quantity;
        return (
          <button
            key={quantity}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(quantity)}
            style={{
              border: active ? "1px solid #54e0c7" : "1px solid #2c3a5c",
              background: active
                ? "rgba(84, 224, 199, 0.16)"
                : "rgba(38, 48, 74, 0.55)",
              color: active ? "#54e0c7" : "#cdd6ea",
              borderRadius: 10,
              minWidth: 48,
              minHeight: 34,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            x{quantity}
          </button>
        );
      })}
    </fieldset>
  );
}

type DepotItem = "dynamite" | "rope" | "ladder" | "plank" | "beacon";
const DEPOT_BUY_QUANTITIES = [1, 5, 10] as const;

/**
 * The shop sheet (REQ-021): standing at a stall slides a mobile bottom
 * sheet up over the lower screen, with thumb-sized rows and the wallet
 * in the header. Walking off the column closes it.
 */
function StallMenu({
  stall,
  mine,
  gear,
  balance,
  playerLevel,
  deepestDepth,
  beaconLimit,
  shopNote,
  cashOutPending,
  onBuyConsumable,
  onBuyBasePart,
  onBuyGear,
  onBuyElevator,
  onRide,
  onClose,
  sheetRef,
}: {
  stall: StallDef;
  mine: MineState;
  gear: MineGear;
  balance: number | null;
  playerLevel: number;
  deepestDepth: number;
  beaconLimit: number;
  shopNote: string | null;
  cashOutPending: boolean;
  onBuyConsumable: (item: DepotItem, quantity: number) => void;
  onBuyBasePart: (partId: BasePartId, quantity: number) => void;
  onBuyGear: (track: MineGearTrack) => void;
  onBuyElevator: () => void;
  onRide: (action: MineAction) => void;
  onClose: () => void;
  sheetRef?: RefObject<HTMLElement | null>;
}) {
  const miner = mine.miner;
  const banked = miner.bankedCredits;
  const bankedParts = miner.bankedParts.length;
  const autoBanking = banked > 0 || bankedParts > 0;
  const upgradeFunds = balance === null ? null : balance + banked;
  const offline = balance === null;
  const beacons = findBeacons(mine);
  const portals = findPortalBeacons(mine).filter((portal) => portal.active);
  const warpDestinationCount = beacons.length + portals.length;
  const beaconTotal = mine.consumables.beacon + beacons.length;
  const beaconRoom = Math.max(0, beaconLimit - beaconTotal);
  // Swipe-to-dismiss: the sheet follows a downward pull from anywhere inside
  // the panel. A short tug snaps back.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [buyQuantity, setBuyQuantity] = useState(1);
  const [beaconDrafts, setBeaconDrafts] = useState<Record<string, string>>({});
  const draggingRef = useRef(false);
  const dragStart = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const dismiss = () => {
    setDragY(0);
    setDragging(false);
    draggingRef.current = false;
    dragStart.current = null;
    onClose();
  };
  const onSheetPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target instanceof HTMLElement) {
      const editable = e.target.closest(
        "input, textarea, select, [contenteditable='true']",
      );
      if (editable) return;
    }
    dragStart.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onSheetPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (
      dragStart.current === null ||
      e.pointerId !== dragStart.current.pointerId
    ) {
      return;
    }
    const dy = e.clientY - dragStart.current.y;
    const dx = Math.abs(e.clientX - dragStart.current.x);
    if (!draggingRef.current) {
      if (dy <= SHEET_DRAG_START_PX || dy <= dx) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      setDragging(true);
    }
    e.preventDefault();
    setDragY(dy > 0 ? dy : 0);
  };
  const onSheetPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (
      dragStart.current === null ||
      e.pointerId !== dragStart.current.pointerId
    ) {
      return;
    }
    const dy = e.clientY - dragStart.current.y;
    const wasDragging = draggingRef.current;
    dragStart.current = null;
    setDragging(false);
    draggingRef.current = false;
    if (!wasDragging) return;
    e.preventDefault();
    if (dy > SWIPE_DISMISS_PX) dismiss();
    else setDragY(0);
  };
  const onSheetPointerCancel = () => {
    dragStart.current = null;
    draggingRef.current = false;
    setDragging(false);
    setDragY(0);
  };
  return (
    <section
      ref={sheetRef}
      aria-label={stall.name}
      className="stall-sheet"
      onPointerDown={onSheetPointerDown}
      onPointerMove={onSheetPointerMove}
      onPointerUp={onSheetPointerUp}
      onPointerCancel={onSheetPointerCancel}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        margin: "0 auto",
        maxWidth: 440,
        background:
          "linear-gradient(180deg, rgba(21, 27, 41, 0.97), rgba(12, 15, 23, 0.99))",
        borderTop: `2px solid ${stall.color}`,
        borderRadius: "18px 18px 0 0",
        boxShadow: "0 -14px 44px rgba(0, 0, 0, 0.55)",
        padding: "8px 18px 18px",
        zIndex: 10,
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragging ? "none" : "transform 180ms ease",
        touchAction: "none",
      }}
    >
      <div
        style={{
          margin: "-8px -18px 0",
          padding: "10px 18px 4px",
          cursor: "grab",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 38,
            height: 4,
            borderRadius: 999,
            background: stall.color,
            opacity: 0.4,
            margin: "0 auto 8px",
          }}
        />
      </div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: "1.5rem" }}>{STALL_ICONS[stall.id]}</span>
        <span style={{ flex: 1 }}>
          <span
            style={{
              display: "block",
              fontWeight: 800,
              fontSize: "1.05rem",
              color: stall.color,
            }}
          >
            {stall.name}
          </span>
          <span
            style={{ display: "block", fontSize: "0.72rem", opacity: 0.55 }}
          >
            {stall.blurb}
          </span>
        </span>
        <span
          style={{
            background: "rgba(38, 48, 74, 0.6)",
            borderRadius: 999,
            padding: "6px 12px",
            fontSize: "0.85rem",
            fontWeight: 700,
            color: offline ? "#8b93a7" : "#f5c542",
            whiteSpace: "nowrap",
          }}
        >
          {offline ? "offline" : `\u{1F4B0} ${balance} vibes`}
        </span>
        <button
          type="button"
          aria-label="Close shop"
          onClick={dismiss}
          style={{
            flexShrink: 0,
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "1px solid rgba(255, 255, 255, 0.18)",
            background: "rgba(38, 48, 74, 0.6)",
            color: "#cdd6ea",
            fontSize: "1.2rem",
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          {"×"}
        </button>
      </header>
      {offline && (
        <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#f5c542" }}>
          the ledger is offline right now; browsing only
        </p>
      )}
      {stall.id === "buyer" && (
        <HardwareStorePanel
          balance={balance}
          buyQuantity={buyQuantity}
          setBuyQuantity={setBuyQuantity}
          onBuyBasePart={onBuyBasePart}
        />
      )}
      {stall.id === "supply" && (
        <div>
          <QuantityPicker value={buyQuantity} onChange={setBuyQuantity} />
          {(
            [
              ["dynamite", "Dynamite", "fuels your selected blast tier"],
              ["rope", "Recall Rope", "bank within your rope range"],
              ["ladder", "Ladder", "climbs one cell, stays planted"],
              ["plank", "Plank", "bridges one gap, stays planted"],
              ["beacon", "Warp Beacon", "plants the warp anchor"],
            ] as const
          ).map(([item, name, blurb]) => {
            const price = CONSUMABLE_PRICES[item];
            const totalPrice = price * buyQuantity;
            const beaconAllowed =
              item !== "beacon" || buyQuantity <= beaconRoom;
            const affordable =
              balance !== null && balance >= totalPrice && beaconAllowed;
            const beaconBadge =
              item === "beacon"
                ? `${mine.consumables.beacon} packed, ${beacons.length} planted`
                : null;
            const actionLabel =
              item === "beacon" && !beaconAllowed
                ? `Limit ${beaconLimit} total`
                : `Buy ${buyQuantity} for ${totalPrice} vibes`;
            const rowSub =
              item === "beacon" && !beaconAllowed
                ? "At the cap. If a beacon is deployed, collect it in edit pickup mode for scraps to free a slot."
                : blurb;
            return (
              <SheetRow
                key={item}
                icon={ITEM_ICONS[item]}
                name={name}
                sub={rowSub}
                badge={beaconBadge ?? `have ${mine.consumables[item]}`}
                action={
                  <button
                    type="button"
                    onClick={() => onBuyConsumable(item, buyQuantity)}
                    disabled={!affordable}
                    style={{ ...sheetButtonStyle(affordable), minWidth: 124 }}
                  >
                    {actionLabel}
                  </button>
                }
              />
            );
          })}
        </div>
      )}
      {stall.id === "upgrades" && (
        <div>
          {GEAR_TRACKS.map((def) => {
            // blast is optional on gear (absent reads as level 1).
            const level = gear[def.track] ?? 1;
            const maxed = level >= maxGearLevel(def.track);
            const price = maxed ? null : def.prices[level - 1];
            const requirements = gearUpgradeRequirements(def.track, level);
            const levelLocked = playerLevel < requirements.playerLevel;
            const depthLocked = deepestDepth < requirements.maxDepth;
            const locked = levelLocked || depthLocked;
            const affordable =
              price !== null &&
              upgradeFunds !== null &&
              upgradeFunds >= price &&
              !cashOutPending &&
              !locked;
            const lockLabel = levelLocked
              ? `level ${requirements.playerLevel}`
              : depthLocked
                ? `depth ${requirements.maxDepth}`
                : null;
            return (
              <SheetRow
                key={def.track}
                icon={ITEM_ICONS[def.track] ?? "\u{2699}\u{FE0F}"}
                name={def.name}
                sub={lockLabel ? `${def.blurb}; needs ${lockLabel}` : def.blurb}
                badge={
                  def.track === "blast"
                    ? `tier ${level}`
                    : def.track === "recall"
                      ? `row ${recallRopeRange(gear)}`
                      : `lv ${level}`
                }
                action={
                  maxed ? (
                    <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                      max
                    </span>
                  ) : locked ? (
                    <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                      locked
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBuyGear(def.track)}
                      disabled={!affordable}
                      style={sheetButtonStyle(affordable)}
                    >
                      {autoBanking ? "Bank + " : ""}
                      {price} vibes
                    </button>
                  )
                }
              />
            );
          })}
          <p style={{ margin: "10px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            Upgrades sell any hauled-up loot first, then apply immediately.
          </p>
        </div>
      )}
      {stall.id === "elevator" && (
        <div>
          <SheetRow
            icon={"\u{1F6D7}"}
            name={
              gear.elevator > 0
                ? `rail reaches ${gear.elevator} deep`
                : "no rail yet; the shaft waits"
            }
            sub="free rides, surface to rail end"
            action={
              <button
                type="button"
                onClick={onBuyElevator}
                disabled={
                  balance === null ||
                  balance <
                    elevatorSegmentPrice(
                      gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                    )
                }
                style={sheetButtonStyle(
                  balance !== null &&
                    balance >=
                      elevatorSegmentPrice(
                        gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                      ),
                )}
              >
                {elevatorSegmentPrice(
                  gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                )}{" "}
                vibes
              </button>
            }
          />
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            each segment extends the rail {ELEVATOR_SEGMENT_ROWS} rows
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            speed level {gear.elevatorSpeed ?? 1} moves{" "}
            {elevatorSpeedRows(gear)} rows per automatic step
          </p>
          <button
            type="button"
            onClick={() => onRide("ride-down")}
            disabled={mine.gear.elevator <= 0}
            style={{
              ...sheetButtonStyle(mine.gear.elevator > 0),
              width: "100%",
              marginTop: 12,
              minHeight: 48,
            }}
          >
            {mine.gear.elevator > 0
              ? `Auto ride to ${mine.gear.elevator}`
              : "Ride down (no rail)"}
          </button>
        </div>
      )}
      {stall.id === "warp" && (
        <div>
          <SheetRow
            icon={ITEM_ICONS.beacon}
            name={
              warpDestinationCount > 0
                ? `${warpDestinationCount} destination${warpDestinationCount > 1 ? "s" : ""} online`
                : "No planted beacons yet"
            }
            sub={
              warpDestinationCount > 0
                ? `Warpcoil range: ${warpRange(mine.gear)} rows for planted beacons. Biome portals are free.`
                : `Buy beacon kits at the Supply Depot. Warpcoil range: ${warpRange(mine.gear)} rows.`
            }
          />
          <div
            style={{
              display: "grid",
              gap: 8,
              marginTop: 12,
              maxHeight: 220,
              overflowY: "auto",
              paddingRight: 2,
            }}
          >
            {warpDestinationCount === 0 ? (
              <button
                type="button"
                disabled
                style={{
                  ...sheetButtonStyle(false),
                  width: "100%",
                  minHeight: 48,
                }}
              >
                Warp to beacon
              </button>
            ) : (
              <>
                {portals.map((portal) => (
                  <div
                    key={`portal:${portal.id}`}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 10,
                      border: `1px solid ${portal.color}`,
                      borderRadius: 12,
                      background: "rgba(17, 21, 31, 0.45)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <span style={{ fontWeight: 800 }}>{portal.name}</span>
                      <span style={{ opacity: 0.78, fontSize: "0.78rem" }}>
                        col {portal.col}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRide(portalWarpAction(portal.id))}
                      style={{
                        ...sheetButtonStyle(true),
                        width: "100%",
                        minHeight: 38,
                      }}
                    >
                      Portal
                    </button>
                  </div>
                ))}
                {beacons.map((beacon, index) => {
                  const draftKey = `${beacon.col},${beacon.row}`;
                  const fallbackName =
                    index === 0 ? "Newest beacon" : `Beacon ${index + 1}`;
                  const displayName = beacon.label ?? fallbackName;
                  const draft = beaconDrafts[draftKey] ?? beacon.label ?? "";
                  const cleanedDraft = normalizeBeaconLabel(draft);
                  const renameReady = cleanedDraft !== (beacon.label ?? "");
                  return (
                    <div
                      key={draftKey}
                      style={{
                        display: "grid",
                        gap: 8,
                        padding: 10,
                        border: "1px solid rgba(84, 224, 199, 0.18)",
                        borderRadius: 12,
                        background: "rgba(17, 21, 31, 0.45)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <span style={{ fontWeight: 800 }}>{displayName}</span>
                        <span style={{ opacity: 0.78, fontSize: "0.78rem" }}>
                          row {beacon.row}, col {beacon.col}
                          {beacon.inRange ? "" : " out of range"}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto auto",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <input
                          aria-label={`Rename ${fallbackName}`}
                          maxLength={BEACON_LABEL_MAX_LENGTH}
                          value={draft}
                          placeholder={fallbackName}
                          onChange={(event) =>
                            setBeaconDrafts((current) => ({
                              ...current,
                              [draftKey]: event.target.value,
                            }))
                          }
                          style={{
                            width: "100%",
                            minWidth: 0,
                            height: 38,
                            borderRadius: 10,
                            border: "1px solid #2c3a5c",
                            background: "rgba(12, 15, 23, 0.86)",
                            color: "#e6e8ee",
                            padding: "0 10px",
                            fontWeight: 700,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onRide(renameBeaconAction(beacon, cleanedDraft))
                          }
                          disabled={!renameReady}
                          style={{
                            ...sheetButtonStyle(renameReady),
                            minWidth: 64,
                            minHeight: 38,
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onRide(
                              `warp-down:${beacon.col},${beacon.row}` as MineAction,
                            )
                          }
                          disabled={!beacon.inRange}
                          style={{
                            ...sheetButtonStyle(beacon.inRange),
                            minWidth: 60,
                            minHeight: 38,
                          }}
                        >
                          Warp
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
      {shopNote && (
        <p style={{ margin: "12px 0 0", fontSize: "0.8rem", color: "#54e0c7" }}>
          {shopNote}
        </p>
      )}
    </section>
  );
}

function BunkerControlPanel({
  minerCol,
  minerRow,
  claimMode,
  panelOpen,
  preview,
  localBlockedCells,
  bankedBlockedCells,
  selectedPart,
  onSelectPart,
  onStartClaim,
  onCancelClaim,
  onOpenPanel,
  onDismissPanel,
  onClaim,
  onPlace,
  onRemove,
  onStartRaid,
  onFinishRaid,
}: {
  minerCol: number;
  minerRow: number;
  claimMode: boolean;
  panelOpen: boolean;
  preview: BunkerFootprint | null;
  localBlockedCells: readonly MineCoord[];
  bankedBlockedCells: readonly MineCoord[];
  selectedPart: BasePartId;
  onSelectPart: (partId: BasePartId) => void;
  onStartClaim: () => void;
  onCancelClaim: () => void;
  onOpenPanel: () => void;
  onDismissPanel: () => void;
  onClaim: () => void;
  onPlace: () => void;
  onRemove: () => void;
  onStartRaid: () => void;
  onFinishRaid: () => void;
}) {
  const status = useBunkerStore((s) => s.status);
  const bunker = useBunkerStore((s) => s.bunker);
  const inventory = useBunkerStore((s) => s.inventory);
  const activeRaid = useBunkerStore((s) => s.activeRaid);
  const player = useBunkerStore((s) => s.player);
  const lastReward = useBunkerStore((s) => s.lastRaidReward);
  const note = useBunkerStore((s) => s.note);
  const hasBunker = Boolean(bunker);
  const localBlockerCount = localBlockedCells.length;
  const bankedBlockerCount = bankedBlockedCells.length;
  const canClaim =
    !hasBunker &&
    status !== "loading" &&
    preview !== null &&
    localBlockerCount === 0 &&
    bankedBlockerCount === 0;
  const canBuild = hasBunker && !activeRaid;
  const compactLabel = hasBunker ? "Open bunker builder" : "Start bunker claim";
  const compactText = hasBunker ? "Bunker" : "Bunker claim";
  const openCompactPanel = hasBunker ? onOpenPanel : onStartClaim;
  const dismissPanel = hasBunker ? onDismissPanel : onCancelClaim;
  const levelProgressMax =
    player?.nextLevelXp === null
      ? DEFENSE_XP_PER_LEVEL
      : (player?.progressXp ?? 0) + (player?.neededXp ?? DEFENSE_XP_PER_LEVEL);
  const levelProgressValue =
    player?.nextLevelXp === null
      ? DEFENSE_XP_PER_LEVEL
      : (player?.progressXp ?? 0);
  const levelProgressPercent =
    levelProgressMax > 0
      ? Math.min(100, (levelProgressValue / levelProgressMax) * 100)
      : 0;
  useDismissControls(
    minerRow > 0 && (claimMode || (hasBunker && panelOpen)),
    dismissPanel,
  );

  if (minerRow <= 0) return null;

  if ((!hasBunker && !claimMode) || (hasBunker && !panelOpen)) {
    return (
      <button
        type="button"
        aria-label={compactLabel}
        onClick={openCompactPanel}
        style={{
          position: "absolute",
          left: 12,
          bottom: 154,
          zIndex: 8,
          minHeight: 42,
          borderRadius: 999,
          border: "1px solid #54e0c7",
          background: "rgba(14, 20, 28, 0.94)",
          boxShadow: "0 8px 22px rgba(0, 0, 0, 0.36)",
          color: "#54e0c7",
          fontWeight: 800,
          padding: "0 14px",
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        {compactText}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-label="Dismiss bunker builder"
        onClick={dismissPanel}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 7,
          border: 0,
          background: "transparent",
          pointerEvents: "auto",
          cursor: "default",
        }}
      />
      <section
        aria-label="Bunker builder"
        style={{
          position: "absolute",
          left: 12,
          bottom: 94,
          zIndex: 8,
          width: "min(360px, calc(100vw - 24px))",
          border: "1px solid #54e0c7",
          borderRadius: 12,
          background: "rgba(14, 20, 28, 0.94)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.42)",
          padding: 12,
          color: "#e6e8ee",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ color: "#54e0c7" }}>Bunker</strong>
          <span
            style={{ marginLeft: "auto", fontSize: "0.75rem", opacity: 0.7 }}
          >
            lv {player?.overallLevel ?? 1}
          </span>
        </div>
        <p style={{ margin: "6px 0 10px", fontSize: "0.78rem", opacity: 0.7 }}>
          {hasBunker
            ? `Cell ${minerCol}, ${minerRow}. Place parts on claimed cells. The outline has no collision.`
            : !preview
              ? "Dig deeper to fit a 7x5 claim. The top row cannot touch the surface."
              : localBlockerCount > 0
                ? `Clear ${localBlockerCount} red cell${localBlockerCount === 1 ? "" : "s"}. The miner's row counts.`
                : bankedBlockerCount > 0
                  ? "Return to the surface to bank this clearing, then come back to claim."
                  : "Ready to claim. This 7x5 space is clear and banked."}
        </p>
        {player && (
          <fieldset
            aria-label="Player level progress"
            style={{
              border: "1px solid rgba(84, 224, 199, 0.34)",
              borderRadius: 10,
              background: "rgba(84, 224, 199, 0.08)",
              padding: 8,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontSize: "0.76rem",
                fontWeight: 800,
              }}
            >
              <span>
                Player level {player.overallLevel}/{player.levelCap}
              </span>
              <span style={{ color: "#f5c542" }}>
                Beacon cap {player.beaconLimit}
              </span>
            </div>
            <div
              aria-hidden
              style={{
                height: 6,
                borderRadius: 999,
                background: "rgba(255, 255, 255, 0.12)",
                margin: "7px 0 5px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${levelProgressPercent}%`,
                  height: "100%",
                  background: "#54e0c7",
                }}
              />
            </div>
            <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.76 }}>
              {player.nextLevelXp === null
                ? `Defense XP ${player.defenseXp}. Level cap reached.`
                : `Defense XP ${levelProgressValue}/${levelProgressMax}. ${player.neededXp} XP to level ${player.overallLevel + 1}.`}
            </p>
          </fieldset>
        )}
        {lastReward && (
          <div
            role="alert"
            aria-label="Bunker battle result"
            style={{
              border: lastReward.survived
                ? "1px solid rgba(84, 224, 199, 0.42)"
                : "1px solid rgba(255, 107, 107, 0.5)",
              borderRadius: 10,
              background: lastReward.survived
                ? "rgba(84, 224, 199, 0.1)"
                : "rgba(255, 107, 107, 0.11)",
              padding: 8,
              marginBottom: 10,
              fontSize: "0.74rem",
            }}
          >
            <strong style={{ display: "block", marginBottom: 4 }}>
              {lastReward.survived ? "Defense survived" : "Defense failed"}
            </strong>
            {lastReward.survived ? (
              <span>
                +{lastReward.xpGained} defense XP, +{lastReward.vibesGained}{" "}
                vibes.
                {lastReward.leveledUp
                  ? ` Level ${lastReward.levelAfter} reached. Reward: beacon cap ${lastReward.beaconLimitAfter}.`
                  : ""}
                {lastReward.stampAwarded ? " First Defense stamp earned." : ""}
              </span>
            ) : (
              <span>No defense XP gained.</span>
            )}
          </div>
        )}
        {!hasBunker && (
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <button
              type="button"
              disabled={!canClaim}
              onClick={onClaim}
              style={{ ...sheetButtonStyle(canClaim), width: "100%" }}
            >
              Claim 7x5 bunker
            </button>
            <button
              type="button"
              onClick={onCancelClaim}
              style={{
                ...sheetButtonStyle(true),
                width: "100%",
                border: "1px solid #5b6680",
                background: "#20283a",
                color: "#cdd6ea",
              }}
            >
              Cancel claim
            </button>
          </div>
        )}
        {hasBunker && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 8,
                marginBottom: 10,
              }}
            >
              {BASE_PART_IDS.map((partId) => {
                const active = selectedPart === partId;
                return (
                  <button
                    key={partId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectPart(partId)}
                    style={{
                      minHeight: 42,
                      borderRadius: 10,
                      border: active
                        ? "1px solid #54e0c7"
                        : "1px solid #2c3a5c",
                      background: active
                        ? "rgba(84, 224, 199, 0.16)"
                        : "rgba(38, 48, 74, 0.55)",
                      color: active ? "#54e0c7" : "#cdd6ea",
                      fontWeight: 800,
                      fontSize: "0.76rem",
                      cursor: "pointer",
                    }}
                  >
                    {BASE_PART_CATALOG[partId].name} x{inventory[partId]}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <button
                type="button"
                disabled={!canBuild || inventory[selectedPart] <= 0}
                onClick={onPlace}
                style={sheetButtonStyle(
                  canBuild && inventory[selectedPart] > 0,
                )}
              >
                Place
              </button>
              <button
                type="button"
                disabled={!canBuild}
                onClick={onRemove}
                style={sheetButtonStyle(canBuild)}
              >
                Remove
              </button>
            </div>
            <button
              type="button"
              onClick={activeRaid ? onFinishRaid : onStartRaid}
              style={{
                ...sheetButtonStyle(true),
                width: "100%",
                marginTop: 8,
                border: "1px solid #ff6b6b",
                color: "#ffd9d9",
                background: "#3a1820",
              }}
            >
              {activeRaid ? "Check raid result" : "Start Clanker raid"}
            </button>
            {activeRaid && (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: "0.74rem",
                  color: "#f5c542",
                }}
              >
                {activeRaid.clankers.length} Clankers attacking for{" "}
                {activeRaid.durationSeconds} seconds.
              </p>
            )}
          </>
        )}
        {note && (
          <p
            style={{ margin: "8px 0 0", fontSize: "0.74rem", color: "#f5c542" }}
          >
            {note}
          </p>
        )}
      </section>
    </>
  );
}

export function MinePanel({ appRelease }: { appRelease: AppRelease }) {
  useMinePerformanceSampling(appRelease);
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const lastAction = useMineStore((s) => s.lastAction);
  const move = useMineStore((s) => s.move);
  const seed = useMineStore((s) => s.seed);
  const tripIndex = useMineStore((s) => s.tripIndex);
  const tripBaseDiff = useMineStore((s) => s.tripBaseDiff);
  const movesLength = useMineStore((s) => s.moves.length);
  const cashOut = useMineStore((s) => s.cashOut);
  const submitCashOut = useMineStore((s) => s.submitCashOut);
  const gear = useMineStore((s) => s.gear);
  const worldLoaded = useMineStore((s) => s.worldLoaded);
  const loadGear = useMineStore((s) => s.loadGear);
  const loadWorld = useMineStore((s) => s.loadWorld);
  const saveSlots = useMineStore((s) => s.saveSlots);
  const loadSaveSlots = useMineStore((s) => s.loadSaveSlots);
  const switchSaveSlot = useMineStore((s) => s.switchSaveSlot);
  const deleteSaveSlot = useMineStore((s) => s.deleteSaveSlot);
  const saveCurrentTrip = useMineStore((s) => s.saveCurrentTrip);
  const balance = useMineStore((s) => s.balance);
  const playerLevel = useMineStore((s) => s.playerLevel);
  const deepestDepth = useMineStore((s) => s.deepestDepth);
  const shopNote = useMineStore((s) => s.shopNote);
  const buyConsumable = useMineStore((s) => s.buyConsumable);
  const buyGearUpgrade = useMineStore((s) => s.buyGearUpgrade);
  const buyElevator = useMineStore((s) => s.buyElevator);
  const teleportToBase = useMineStore((s) => s.teleportToBase);
  const bunker = useBunkerStore((s) => s.bunker);
  const activeBunkerRaid = useBunkerStore((s) => s.activeRaid);
  const bunkerPlayer = useBunkerStore((s) => s.player);
  const loadBunker = useBunkerStore((s) => s.loadBunker);
  const claimBunker = useBunkerStore((s) => s.claimBunker);
  const buyBasePart = useBunkerStore((s) => s.buyBasePart);
  const placeBunkerPart = useBunkerStore((s) => s.placePart);
  const removeBunkerPart = useBunkerStore((s) => s.removePart);
  const moveBunkerPart = useBunkerStore((s) => s.movePart);
  const startBunkerRaid = useBunkerStore((s) => s.startRaid);
  const finishBunkerRaid = useBunkerStore((s) => s.finishRaid);
  const router = useRouter();
  const [dynamiteMenuOpen, setDynamiteMenuOpen] = useState(false);
  const [recoveryMenuOpen, setRecoveryMenuOpen] = useState(false);
  const [selectedDynamiteTier, setSelectedDynamiteTier] =
    useState<DynamiteTier>(1);
  const [abandonArmed, setAbandonArmed] = useState(false);
  const [collectMode, setCollectMode] = useState(false);
  const [collectSelection, setCollectSelection] = useState<string[]>([]);
  const [elevatorAutoDir, setElevatorAutoDir] = useState<
    "ride-down" | "ride-up" | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stampBookOpen, setStampBookOpen] = useState(false);
  const [saveSlotsOpen, setSaveSlotsOpen] = useState(false);
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
  const [baseReturnOpen, setBaseReturnOpen] = useState(false);
  const [baseReturnConfirm, setBaseReturnConfirm] = useState(false);
  const [baseReturnPending, setBaseReturnPending] = useState(false);
  const [teleportBurstKey, setTeleportBurstKey] = useState(0);
  const [mineSurfaceTip, setMineSurfaceTip] = useState<string | null>(null);
  const mineSurfaceTipRef = useRef<string | null>(null);
  const [bunkerClaimMode, setBunkerClaimMode] = useState(false);
  const [bunkerPanelOpen, setBunkerPanelOpen] = useState(true);
  const [selectedBasePart, setSelectedBasePart] =
    useState<BasePartId>("wall-panel");
  const [selectedBunkerPartCell, setSelectedBunkerPartCell] =
    useState<MineCoord | null>(null);
  const [bunkerPartDragTargetCell, setBunkerPartDragTargetCell] =
    useState<MineCoord | null>(null);
  // The column whose stall sheet is open. Standing on a stall no longer
  // auto-opens it: a prompt button appears and tapping it sets this.
  // Stepping off clears it, so walking by never pops the menu.
  const [openStallCol, setOpenStallCol] = useState<number | null>(null);
  // Touch players never see keyboard copy (matches the renderer's
  // coarse-pointer heuristic). False during SSR; set before paint.
  const [coarsePointer, setCoarsePointer] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsMenuRef = useRef<HTMLElement | null>(null);
  const baseReturnButtonRef = useRef<HTMLButtonElement | null>(null);
  const baseReturnMenuRef = useRef<HTMLElement | null>(null);
  const stallSheetRef = useRef<HTMLElement | null>(null);
  const dynamiteMenuRef = useRef<HTMLDivElement | null>(null);
  const recoveryMenuRef = useRef<HTMLDivElement | null>(null);
  const lastCashOutStateRef = useRef(cashOut.state);
  const lastShopNoteRef = useRef<string | null>(null);
  const lastGamepadZoomRef = useRef(0);
  const lastGamepadBagCloseRef = useRef(false);
  const directionActionRef = useRef<(dir: Direction) => boolean>(() => false);
  const directionCadenceRef =
    useRef<DirectionCadenceController<Direction> | null>(null);
  const upwardDigAwaitingReleaseRef = useRef(false);
  const lastAutoCashOutKeyRef = useRef<string | null>(null);
  const previousMinerRowRef = useRef(mine.miner.row);
  const lastBunkerPartTapRef = useRef<{ key: string; at: number } | null>(null);
  const bunkerPartDragStartRef = useRef<MineCoord | null>(null);
  const bunkerPartDragMovedRef = useRef(false);
  void tick;

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
        // The world first (it seeds the mine), then gear (which rebuilds
        // the trip over that world when levels differ).
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
    [loadWorld, loadGear, loadBunker],
  );

  useEffect(() => {
    let cancelled = false;
    void loadMineScene(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [loadMineScene]);

  useEffect(() => {
    setCoarsePointer(window.matchMedia?.("(pointer: coarse)").matches ?? false);
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

  useEffect(() => {
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
    };

    window.history.scrollRestoration = "manual";
    lockMineViewport();
    const frame = requestAnimationFrame(lockMineViewport);
    const timeout = window.setTimeout(lockMineViewport, 120);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
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
    if (event) playMineSfxEvent(event);
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

  const directionCadence = useCallback(() => {
    if (!directionCadenceRef.current) {
      directionCadenceRef.current = createDirectionCadenceController({
        clock: {
          now: () => Date.now(),
          setTimeout: (callback, delayMs) =>
            window.setTimeout(callback, delayMs),
          clearTimeout: (timer) => window.clearTimeout(timer),
        },
        onAction: (dir: Direction) => directionActionRef.current(dir),
      });
    }
    return directionCadenceRef.current;
  }, []);

  const performDirectionAction = useCallback(
    (dir: Direction): boolean => {
      if (!mineSceneReady) return false;
      if (elevatorAutoDir) return false;
      if (dir !== "up") {
        upwardDigAwaitingReleaseRef.current = false;
      } else if (upwardDigAwaitingReleaseRef.current) {
        return false;
      }
      const state = useMineStore.getState();
      const startCol = state.mine.miner.col;
      const startRow = state.mine.miner.row;
      state.move(dir);
      const result = useMineStore.getState().lastResult;
      if (
        dir === "up" &&
        result?.ok &&
        result.dugAt &&
        result.dugAt.col === startCol &&
        result.dugAt.row === startRow - 1 &&
        !result.laddered
      ) {
        upwardDigAwaitingReleaseRef.current = true;
      }
      return true;
    },
    [elevatorAutoDir, mineSceneReady],
  );

  directionActionRef.current = performDirectionAction;

  const fireDirection = useCallback(
    (dir: Direction) => {
      const repeatMs = actionRepeatMs(useMineStore.getState().mine.gear);
      directionCadence().press(dir, repeatMs);
    },
    [directionCadence],
  );

  const releaseDirection = useCallback((dir: Direction | null) => {
    directionCadenceRef.current?.release(dir);
    if (dir === null || dir === "up") {
      upwardDigAwaitingReleaseRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (mineSceneReady && !elevatorAutoDir && !creditsOpen) return;
    directionCadenceRef.current?.cancel();
  }, [creditsOpen, elevatorAutoDir, mineSceneReady]);

  useEffect(() => {
    return () => directionCadenceRef.current?.cancel();
  }, []);

  // Moving off the column closes any open sheet, so the menu never
  // follows the miner and a return shows the prompt, not the open sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: column is the reset trigger, not read in the body; dropping it would fire once and never re-close
  useEffect(() => {
    setOpenStallCol(null);
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
  }, [mine.miner.col]);

  const dismissFloatingMenus = useCallback(() => {
    setSettingsOpen(false);
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
    setOpenStallCol(null);
    setDynamiteMenuOpen(false);
    setRecoveryMenuOpen(false);
    setAbandonArmed(false);
  }, []);

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
      const dir = KEY_DIRECTIONS[event.key];
      if (!dir) return;
      event.preventDefault();
      if (creditsOpen) return;
      fireDirection(dir);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const dir = KEY_DIRECTIONS[event.key];
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
  }, [creditsOpen, fireDirection, releaseDirection]);

  const miner = mine.miner;
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
  const climbCost = returnEnergyCost(miner);
  // The climb estimate assumes a cleared shaft; warn with a margin so a
  // detour or two does not turn the warning into a lie (REQ-017).
  const batteryLow = miner.row > 0 && miner.energy < climbCost * 1.25 + 2;
  // Ladder budget for the same straight-home climb (REQ-020).
  const laddersNeeded = returnLadderNeed(mine);
  const ladderShort = miner.row > 0 && laddersNeeded > mine.consumables.ladder;
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
  const leftPlankEnabled = !elevatorAutoDir && canPlacePlank(mine, "left");
  const rightPlankEnabled = !elevatorAutoDir && canPlacePlank(mine, "right");
  const beaconRange = warpRange(mine.gear);
  const beaconDepthAllowed = miner.row <= beaconRange;
  const beaconButtonDisabled = !!elevatorAutoDir || !beaconDepthAllowed;
  const minerOnElevatorRail = miner.col === ELEVATOR_COL;
  const elevatorAvailable =
    mine.gear.elevator > 0 &&
    minerOnElevatorRail &&
    miner.row >= 0 &&
    miner.row <= mine.gear.elevator;
  const canRideElevatorDown =
    elevatorAvailable && miner.row < mine.gear.elevator;
  const canRideElevatorUp = elevatorAvailable && miner.row > 0;
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
    miner.row > 0 && !bunker && bunkerClaimMode
      ? (() => {
          const footprint = proposedBunkerFootprint(miner.col, miner.row);
          return footprint.row >= 1 ? footprint : null;
        })()
      : null;
  const bankedMineForClaim = useMemo(
    () => createMine(seed, DEFAULT_GEAR, NO_CONSUMABLES, tripBaseDiff),
    [seed, tripBaseDiff],
  );
  const localBlockedBunkerCells = useMemo(() => {
    void tick;
    return bunkerPreview
      ? bunkerCells(bunkerPreview).filter(
          ({ col, row }) => cellAt(mine, col, row)?.kind !== "empty",
        )
      : [];
  }, [bunkerPreview, mine, tick]);
  const bankedBlockedBunkerCells = useMemo(
    () =>
      bunkerPreview
        ? bunkerCells(bunkerPreview).filter(
            ({ col, row }) =>
              cellAt(bankedMineForClaim, col, row)?.kind !== "empty",
          )
        : [],
    [bankedMineForClaim, bunkerPreview],
  );

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
    if (bunker || miner.row <= 0) setBunkerClaimMode(false);
  }, [bunker, miner.row]);

  useEffect(() => {
    if (!bunker || !bunkerPanelOpen || activeBunkerRaid) {
      setSelectedBunkerPartCell(null);
      setBunkerPartDragTargetCell(null);
      return;
    }
    setSelectedBunkerPartCell((cell) => {
      if (!cell) return cell;
      return bunker.parts.some(
        (part) => part.col === cell.col && part.row === cell.row,
      )
        ? cell
        : null;
    });
  }, [activeBunkerRaid, bunker, bunkerPanelOpen]);

  const handleBunkerPartTap = useCallback(
    (cell: MineCoord) => {
      if (!bunker || activeBunkerRaid) return;
      if (selectedBunkerPartCell) {
        setSelectedBunkerPartCell(null);
        setBunkerPartDragTargetCell(null);
        lastBunkerPartTapRef.current = null;
        return;
      }
      const key = `${cell.col}:${cell.row}`;
      const now = Date.now();
      const last = lastBunkerPartTapRef.current;
      if (
        last &&
        last.key === key &&
        now - last.at <= BUNKER_PART_DOUBLE_TAP_MS
      ) {
        setSelectedBunkerPartCell(cell);
        setBunkerPartDragTargetCell(null);
        lastBunkerPartTapRef.current = null;
        return;
      }
      lastBunkerPartTapRef.current = { key, at: now };
    },
    [activeBunkerRaid, bunker, selectedBunkerPartCell],
  );

  const handleBunkerPartPointerDown = useCallback(
    (cell: MineCoord) => {
      if (!bunker || activeBunkerRaid || !selectedBunkerPartCell) return;
      if (
        selectedBunkerPartCell.col !== cell.col ||
        selectedBunkerPartCell.row !== cell.row
      ) {
        return;
      }
      bunkerPartDragStartRef.current = cell;
      bunkerPartDragMovedRef.current = false;
      setBunkerPartDragTargetCell(cell);
    },
    [activeBunkerRaid, bunker, selectedBunkerPartCell],
  );

  const handleBunkerDragTarget = useCallback(
    (cell: MineCoord) => {
      const start = bunkerPartDragStartRef.current;
      if (!bunker || !start) return;
      if (!containsBunkerCell(bunker.footprint, cell.col, cell.row)) return;
      if (cell.col !== start.col || cell.row !== start.row) {
        bunkerPartDragMovedRef.current = true;
      }
      setBunkerPartDragTargetCell(cell);
    },
    [bunker],
  );

  const handleBunkerDragEnd = useCallback(
    (cell: MineCoord) => {
      const start = bunkerPartDragStartRef.current;
      const moved = bunkerPartDragMovedRef.current;
      bunkerPartDragStartRef.current = null;
      bunkerPartDragMovedRef.current = false;
      setBunkerPartDragTargetCell(null);
      if (!bunker || !start) return;
      if (!moved) {
        setSelectedBunkerPartCell(null);
        return;
      }
      if (!containsBunkerCell(bunker.footprint, cell.col, cell.row)) return;
      if (cell.col === start.col && cell.row === start.row) return;
      setSelectedBunkerPartCell(cell);
      void moveBunkerPart(start.col, start.row, cell.col, cell.row).then(() => {
        const current = useBunkerStore.getState().bunker;
        const movedPartExists = current?.parts.some(
          (part) => part.col === cell.col && part.row === cell.row,
        );
        if (!movedPartExists) setSelectedBunkerPartCell(null);
      });
    },
    [bunker, moveBunkerPart],
  );

  const deselectBunkerPart = useCallback(() => {
    if (!selectedBunkerPartCell) return;
    setSelectedBunkerPartCell(null);
    setBunkerPartDragTargetCell(null);
    lastBunkerPartTapRef.current = null;
  }, [selectedBunkerPartCell]);

  const handleScreenPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!selectedBunkerPartCell) return;
      if (event.target instanceof HTMLCanvasElement) return;
      deselectBunkerPart();
    },
    [deselectBunkerPart, selectedBunkerPartCell],
  );

  useEffect(() => {
    if (!elevatorAutoDir) return;
    const atEnd =
      elevatorAutoDir === "ride-down"
        ? !minerOnElevatorRail || miner.row >= mine.gear.elevator
        : !minerOnElevatorRail || miner.row <= 0;
    if (atEnd || cashOut.state === "pending") {
      setElevatorAutoDir(null);
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
  ]);

  useEffect(() => {
    const previousRow = previousMinerRowRef.current;
    previousMinerRowRef.current = miner.row;
    if (cashOut.state === "pending") return;
    if (!(previousRow > 0 && miner.row === 0)) return;
    if (bankedCredits <= 0 && bankedPartsCount <= 0) return;
    const key = `${seed}:${tripIndex}:${movesLength}:${bankedCredits}:${bankedPartsCount}`;
    if (lastAutoCashOutKeyRef.current === key) return;
    lastAutoCashOutKeyRef.current = key;
    void submitCashOut();
  }, [
    bankedCredits,
    bankedPartsCount,
    cashOut.state,
    miner.row,
    movesLength,
    seed,
    submitCashOut,
    tripIndex,
  ]);

  const startElevatorRide = (dir: MineAction) => {
    setDynamiteMenuOpen(false);
    if (dir === "ride-down" || dir === "ride-up") {
      setElevatorAutoDir(dir);
      move(dir);
      return;
    }
    move(dir);
  };

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
                      : salvagedSupportCount > 0
                        ? `Salvaged ${salvagedSupportCount} pickup${salvagedSupportCount > 1 ? "s" : ""}. Scrap sells for ${salvagedSupportValue} vibes at surface.`
                        : lastResult?.ok && (lastResult.droppedFromBag ?? 0) > 0
                          ? `Dropped ${lastResult.droppedFromBag} ore from bag.`
                          : lastResult?.ok && (lastResult.dropped ?? 0) > 0
                            ? `${lastResult.dropped} ore dropped.`
                            : lastResult?.ok && lastResult.pickedUpBag
                              ? `Recovered bag: ${lastResult.pickedUpBag.value} vibes${lastResult.pickedUpBag.parts > 0 ? ` and ${lastResult.pickedUpBag.parts} part${lastResult.pickedUpBag.parts > 1 ? "s" : ""}` : ""}.`
                              : lastResult?.ok && (lastResult.pickedUp ?? 0) > 0
                                ? `Picked up ${lastResult.pickedUp} ore.`
                                : lastResult?.ok && (lastResult.vented ?? 0) > 0
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
    !elevatorAutoDir &&
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
  const bunkerCanvasEditing = Boolean(
    bunker && bunkerPanelOpen && !activeBunkerRaid,
  );
  const retryMineSceneLoad = () => {
    setMineCanvasKey((key) => key + 1);
    void loadMineScene();
  };
  const reportMineSceneError = (message: string) => {
    setMineSceneStatus("error");
    setMineSceneMessage(message || "The mine renderer failed to start.");
  };

  return (
    <div
      data-mine-shell="true"
      onPointerDownCapture={handleScreenPointerDown}
      style={mineShellStyle}
    >
      {mineSceneReady ? (
        <MineSceneErrorBoundary
          key={mineCanvasKey}
          onError={reportMineSceneError}
        >
          <MineCanvas
            zoom={cameraZoom}
            collectMode={collectMode}
            selectedSupportKeys={collectSelection}
            dynamitePreviewCells={selectedDynamitePreview}
            bunkerPreview={bunkerPreview}
            bunkerBlockedCells={localBlockedBunkerCells}
            bunker={bunker}
            activeBunkerRaid={activeBunkerRaid}
            selectedBunkerPartCell={selectedBunkerPartCell}
            bunkerPartDragTargetCell={bunkerPartDragTargetCell}
            onBunkerPartTap={handleBunkerPartTap}
            onBunkerPartPointerDown={handleBunkerPartPointerDown}
            onBunkerDragTarget={handleBunkerDragTarget}
            onBunkerDragEnd={handleBunkerDragEnd}
            onBunkerBackgroundTap={deselectBunkerPart}
            onToggleSupport={toggleCollectTarget}
          />
        </MineSceneErrorBoundary>
      ) : (
        <MineSceneBackdrop />
      )}
      {mineSceneStatus === "loading" && <MineSceneNotice status="loading" />}
      {mineSceneStatus === "error" && (
        <MineSceneNotice
          status="error"
          message={mineSceneMessage ?? undefined}
          onRetry={retryMineSceneLoad}
        />
      )}
      {batteryLow && (
        <div
          className="mine-battery-edge-warning"
          data-battery-edge-warning="true"
          aria-hidden="true"
        />
      )}
      {mineSceneReady &&
        !collectMode &&
        !bunkerCanvasEditing &&
        !creditsOpen && (
          <MineTouchControls
            onDirection={act}
            onReleaseDirection={releaseDirection}
            onZoomChange={adjustCameraZoom}
          />
        )}
      <StratumBanner row={miner.row} />
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
        onClose={() => setStampBookOpen(false)}
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
            top: 206,
            right: 14,
            zIndex: 7,
            width: 238,
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
          <ReleaseNotificationControl />
        </section>
      )}
      {baseReturn && (
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
      {/* Standing on a stall shows a prompt; the menu opens on tap, not
          on walk-by. Tapping again after close needs another tap. */}
      {stall && openStallCol !== miner.col && (
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
      {destination && (
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
      {portalHere && !activePortalHere && (
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
      {activePortalHere && (
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
        minerCol={miner.col}
        minerRow={miner.row}
        claimMode={bunkerClaimMode}
        panelOpen={bunkerPanelOpen}
        preview={bunkerPreview}
        localBlockedCells={localBlockedBunkerCells}
        bankedBlockedCells={bankedBlockedBunkerCells}
        selectedPart={selectedBasePart}
        onSelectPart={setSelectedBasePart}
        onStartClaim={() => {
          setBunkerPanelOpen(true);
          setBunkerClaimMode(true);
        }}
        onCancelClaim={() => setBunkerClaimMode(false)}
        onOpenPanel={() => setBunkerPanelOpen(true)}
        onDismissPanel={() => setBunkerPanelOpen(false)}
        onClaim={() => void claimBunker(miner.col, miner.row)}
        onPlace={() =>
          void placeBunkerPart(selectedBasePart, miner.col, miner.row)
        }
        onRemove={() => void removeBunkerPart(miner.col, miner.row)}
        onStartRaid={() => void startBunkerRaid()}
        onFinishRaid={() => void finishBunkerRaid()}
      />
      {stall && openStallCol === miner.col && (
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
          onBuyConsumable={(item, quantity) =>
            void buyConsumable(item, quantity)
          }
          onBuyBasePart={(partId, quantity) =>
            void buyBasePart(partId, quantity)
          }
          onBuyGear={(track) => void buyGearUpgrade(track)}
          onBuyElevator={() => void buyElevator()}
          onRide={startElevatorRide}
          onClose={() => setOpenStallCol(null)}
          sheetRef={stallSheetRef}
        />
      )}

      {/* Chip HUD (REQ-024): thin, glanceable, game-first. Data
          attributes are the stable test surface; copy can change. */}
      <section
        aria-label="Mine status"
        data-depth={miner.row}
        data-horizontal-distance={horizontalDistance}
        data-energy={miner.energy.toFixed(1)}
        data-ladders={mine.consumables.ladder}
        data-planks={mine.consumables.plank}
        data-banked={miner.bankedCredits}
        data-wallet={balance ?? ""}
        data-climb-ladders={laddersNeeded}
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

      {bagPanelOpen && (
        <div className="mine-bag-overlay">
          <button
            type="button"
            aria-label="Close bag"
            onClick={() => setBagPanelOpen(false)}
            className="mine-bag-backdrop"
          />
          <section
            id="mine-bag-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mine-bag-title"
            data-bag-variant="tool-satchel"
            data-bag-capacity={bagCapacity}
            data-bag-filled={carriedOreStackCount}
            data-bag-ore-count={carriedOreCount}
            data-bag-stack-limit={BAG_STACK_LIMIT}
            className="mine-bag-satchel"
          >
            <div className="mine-bag-handle" aria-hidden="true" />
            <div
              className="mine-bag-latch mine-bag-latch-left"
              aria-hidden="true"
            />
            <div
              className="mine-bag-latch mine-bag-latch-right"
              aria-hidden="true"
            />
            <div className="mine-bag-shell">
              <header className="mine-bag-lid" data-bag-lid="true">
                <div className="mine-bag-title-row">
                  <div>
                    <h2 id="mine-bag-title" className="mine-bag-title">
                      Bag {carriedOreStackCount}/{bagCapacity}
                    </h2>
                    <p className="mine-bag-summary">{bagDetails}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close bag"
                    onClick={() => setBagPanelOpen(false)}
                    className="mine-bag-close"
                  >
                    x
                  </button>
                </div>
                <div className="mine-bag-lid-pockets">
                  <div className="mine-bag-pocket">
                    <span>Stack slots</span>
                    <strong>
                      {carriedOreStackCount}/{bagCapacity}
                    </strong>
                  </div>
                  <div className="mine-bag-pocket">
                    <span>Ore chunks</span>
                    <strong>{carriedOreCount}</strong>
                  </div>
                  <div className="mine-bag-pocket">
                    <span>Scrap</span>
                    <strong>{miner.carriedSalvageCredits} vibes</strong>
                  </div>
                  <div className="mine-bag-pocket">
                    <span>Parts</span>
                    <strong>
                      {miner.carriedParts.length}
                      {miner.carriedParts.length === 1 ? " part" : " parts"}
                    </strong>
                  </div>
                </div>
              </header>
              <div className="mine-bag-fold" aria-hidden="true" />
              <div className="mine-bag-tray" data-bag-tray="true">
                <div
                  className="mine-bag-drop-controls"
                  data-bag-drop-controls="true"
                >
                  <button
                    type="button"
                    className="mine-bag-drop-button"
                    disabled={!canDropSelectedBagCells}
                    onClick={dropSelectedBagCells}
                  >
                    Drop selected
                    {selectedBagCount > 0 ? ` (${selectedBagCount})` : ""}
                  </button>
                  <button
                    type="button"
                    className="mine-bag-clear-button"
                    disabled={selectedBagCount === 0}
                    onClick={clearBagSelection}
                  >
                    Clear
                  </button>
                </div>
                <div data-bag-scroll="true" className="mine-bag-scroll">
                  <ol
                    aria-label="Bag cells"
                    data-bag-cells="true"
                    className="mine-bag-cells"
                  >
                    {bagCells.map((cell) => {
                      const selected = selectedBagCells.has(cell.key);
                      return (
                        <li
                          key={cell.key}
                          title={`${cell.name} x${cell.count}`}
                          data-ore={cell.id}
                          data-stack-count={cell.count}
                          data-stack-full={cell.full ? "true" : "false"}
                          data-selected={selected ? "true" : "false"}
                          className="mine-bag-cell mine-bag-cell-filled"
                          style={{
                            borderColor: cell.color,
                            background: `${cell.color}24`,
                            color: cell.color,
                          }}
                        >
                          <button
                            type="button"
                            className="mine-bag-cell-button"
                            aria-pressed={selected}
                            aria-label={`${selected ? "Unselect" : "Select"} ${cell.name} stack of ${cell.count} for dropping`}
                            onClick={() => toggleBagCell(cell.key)}
                          >
                            <span
                              className="mine-bag-resource-graphic"
                              data-resource-graphic="true"
                              aria-hidden="true"
                            >
                              <span className="mine-bag-resource-core">
                                {cell.label}
                              </span>
                            </span>
                            <span className="mine-bag-stack-count">
                              x{cell.count}
                            </span>
                            {cell.full && (
                              <span
                                className="mine-bag-stack-full-overlay"
                                data-stack-full-overlay="true"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                    {emptyBagCellKeys.map((key) => (
                      <li
                        key={key}
                        data-empty-cell="true"
                        className="mine-bag-cell mine-bag-cell-empty"
                      />
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {collectMode && (
        <section
          aria-label="Edit pickups"
          style={{
            position: "absolute",
            right: 12,
            bottom: 82,
            zIndex: 6,
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
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <span style={{ ...chipStyle, color: "#8b93a7" }}>
              {visibleSupports.length === 0
                ? "no visible pickups"
                : "tap visible pickups"}
            </span>
            <span style={{ ...chipStyle, color: "#54e0c7" }}>
              {`${selectedSupports.length} selected, scrap value: ${selectedSupportValue}`}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              aria-label="Confirm edit pickups"
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
              Pick up
            </button>
            <button
              type="button"
              aria-label="Cancel edit pickups"
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

      {/* Consumable cluster: thumb-reach icon buttons. Movement is the
          thumbstick (or WASD/arrows); the D-pad is gone. */}
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
          zIndex: 5,
        }}
      >
        <span
          className={ladderShort ? "mine-hud-chip-danger" : undefined}
          data-ladder-chip="true"
          style={{
            ...chipStyle,
            color: ladderShort ? "#ffe7e7" : "#8b93a7",
          }}
        >
          {ladderShort ? "!" : ""} &#129692; {mine.consumables.ladder}
          {ladderShort ? `/${laddersNeeded} needed` : ""}
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
          aria-label="Edit placed pickups"
          aria-pressed={collectMode}
          onClick={() => {
            setDynamiteMenuOpen(false);
            setRecoveryMenuOpen(false);
            setCollectMode((open) => !open);
          }}
          disabled={!collectMode && visibleSupports.length === 0}
          style={{
            ...iconButtonStyle,
            opacity: collectMode || visibleSupports.length > 0 ? 1 : 0.42,
            cursor:
              collectMode || visibleSupports.length > 0 ? "pointer" : "default",
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
            disabled={!!elevatorAutoDir}
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
            disabled={!!elevatorAutoDir}
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
                  if (!elevatorAutoDir) move("recall");
                }}
                disabled={
                  !!elevatorAutoDir ||
                  mine.consumables.rope <= 0 ||
                  miner.row === 0 ||
                  miner.row > currentRecallRange
                }
                style={{
                  ...sheetButtonStyle(
                    !elevatorAutoDir &&
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
                    move("abandon");
                  } else {
                    setAbandonArmed(true);
                  }
                }}
                disabled={!!elevatorAutoDir || miner.row === 0}
                style={{
                  ...sheetButtonStyle(!elevatorAutoDir && miner.row > 0),
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
              if (elevatorAutoDir) return;
              setDynamiteMenuOpen(false);
              setRecoveryMenuOpen(false);
              move("place-beacon");
            }}
            disabled={!!elevatorAutoDir}
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
                  if (!elevatorAutoDir) {
                    setRecoveryMenuOpen(false);
                    move("warp-home");
                  }
                }}
                disabled={!!elevatorAutoDir}
                style={iconButtonStyle}
              >
                &#127756;
              </button>
            )
          );
        })()}
        {canRideElevatorDown && (
          <button
            type="button"
            aria-label="Ride elevator down"
            onClick={() => {
              setRecoveryMenuOpen(false);
              startElevatorRide("ride-down");
            }}
            disabled={!!elevatorAutoDir}
            style={iconButtonStyle}
          >
            &#128727;&#11015;&#65039;
          </button>
        )}
        {canRideElevatorUp && (
          <button
            type="button"
            aria-label="Ride elevator up"
            onClick={() => {
              setRecoveryMenuOpen(false);
              startElevatorRide("ride-up");
            }}
            disabled={!!elevatorAutoDir}
            style={iconButtonStyle}
          >
            &#128727;&#11014;&#65039;
          </button>
        )}
      </section>

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
          {coarsePointer
            ? "drag anywhere to move"
            : "drag anywhere to move \u00b7 WASD works too"}
        </div>
      )}
    </div>
  );
}
