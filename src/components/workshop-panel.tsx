"use client";

import { canRedo, canUndo } from "@randroids-dojo/vibekit";
import dynamic from "next/dynamic";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MatchEndInfo } from "@/components/arena-canvas";
import { BalanceReadout } from "@/components/balance-readout";
import { BenchPanel } from "@/components/bench-panel";
import { DesignSaves, prefetchDesigns } from "@/components/design-saves";
import { DesignShare } from "@/components/design-share";
import { buildDebrief, type DebriefAction } from "@/components/fight-debrief";
import { GearingPanel } from "@/components/gearing-panel";
import { MatchTeardownSheet } from "@/components/match-teardown";
import { StampBookPopup } from "@/components/mine-stamp-book-popup";
import { PartsShop, prefetchShop } from "@/components/parts-shop";
import { StampCollectAlert } from "@/components/stamp-collect-alert";
import { TechInspection } from "@/components/tech-inspection";
import {
  blockerCopy,
  budgetReading,
  fitCopy,
  meterFill,
  placementBlocker,
} from "@/components/workshop-budget";
import {
  clearWorkshopGuideDone,
  GUIDE_CARDS,
  GUIDED_PART_ID,
  GUIDED_START_DESIGN,
  type GuideStep,
  guideWheelCount,
  isWorkshopGuideDone,
  markWorkshopGuideDone,
  nextGuideStep,
} from "@/components/workshop-onboarding";
import { playWorkshopSfx } from "@/components/workshop-sfx";
import { panelStyle, pillStyle } from "@/components/workshop-ui";
import { PAINT_SWATCHES } from "@/lib/bot-paint";
import { decodeDesignCode } from "@/lib/design-code";
import { buzz, HAPTIC_MERGE, HAPTIC_REMOVE } from "@/lib/haptics";
import { BLUEPRINTS } from "@/sim/blueprints";
import { SIM_VERSION } from "@/sim/constants";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  MAX_PART_MERGE_LEVEL,
  NEUTRAL_BEHAVIOR,
  partInstanceDurability,
  partMergeLevel,
  validateDesign,
} from "@/sim/design";
import { designPartCounts, partInventoryCounts } from "@/sim/inventory";
import { REPLICA_OPPONENTS } from "@/sim/opponents";
import { PART_CATALOG, partMass } from "@/sim/parts";
import type { MatchTeardown } from "@/sim/telemetry";
import { enqueueStampAlertsFromResponse } from "@/state/stamp-alert-store";
import {
  BROWSE_CATEGORIES,
  CAROUSEL_PART_IDS,
  CORE_PART_IDS,
  carouselIdsFor,
  currentCoreId,
  planMergeSelectedPart,
  planRotateSelected,
  useWorkshopStore,
  validSlotsFor,
} from "@/state/workshop-store";

const WorkshopCanvas = dynamic(() => import("./workshop-canvas"), {
  ssr: false,
});
const ArenaCanvas = dynamic(() => import("./arena-canvas"), { ssr: false });

interface MatchRecordChip {
  wins: number;
  losses: number;
  draws: number;
}

type Verification =
  | { state: "idle" }
  | { state: "pending" }
  | {
      state: "done";
      agrees: boolean;
      hash: string;
      record: MatchRecordChip | null;
      /** The official teardown, when the server agreed on the fight. */
      teardown: MatchTeardown | null;
    }
  | { state: "error" };

type WorkshopInventory =
  | { state: "loading" }
  | { state: "sandbox" }
  | { state: "ready"; counts: Map<string, number> };

// One inspector pip per merge level, keyed by a stable id (never a bare
// array index). Length matches MAX_PART_MERGE_LEVEL.
const MERGE_PIP_IDS = ["i", "ii", "iii"] as const;

// The open menu's content is capped to this fraction of the viewport and
// scrolls past it, so the sheet stays short and leaves room above it for the
// bot and the part being browsed. Must match `max-height` on
// `.workshop-build-panels` in globals.css.
const MENU_MAX_VH = 0.3;

// Extra upward lift (viewport fraction) added on top of centering the bot when
// a real menu is open, so the whole composition (bot plus the part hanging
// below it) rises into the empty room above and clears the sheet.
const LIFT_BIAS = 0.1;

export function WorkshopPanel() {
  const design = useWorkshopStore((s) => s.design);
  // Captured at click time: the matchup identity is state, so nothing a
  // render does can reboot a running test fight.
  // The stamp alert opens the Stamp Book focused on the new stamp; the
  // workshop mounts its own copy of the book (the mine's lives in its
  // panel) so the alert behaves the same on every screen.
  const [stampBookFocusId, setStampBookFocusId] = useState<string | null>(null);
  const openStampBookAt = useCallback((achievementId: string) => {
    setStampBookFocusId(achievementId);
  }, []);
  const stampBook = (
    <StampBookPopup
      open={stampBookFocusId !== null}
      focusAchievementId={stampBookFocusId}
      onClose={() => setStampBookFocusId(null)}
    />
  );
  const [matchup, setMatchup] = useState<[BotDesign, BotDesign] | null>(null);
  const [endInfo, setEndInfo] = useState<MatchEndInfo | null>(null);
  // The debrief (G9) outlives the exhibition rerun: the arena replays the
  // fight after a linger and clears endInfo so a verdict never describes
  // the wrong run, but the lesson from the last finished fight stays on
  // screen until the player leaves the arena or takes a fix-it action.
  const [debriefInfo, setDebriefInfo] = useState<MatchEndInfo | null>(null);
  const [teardownOpen, setTeardownOpen] = useState(false);
  const [rivalState, setRivalState] = useState<
    "idle" | "pending" | "none" | "error"
  >("idle");
  const [verification, setVerification] = useState<Verification>({
    state: "idle",
  });
  const [inventory, setInventory] = useState<WorkshopInventory>({
    state: "loading",
  });
  const [tab, setTab] = useState<"build" | "tune" | "garage" | "shop">("build");
  // Perf: render the tab bar and sheet open immediately, but mount the tab's
  // (sometimes heavy, fetch-backed) content at lower priority so the toggle
  // never blocks on it. React keeps the previous tab's content mounted until
  // the deferred value catches up, so switching swaps in place without a
  // collapse or blink.
  const deferredTab = useDeferredValue(tab);
  // Build-tab toggle: off by default, so the carousel only offers parts the
  // player actually owns. On, it also offers parts not yet in the inventory.
  const [includeUnowned, setIncludeUnowned] = useState(false);
  // The fight roster opens from the thumb bar's Test fight button (G2); the
  // top bar carries only the bot's name, readiness, and budget meters.
  const [fightOpen, setFightOpen] = useState(false);
  // Bot-first sheet (N): the tab controls live in a bottom sheet over the bot.
  // Open/closed is one clean state. Tapping the active tab or the handle
  // toggles it; tapping another tab switches to it and keeps it open; dragging
  // the handle down closes and up opens, with the content sliding live under
  // the finger. Build lands closed so the bot and hero-drag band stay clear.
  const [sheetOpen, setSheetOpen] = useState(false);
  // While dragging, preview the slide with a transform: `dy` is the finger
  // travel and `h` the open content height measured at drag start.
  const [sheetDrag, setSheetDrag] = useState<{ dy: number; h: number } | null>(
    null,
  );
  // Lift the bot up in the canvas (O) by how much an open menu sheet covers,
  // so a tall menu (Garage/Tune/Shop) does not hide the bot behind it. Build
  // is excluded: its sheet is short and its hero-drag band must stay put.
  const [menuLift, setMenuLift] = useState(0);
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const fightMenuRef = useRef<HTMLDivElement | null>(null);
  const fightButtonRef = useRef<HTMLButtonElement | null>(null);
  const dragStripRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const removeHandleRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    y: number;
    dy: number;
    h: number;
    moved: boolean;
  } | null>(null);

  const contentHeight = () =>
    Math.min(
      panelsRef.current?.scrollHeight ?? 0,
      (window.innerHeight || 1) * MENU_MAX_VH,
    );

  // The whole top strip (grip + hint + tab row) is one drag surface, so a
  // finger anywhere on it can slide the sheet. Taps still fall through to the
  // grip (toggle) or a tab button (select); a drag sets this flag so the click
  // that a real pointer may fire afterward is swallowed.
  const suppressTapRef = useRef(false);

  const onSheetDragDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    suppressTapRef.current = false;
    dragRef.current = {
      pointerId: e.pointerId,
      y: e.clientY,
      dy: 0,
      h: 0,
      moved: false,
    };
  };
  const onSheetDragMove = (e: React.PointerEvent) => {
    const s = dragRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    s.dy = e.clientY - s.y;
    if (!s.moved && Math.abs(s.dy) > 8) {
      s.moved = true;
      s.h = contentHeight();
      // A synthetic pointerId (tests) is not a live pointer, so capture throws.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    }
    if (s.moved) {
      e.preventDefault();
      setSheetDrag({ dy: s.dy, h: s.h });
    }
  };
  const onSheetDragUp = (e: React.PointerEvent) => {
    const s = dragRef.current;
    dragRef.current = null;
    setSheetDrag(null);
    if (!s || s.pointerId !== e.pointerId) return;
    if (!s.moved) return; // a tap: the grip or tab button's onClick handles it
    suppressTapRef.current = true; // a drag: swallow the click that may follow
    if (sheetOpen && s.dy > 60)
      setSheetOpen(false); // drag down closes
    else if (!sheetOpen && s.dy < -60) setSheetOpen(true); // drag up opens
    // otherwise it snaps back to where it was
  };
  const onSheetDragCancel = () => {
    dragRef.current = null;
    setSheetDrag(null);
  };

  // Close the fight menu when a pointer goes down outside it (tap a tab, the
  // bot, anywhere). Actions inside the menu keep it open until they choose to
  // close (the fights navigate away and close it themselves).
  useEffect(() => {
    if (!fightOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!fightMenuRef.current?.contains(e.target as Node)) {
        setFightOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [fightOpen]);

  const toggleSheetTap = () => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    setSheetOpen((o) => !o);
  };

  // The thumb bar sits on the same drag surface as the tabs, so a drag
  // that starts on a thumb button slides the sheet; the click the browser
  // fires afterwards must not also undo, redo, flip Mirror, or open the
  // roster. Same rule the tabs and the grip use.
  const guardTap = (action: () => void) => () => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    action();
  };

  // Escape closes the fight roster and hands focus back to the button that
  // opened it (window dismissal rule), whether focus sits on the button or
  // on an item inside the roster.
  const closeRosterOnEscape = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || !fightOpen) return;
    event.preventDefault();
    setFightOpen(false);
    fightButtonRef.current?.focus();
  };

  const selectTab = (id: "build" | "tune" | "garage" | "shop") => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    // Tapping the active tab toggles the sheet; tapping another tab switches
    // to it and keeps the sheet open (switching never closes it).
    if (id === tab) setSheetOpen((o) => !o);
    else {
      setTab(id);
      setSheetOpen(true);
    }
  };

  useEffect(() => {
    // A test fight swaps this whole view out for the arena (the sheet and the
    // workshop canvas unmount), which strands the measure: the old
    // ResizeObserver fires as the panel leaves and pins the lift to 0. Skip
    // while a fight is up, then re-run when it ends so the panel is measured
    // fresh and the view-offset lift the open menu needs is restored.
    if (matchup) return;
    // Whenever the sheet is open (any tab, Build included), lift the bot and
    // its hero part into the space above the sheet so an open menu never
    // buries them; a taller menu covers more, so it lifts more. Collapsed, the
    // lift is 0, which keeps the Build hero-drag band exactly where it was.
    const measure = () => {
      if (!sheetOpen) {
        setMenuLift(0);
        return;
      }
      const panel = panelsRef.current;
      const vh = window.innerHeight || 1;
      // Handle, thumb bar, and tab row: everything that shows at the sheet top.
      const peekPx = dragStripRef.current?.offsetHeight ?? 148;
      const headerPx = 118; // compact top header the bot must stay clear of
      const contentPx = Math.min(panel?.scrollHeight ?? 0, vh * MENU_MAX_VH);
      // Center the bot in the band between the header and the open sheet top,
      // not in the whole upper area, so lifting never tucks it behind the
      // header.
      const centered = (peekPx + contentPx - headerPx) / (2 * vh);
      // The browsed part hangs below the bot, so centering the bot's pivot
      // leaves the composition bottom-heavy: empty room above, the part
      // crowding the sheet below. A real open menu (near the 30dvh cap) adds a
      // bias that lifts the whole thing up to use that room and clear the
      // sheet. A tiny sandbox sheet (centered ~0) gets no bias, so it never
      // floats the bot for an almost-empty sheet.
      const lift =
        centered < 0.08 ? Math.max(0, centered) : centered + LIFT_BIAS;
      setMenuLift(Math.min(0.3, lift));
    };
    measure();
    // Fetch-backed tabs (Garage/Shop) grow after their data loads, so a one
    // shot measure lands too small and leaves the bot behind the taller menu.
    // Re-measure whenever the panel actually resizes.
    const panel = panelsRef.current;
    if (!panel) return;
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    return () => ro.disconnect();
    // Re-runs on open/close and when a fight ends (the panel remounts); a tab
    // switch changes the panel's height, which the ResizeObserver catches, so
    // deferredTab is not needed as a dep here.
  }, [sheetOpen, matchup]);

  const refreshInventory = useCallback(async () => {
    try {
      const res = await fetch("/api/shop");
      if (res.status === 503) {
        setInventory({ state: "sandbox" });
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        inventory?: Array<{ part_id: string; count: number }>;
      };
      setInventory({
        state: "ready",
        counts: partInventoryCounts(data.inventory ?? []),
      });
    } catch {
      setInventory({ state: "sandbox" });
    }
  }, []);

  // Warm the fetch-backed tabs' caches on mount, so the first time the player
  // opens Shop or Garage the sheet shows their content immediately instead of
  // collapsing to a spinner and springing back (the tab-switch blink).
  useEffect(() => {
    void prefetchShop();
    void prefetchDesigns();
  }, []);

  // The guided first build (G6): null when not running, "done" once the
  // three steps have been demonstrated or skipped.
  const [guideStep, setGuideStep] = useState<GuideStep | null>(null);
  const browseTo = useWorkshopStore((s) => s.browseTo);
  const select = useWorkshopStore((s) => s.select);
  const setMirror = useWorkshopStore((s) => s.setMirror);

  // A shared link (G8): /workshop?code=VB1.... opens with that bot loaded,
  // then drops the code from the address bar so a reload does not reload it
  // over whatever the player built since. A bad code is ignored here; the
  // Garage's Load box is where a pasted code gets its error line. With no
  // link, a first-ever visit opens on the guided bot instead (G6): a shared
  // bot is its own first build, so a link also retires the guide.
  const loadDesignFromLink = useWorkshopStore((s) => s.loadDesign);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      const decoded = decodeDesignCode(code);
      if (decoded.ok) {
        loadDesignFromLink(decoded.design);
        markWorkshopGuideDone();
      }
      params.delete("code");
      const rest = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`,
      );
      return;
    }
    if (isWorkshopGuideDone()) return;
    loadDesignFromLink(GUIDED_START_DESIGN);
    setIncludeUnowned(true);
    browseTo(GUIDED_PART_ID);
    // Both axles glow and one drop fills both (F-241), so the guide turns
    // Mirror on; the thumb bar shows it pressed and the player can turn
    // it off like any setting.
    setMirror(true);
    setGuideStep("place");
  }, [loadDesignFromLink, browseTo, setMirror]);

  // Each step ends when the bench shows it done: the wheel placed, a fight
  // started, the Shop opened. The rule is pure (nextGuideStep) so the order
  // and the exits are unit tested; this effect only observes.
  const guideWheels = guideWheelCount(design);
  useEffect(() => {
    if (!guideStep || guideStep === "done") return;
    const next = nextGuideStep(guideStep, {
      wheelCount: guideWheels,
      fightStarted: matchup !== null,
      shopOpened: tab === "shop",
    });
    if (next === guideStep) return;
    setGuideStep(next);
    if (next === "done") markWorkshopGuideDone();
  }, [guideStep, guideWheels, matchup, tab]);

  const skipGuide = () => {
    setGuideStep("done");
    markWorkshopGuideDone();
  };

  const replayGuide = () => {
    clearWorkshopGuideDone();
    loadDesignFromLink(GUIDED_START_DESIGN);
    setIncludeUnowned(true);
    browseTo(GUIDED_PART_ID);
    setMirror(true);
    setTab("build");
    setSheetOpen(false);
    setGuideStep("place");
  };

  useEffect(() => {
    void refreshInventory();
    window.addEventListener("vibebots:parts-changed", refreshInventory);
    return () => {
      window.removeEventListener("vibebots:parts-changed", refreshInventory);
    };
  }, [refreshInventory]);

  const verifyOnServer = async () => {
    if (!matchup || !endInfo) return;
    setVerification({ state: "pending" });
    try {
      const res = await fetch("/api/match/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          designs: matchup,
          simVersion: SIM_VERSION,
          enforceInventory: inventory.state === "ready",
          inventoryDesignIndex: 1,
        }),
      });
      if (!res.ok) {
        setVerification({ state: "error" });
        return;
      }
      const official = await res.json();
      enqueueStampAlertsFromResponse(official);
      const agrees = official.hash === endInfo.hash;
      setVerification({
        state: "done",
        agrees,
        hash: official.hash,
        record: official.record ?? null,
        // Only adopt the server's teardown when the two runs agree on the
        // fight. On a mismatch the sheets describe different matches, and
        // showing the official one under a local banner would hide that.
        teardown: agrees ? (official.teardown ?? null) : null,
      });
    } catch {
      setVerification({ state: "error" });
    }
  };
  const selectedIid = useWorkshopStore((s) => s.selectedIid);
  const inspectNonce = useWorkshopStore((s) => s.inspectNonce);
  const browsePartId = useWorkshopStore((s) => s.browsePartId);
  const browseOrientation = useWorkshopStore((s) => s.browseOrientation);
  const browseBy = useWorkshopStore((s) => s.browseBy);
  const setBrowsableIds = useWorkshopStore((s) => s.setBrowsableIds);
  const rotateBrowse = useWorkshopStore((s) => s.rotateBrowse);
  const setBuildActive = useWorkshopStore((s) => s.setBuildActive);
  const setBrowseDimmed = useWorkshopStore((s) => s.setBrowseDimmed);
  const browseStatsOpen = useWorkshopStore((s) => s.browseStatsOpen);
  // One derived truth for the docked browse inspector: the raised hero
  // tray and the inspector render from the same condition (F-052).
  const browseInspectorDocked =
    tab === "build" && browseStatsOpen && !selectedIid;
  const setCore = useWorkshopStore((s) => s.setCore);
  const mirrorEnabled = useWorkshopStore((s) => s.mirrorEnabled);
  const toggleMirror = useWorkshopStore((s) => s.toggleMirror);
  const recenterView = useWorkshopStore((s) => s.recenterView);
  const mergePreviewLevel = useWorkshopStore((s) => s.mergePreviewLevel);
  const history = useWorkshopStore((s) => s.history);
  const removeSelected = useWorkshopStore((s) => s.removeSelected);
  const mergeSelectedPart = useWorkshopStore((s) => s.mergeSelectedPart);
  const rotateSelected = useWorkshopStore((s) => s.rotateSelected);
  const setBehavior = useWorkshopStore((s) => s.setBehavior);
  const setWeightClass = useWorkshopStore((s) => s.setWeightClass);
  const setPaint = useWorkshopStore((s) => s.setPaint);
  const undo = useWorkshopStore((s) => s.undo);
  const redo = useWorkshopStore((s) => s.redo);
  const reset = useWorkshopStore((s) => s.reset);
  const loadDesign = useWorkshopStore((s) => s.loadDesign);

  // The displayed part, its carousel, and drag-to-attach stay live on every
  // tab, not just Build, so the bench is always buildable. The hero lifts with
  // the bot when a menu covers the lower screen (menuLift).
  useEffect(() => {
    setBuildActive(true);
  }, [setBuildActive]);

  const validation = validateDesign(design);
  const behavior = design.behavior ?? NEUTRAL_BEHAVIOR;
  // Live budget (G2): the header meters read the same sums the inspection
  // does, and the reason line says why the part in hand cannot go on.
  const budget = budgetReading(design);
  const usedPartCounts = designPartCounts(design);

  // The carousel pool: with the toggle off (default) it is only the parts the
  // player owns; with it on, or when ownership is unknown (sandbox/loading), it
  // is every non-core part. Push it into the store so browseBy cycles the same
  // list and the shown part snaps back in when the filter removes it.
  const browseCategory = useWorkshopStore((s) => s.browseCategory);
  const setBrowseCategory = useWorkshopStore((s) => s.setBrowseCategory);
  const browsableIds = useMemo(() => {
    // The category chip narrows the family first (G4), then the owned
    // filter narrows to what the player has, so the two compose.
    const family = carouselIdsFor(browseCategory);
    if (includeUnowned || inventory.state !== "ready") return family;
    const counts = inventory.counts;
    return family.filter((id) => (counts.get(id) ?? 0) > 0);
  }, [browseCategory, includeUnowned, inventory]);
  useEffect(() => {
    setBrowsableIds(browsableIds);
  }, [browsableIds, setBrowsableIds]);
  const selectedPart = design.parts.find((p) => p.iid === selectedIid);
  const selectedDef = selectedPart ? PART_CATALOG[selectedPart.partId] : null;
  const selectedMergeLevel = selectedPart ? partMergeLevel(selectedPart) : 1;
  const selectedDurability =
    selectedPart && selectedDef ? partInstanceDurability(selectedPart) : null;
  // Any non-core part can be removed: removing one takes its whole subtree
  // with it, so a part with children is no longer a dead end.
  const selectedRemovable =
    selectedDef != null &&
    selectedDef.category !== "core" &&
    selectedIid !== null;
  const selectedMergePlan = planMergeSelectedPart(design, selectedIid);
  const selectedUsed = selectedPart
    ? (usedPartCounts.get(selectedPart.partId) ?? 0)
    : 0;
  const selectedOwned =
    inventory.state === "ready" && selectedPart
      ? (inventory.counts.get(selectedPart.partId) ?? 0)
      : 0;
  const selectedAvailableAfterUse =
    selectedPart && inventory.state === "ready"
      ? Math.max(0, selectedOwned - selectedUsed)
      : 0;
  const mergeInventoryAllows =
    inventory.state === "sandbox" ||
    (inventory.state === "ready" && selectedAvailableAfterUse > 0);
  const mergeEnabled = selectedMergePlan !== null && mergeInventoryAllows;

  // Chain cue (G7): a merge that leaves another merge available is the
  // best moment on the bench, so it gets its own beat: a brighter line in
  // the inspector and a three-note stinger, once per merge.
  const mergeNonce = useWorkshopStore((s) => s.mergeNonce);
  const [chainCue, setChainCue] = useState(false);
  const lastMergeNonce = useRef(mergeNonce);
  // The sound is chosen here too, once per merge from either path (the
  // inspector button or a drop onto a twin): the chain recipe already
  // carries the merge chime's notes, so playing both would stack them.
  useEffect(() => {
    if (mergeNonce === lastMergeNonce.current) return;
    lastMergeNonce.current = mergeNonce;
    playWorkshopSfx(mergeEnabled ? "chain" : "merge");
    if (!mergeEnabled) return;
    setChainCue(true);
    const timer = setTimeout(() => setChainCue(false), 1600);
    return () => clearTimeout(timer);
  }, [mergeNonce, mergeEnabled]);

  // Tapping a placed part focuses its stats: jump to the Build tab and open the
  // sheet so the selected-part panel (level, HP, Merge, Rotate) is on screen.
  // Keyed on the tap nonce, not selectedIid, so placing or merging a part while
  // building (which also selects it) never pops the sheet open mid-drag.
  useEffect(() => {
    if (inspectNonce === 0) return;
    setTab("build");
    setSheetOpen(true);
  }, [inspectNonce]);

  // The on-part remove handle (the X) is a DOM button floated over the canvas
  // at the selected part's projected screen point, which the scene publishes on
  // the canvas dataset each frame (it rides the camera view-offset lift, so the
  // X tracks the part exactly like the drag ghost does). A rAF loop positions
  // it without churning React state as the bench orbits.
  useEffect(() => {
    if (!selectedIid || !selectedRemovable) return;
    const btn = removeHandleRef.current;
    const canvas = stageRef.current?.querySelector("canvas");
    if (!btn || !canvas) return;
    const stage = stageRef.current;
    // The header card floats over the top of the stage; the handle never
    // rides up into it (F-242). Its bottom edge is measured once here and
    // again on resize (the card's height is fixed: the reason line always
    // renders and the chips live inside it), never per frame.
    let headerFloor = 0;
    const measure = () => {
      const header = headerRef.current;
      if (!header || !stage) return;
      const stageTop = stage.getBoundingClientRect().top;
      headerFloor = header.getBoundingClientRect().bottom - stageTop;
    };
    measure();
    window.addEventListener("resize", measure);
    let raf = 0;
    let wasClamped: boolean | null = null;
    const tick = () => {
      const x = Number.parseFloat(canvas.dataset.selectedScreenX ?? "");
      const y = Number.parseFloat(canvas.dataset.selectedScreenY ?? "");
      if (Number.isFinite(x) && Number.isFinite(y) && stage) {
        const yPx = y * stage.clientHeight;
        // Half the handle's height plus a small gap under the card.
        const minTop = headerFloor + 19;
        const clamped = yPx < minTop;
        btn.style.left = `${x * 100}%`;
        btn.style.top = `${clamped ? minTop : yPx}px`;
        // The attribute is for tests and styling; write it on change only.
        if (clamped !== wasClamped) {
          wasClamped = clamped;
          btn.dataset.clamped = clamped ? "true" : "false";
        }
        btn.style.visibility = "visible";
      } else {
        btn.style.visibility = "hidden";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [selectedIid, selectedRemovable]);

  // The build carousel (N1): one non-core part at a time, dragged onto the
  // bot to place or merge (tap-to-place was removed as redundant).
  const activeCoreId = currentCoreId(design);
  const browseDef = PART_CATALOG[browsePartId];
  // validSlotsFor validates one candidate design per free connector, so
  // the blocker is derived once per (design, part, orientation) rather
  // than on every panel render (sheet drags and flash timers re-render).
  const blocker = useMemo(
    () =>
      browseDef
        ? placementBlocker(design, browseDef, PART_CATALOG, browseOrientation)
        : null,
    [design, browseDef, browseOrientation],
  );
  const blockerKind = blocker?.kind ?? null;
  // Where the browsed part fits when nothing blocks it (F-243): the reason
  // line always shows one of the two, so the header never changes height.
  const openMounts = useMemo(
    () =>
      browseDef && !blocker
        ? validSlotsFor(design, browseDef, PART_CATALOG, browseOrientation)
            .length
        : 0,
    [design, browseDef, browseOrientation, blocker],
  );
  // The meter a blocked part would break flashes once when the block
  // appears (browsing to the part, or the bot changing under it), so the
  // refusal points at its own cause instead of a silent non-drop.
  const [flashMeter, setFlashMeter] = useState<"power" | "weight" | null>(null);
  // One key per (part, meter) so browsing to a second blocked part flashes
  // again even when both are blocked by the same meter.
  const flashKey =
    blockerKind === "power" || blockerKind === "weight"
      ? `${browsePartId}:${blockerKind}`
      : null;
  useEffect(() => {
    if (!flashKey) {
      // The block cleared (a part placed, a class changed): the meter must
      // not stay red past the timer the cleanup below cancels.
      setFlashMeter(null);
      return;
    }
    const meter = flashKey.endsWith(":power") ? "power" : "weight";
    setFlashMeter(meter);
    const timer = setTimeout(() => setFlashMeter(null), 900);
    return () => clearTimeout(timer);
  }, [flashKey]);
  const browseOwned =
    inventory.state === "ready" ? (inventory.counts.get(browsePartId) ?? 0) : 0;
  const browseUsed = usedPartCounts.get(browsePartId) ?? 0;
  const browseAvailable = Math.max(0, browseOwned - browseUsed);

  // Gray the hero part in the canvas when the shop says you own none to
  // place (P3, user feedback), so an unplaceable part reads as unavailable.
  // Sandbox and still-loading states never dim (ownership is unknown).
  // The guide's own wheel stays grabbable for a player who owns nothing
  // yet: the first drag is the tutorial, and inventory is enforced at match
  // resolve, exactly as it is for a loaded blueprint.
  const guidedPartInHand =
    guideStep === "place" && browsePartId === GUIDED_PART_ID;
  useEffect(() => {
    setBrowseDimmed(
      inventory.state === "ready" && browseAvailable <= 0 && !guidedPartInHand,
    );
  }, [inventory.state, browseAvailable, guidedPartInHand, setBrowseDimmed]);

  // Flash the owned-count when a place or merge spends a copy of the part
  // currently in hand (Slice B, user feedback), so the drop reads as
  // "consumed one" and not just a silent number change. Only the same
  // part's count dropping counts; cycling to a different part rebaselines
  // without flashing.
  const [countConsumed, setCountConsumed] = useState(false);
  const prevBrowse = useRef({ id: browsePartId, avail: browseAvailable });
  useEffect(() => {
    const prev = prevBrowse.current;
    const consumed = prev.id === browsePartId && browseAvailable < prev.avail;
    prevBrowse.current = { id: browsePartId, avail: browseAvailable };
    if (!consumed) return;
    setCountConsumed(true);
    const timer = setTimeout(() => setCountConsumed(false), 650);
    return () => clearTimeout(timer);
  }, [browsePartId, browseAvailable]);

  // The server reruns the same fight and is the authority (Q-003), so once
  // verification agrees, show its teardown instead of the local one.
  const shownTeardown =
    verification.state === "done" && verification.teardown
      ? { teardown: verification.teardown, official: true }
      : endInfo?.teardown
        ? { teardown: endInfo.teardown, official: false }
        : null;
  // The debrief (G9): the same inspection, folded into a headline and the
  // one or two lessons that decided the fight, each with a fix-it action.
  const debrief = useMemo(() => {
    if (!debriefInfo || !matchup) return null;
    // The official teardown when the server agreed on this very run,
    // else the local one from the run the debrief describes.
    const teardown =
      endInfo === debriefInfo && shownTeardown
        ? shownTeardown.teardown
        : debriefInfo.teardown;
    if (!teardown) return null;
    return buildDebrief({
      teardown,
      winner: debriefInfo.winner,
      reason: debriefInfo.reason,
      scores: debriefInfo.scores,
      me: 1,
      design: matchup[1],
      ownedPartIds:
        inventory.state === "ready"
          ? [...inventory.counts]
              .filter(([, count]) => count > 0)
              .map(([id]) => id)
          : undefined,
    });
  }, [debriefInfo, endInfo, matchup, shownTeardown, inventory]);
  // A fix-it button leaves the arena and lands the player on the fix.
  const applyDebriefAction = (action: DebriefAction) => {
    setMatchup(null);
    setEndInfo(null);
    setDebriefInfo(null);
    setVerification({ state: "idle" });
    setTeardownOpen(false);
    if (action.kind === "browse") {
      setTab("build");
      setIncludeUnowned(true);
      browseTo(action.partId);
      setSheetOpen(false);
      return;
    }
    if (action.kind === "select") {
      setTab("build");
      select(action.iid);
      setSheetOpen(true);
      return;
    }
    setTab("tune");
    setSheetOpen(true);
  };

  if (matchup) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
        <StampCollectAlert onOpenStampBook={openStampBookAt} />
        {stampBook}
        <ArenaCanvas
          designs={matchup}
          onMatchEnd={(info) => {
            // The exhibition loop reruns the fight; a verdict from the
            // previous run must not describe the new one.
            setEndInfo(info);
            setDebriefInfo(info);
            setVerification({ state: "idle" });
            setTeardownOpen(false);
          }}
          onMatchStart={() => {
            // The exhibition loop runs the fight back. A verdict and a
            // teardown from the previous run must not hang over the new one.
            setEndInfo(null);
            setVerification({ state: "idle" });
            setTeardownOpen(false);
          }}
        />
        {(endInfo || debriefInfo) && (
          <div
            style={{
              position: "absolute",
              top: 120,
              left: 20,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxWidth: 260,
            }}
          >
            {debrief && (
              <section
                className="fight-debrief"
                data-testid="fight-debrief"
                aria-label="Fight debrief"
              >
                <h3 className="fight-debrief-headline">{debrief.headline}</h3>
                {debrief.lessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="fight-debrief-lesson"
                    data-testid="debrief-lesson"
                    data-lesson={lesson.id}
                  >
                    <p>{lesson.text}</p>
                    {lesson.action && lesson.actionLabel && (
                      <button
                        type="button"
                        className="fight-debrief-fix"
                        onClick={() => {
                          const action = lesson.action;
                          if (action) applyDebriefAction(action);
                        }}
                      >
                        {lesson.actionLabel}
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
            {endInfo && (
              <>
                <button
                  type="button"
                  onClick={verifyOnServer}
                  disabled={verification.state === "pending"}
                  style={{
                    background: "#26304a",
                    color: "#e6e8ee",
                    border: "1px solid #344061",
                    borderRadius: 8,
                    padding: "8px 16px",
                    cursor: "pointer",
                  }}
                >
                  {verification.state === "pending"
                    ? "Asking the server..."
                    : "Verify result on server"}
                </button>
                {shownTeardown && (
                  <button
                    type="button"
                    data-testid="open-teardown"
                    aria-expanded={teardownOpen}
                    aria-controls="match-teardown-sheet"
                    onClick={() => setTeardownOpen((open) => !open)}
                    style={pillStyle({ large: true })}
                  >
                    {teardownOpen ? "Hide teardown" : "Teardown"}
                  </button>
                )}
                {verification.state === "done" && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: "0.8rem",
                      color: verification.agrees ? "#54e0c7" : "#ff6b6b",
                    }}
                  >
                    {verification.agrees
                      ? "Official result matches."
                      : "Mismatch: the server saw a different fight."}
                  </p>
                )}
                {verification.state === "done" && verification.record && (
                  <p
                    data-testid="match-record-chip"
                    style={{
                      margin: "4px 0 0",
                      fontSize: "0.8rem",
                      opacity: 0.85,
                    }}
                  >
                    Record: {verification.record.wins}W{" "}
                    {verification.record.losses}L {verification.record.draws}D
                  </p>
                )}
                {verification.state === "error" && (
                  <p
                    style={{ margin: 0, fontSize: "0.8rem", color: "#ff6b6b" }}
                  >
                    Verification request failed.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {teardownOpen && shownTeardown && (
          <MatchTeardownSheet
            teardown={shownTeardown.teardown}
            official={shownTeardown.official}
            onClose={() => setTeardownOpen(false)}
          />
        )}
        <button
          type="button"
          onClick={() => {
            setMatchup(null);
            setEndInfo(null);
            setDebriefInfo(null);
            setVerification({ state: "idle" });
            setTeardownOpen(false);
          }}
          style={{
            position: "absolute",
            top: 70,
            left: 20,
            background: "#26304a",
            color: "#e6e8ee",
            border: "1px solid #344061",
            borderRadius: 8,
            padding: "8px 16px",
            cursor: "pointer",
          }}
        >
          Back to build
        </button>
      </div>
    );
  }

  const tabs = [
    ["build", "Build"],
    ["tune", "Tune"],
    ["garage", "Garage"],
    ["shop", "Shop"],
  ] as const;

  return (
    <div className="workshop-stage" ref={stageRef}>
      <WorkshopCanvas menuLift={menuLift} />
      <StampCollectAlert onOpenStampBook={openStampBookAt} />
      {stampBook}

      {/* The on-part remove control: a single X floated over the selected part
          in the 3D view (positioned each frame by the effect above), so
          removing a part is one tap on the part itself instead of a button in
          a floating menu. Only non-core parts can be removed. */}
      {selectedIid && selectedRemovable && selectedDef && (
        <button
          type="button"
          ref={removeHandleRef}
          className="part-remove-handle"
          style={{ visibility: "hidden" }}
          aria-label={`Remove ${selectedDef.name}`}
          title="Remove this part and anything attached to it"
          onClick={() => {
            removeSelected();
            buzz(HAPTIC_REMOVE);
            playWorkshopSfx("remove");
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}

      {/* The carousel stays live on every tab. When a menu covers the lower
          screen the bot lifts, so the carousel lifts with it to stay clear. */}
      <section
        className={`carousel-overlay${
          menuLift > 0.05 ? " carousel-overlay-lifted" : ""
        }${browseInspectorDocked ? " carousel-overlay-raised" : ""}`}
        aria-label="Part carousel"
      >
        <div className="carousel-overlay-name" data-testid="carousel-part-name">
          {browseDef?.name ??
            (browseCategory === "all"
              ? "No parts owned"
              : `No ${BROWSE_CATEGORIES.find((c) => c.id === browseCategory)?.label.toLowerCase()} parts owned`)}
        </div>
        <div className="carousel-overlay-arrows">
          <button
            type="button"
            aria-label="Previous part"
            onClick={() => browseBy(-1)}
            className="carousel-arrow"
          >
            {"◀"}
          </button>
          <button
            type="button"
            aria-label="Next part"
            onClick={() => browseBy(1)}
            className="carousel-arrow"
          >
            {"▶"}
          </button>
        </div>
      </section>

      <header className="workshop-header" ref={headerRef}>
        <div className="workshop-header-row">
          <span className="workshop-header-title">
            {design.name}: {design.parts.length}{" "}
            {design.parts.length === 1 ? "part" : "parts"}
          </span>
          <button
            type="button"
            className={
              validation.ok
                ? "workshop-ready-chip workshop-ready-chip-ok"
                : "workshop-ready-chip workshop-ready-chip-bad"
            }
            data-testid="ready-chip"
            data-ready={validation.ok ? "true" : "false"}
            title="Open the tech inspection"
            onClick={() => {
              setTab("tune");
              setSheetOpen(true);
            }}
          >
            {validation.ok
              ? "valid"
              : `${validation.errors.length} ${
                  validation.errors.length === 1 ? "issue" : "issues"
                }`}
          </button>
        </div>
        <section className="workshop-meters" aria-label="Build budget">
          <div
            className={`workshop-meter${
              budget.overdrawn ? " workshop-meter-over" : ""
            }${flashMeter === "power" ? " workshop-meter-flash" : ""}`}
            data-meter="power"
            data-flash={flashMeter === "power" ? "true" : "false"}
            title="Power the parts and gearing draw against what the core supplies"
          >
            <span className="workshop-meter-label">Power</span>
            <span className="workshop-meter-track" aria-hidden="true">
              <span
                className="workshop-meter-fill"
                style={{
                  width: `${meterFill(budget.powerDraw, budget.powerSupply) * 100}%`,
                }}
              />
            </span>
            <span
              className="workshop-meter-value"
              data-testid="meter-power"
              data-draw={budget.powerDraw}
              data-supply={budget.powerSupply}
            >
              {budget.powerDraw}/{budget.powerSupply}
            </span>
          </div>
          <div
            className={`workshop-meter${
              budget.overweight ? " workshop-meter-over" : ""
            }${flashMeter === "weight" ? " workshop-meter-flash" : ""}`}
            data-meter="weight"
            data-flash={flashMeter === "weight" ? "true" : "false"}
            title={
              budget.declared
                ? `Mass against the declared ${budget.weightClass.name} ceiling`
                : `Mass against the ${budget.weightClass.name} ceiling, the lightest class this bot fits`
            }
          >
            <span className="workshop-meter-label">
              {budget.declared ? budget.weightClass.name : "Weight"}
            </span>
            <span className="workshop-meter-track" aria-hidden="true">
              <span
                className="workshop-meter-fill"
                style={{
                  width: `${meterFill(budget.mass, budget.massLimit) * 100}%`,
                }}
              />
            </span>
            <span
              className="workshop-meter-value"
              data-testid="meter-weight"
              data-mass={budget.mass.toFixed(2)}
              data-limit={budget.massLimit.toFixed(2)}
              data-class={budget.weightClass.id}
            >
              {budget.mass.toFixed(2)}/{budget.massLimit.toFixed(2)}
            </span>
          </div>
        </section>
        <p
          className={
            blocker
              ? "workshop-budget-reason"
              : "workshop-budget-reason workshop-budget-reason-ok"
          }
          data-testid="budget-reason"
          data-blocker={blocker?.kind ?? "none"}
          role="status"
        >
          {browseDef
            ? blocker
              ? blockerCopy(browseDef, blocker)
              : fitCopy(browseDef, openMounts)
            : "Pick a part below to see where it fits"}
        </p>
        {/* Category chips (G4): with a bigger catalog, one part at a time
            needs a family to step through. They are the header card's last
            row (F-243): a fixed offset under the card put them beneath it
            whenever the reason line showed. */}
        <div
          className="carousel-overlay-chips"
          role="toolbar"
          aria-label="Part family"
          data-testid="carousel-chips"
        >
          {BROWSE_CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={
                browseCategory === entry.id
                  ? "carousel-chip carousel-chip-active"
                  : "carousel-chip"
              }
              aria-pressed={browseCategory === entry.id}
              onClick={() => setBrowseCategory(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      <div
        className={`workshop-sheet${sheetOpen ? "" : " workshop-sheet-collapsed"}${
          sheetDrag ? " workshop-sheet-dragging" : ""
        }`}
        style={
          sheetDrag
            ? {
                transform: `translateY(${Math.max(
                  0,
                  Math.min(
                    sheetDrag.h,
                    (sheetOpen ? 0 : sheetDrag.h) + sheetDrag.dy,
                  ),
                )}px)`,
                transition: "none",
              }
            : undefined
        }
      >
        {/* One drag surface over the grip and the tab row: dragging anywhere
            on it slides the sheet, while taps still reach the grip button
            (toggle) or a tab button (select). */}
        <div
          className="workshop-sheet-drag"
          ref={dragStripRef}
          onPointerDown={onSheetDragDown}
          onPointerMove={onSheetDragMove}
          onPointerUp={onSheetDragUp}
          onPointerCancel={onSheetDragCancel}
        >
          <button
            type="button"
            className="workshop-sheet-handle"
            aria-label={
              sheetOpen
                ? "Hide the controls to see the bot"
                : "Show the workshop controls"
            }
            aria-expanded={sheetOpen}
            onClick={toggleSheetTap}
          >
            <span className="workshop-sheet-grip" />
            <span className="workshop-sheet-hint">
              {sheetOpen ? "▼ see bot" : "▲ controls"}
            </span>
          </button>

          {guideStep && guideStep !== "done" && (
            <div
              className="workshop-coach"
              role="status"
              data-testid="coach-card"
              data-step={guideStep}
            >
              <span className="workshop-coach-title">
                {GUIDE_CARDS[guideStep].title}
              </span>
              <span className="workshop-coach-line">
                {GUIDE_CARDS[guideStep].line}
              </span>
              <button
                type="button"
                className="workshop-coach-skip"
                onClick={guardTap(skipGuide)}
                title="Skip the guided first build"
              >
                Skip
              </button>
            </div>
          )}

          <div
            className="workshop-thumb-bar"
            role="toolbar"
            aria-label="Bot actions"
            data-testid="thumb-bar"
          >
            <button
              type="button"
              className="workshop-thumb-button"
              onClick={guardTap(undo)}
              disabled={!canUndo(history)}
              title="Undo the last change"
            >
              Undo
            </button>
            <button
              type="button"
              className="workshop-thumb-button"
              onClick={guardTap(redo)}
              disabled={!canRedo(history)}
              title="Redo the undone change"
            >
              Redo
            </button>
            <button
              type="button"
              className={
                mirrorEnabled
                  ? "workshop-thumb-button workshop-thumb-active"
                  : "workshop-thumb-button"
              }
              aria-pressed={mirrorEnabled}
              onClick={guardTap(toggleMirror)}
              title="Placing a part on a side mount also fills its mirror"
            >
              Mirror
            </button>
            <button
              type="button"
              className="workshop-thumb-button"
              aria-label="Recenter the view on the bot"
              title="Recenter the view"
              onClick={guardTap(recenterView)}
            >
              Recenter
            </button>
            <div className="workshop-fight-menu" ref={fightMenuRef}>
              <button
                type="button"
                ref={fightButtonRef}
                className="workshop-thumb-button workshop-thumb-primary"
                aria-haspopup="true"
                aria-expanded={fightOpen}
                aria-label="Test fight"
                disabled={!validation.ok}
                title={
                  validation.ok
                    ? "Pick an opponent for a test fight"
                    : "Fix the inspection issues first"
                }
                onClick={guardTap(() => setFightOpen((o) => !o))}
                onKeyDown={closeRosterOnEscape}
              >
                Test fight
              </button>
              {fightOpen && (
                <div
                  className="workshop-fight-menu-panel"
                  role="menu"
                  onKeyDown={closeRosterOnEscape}
                >
                  {REPLICA_OPPONENTS.map((opponent) => (
                    <button
                      key={opponent.id}
                      type="button"
                      role="menuitem"
                      className="workshop-fight-action"
                      onClick={() => {
                        setFightOpen(false);
                        setEndInfo(null);
                        setVerification({ state: "idle" });
                        setMatchup([opponent.design, design]);
                      }}
                      title={`${opponent.blurb} (in the style of ${opponent.inspiredBy})`}
                    >
                      Fight {opponent.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    className="workshop-fight-action"
                    onClick={() => {
                      setFightOpen(false);
                      setEndInfo(null);
                      setVerification({ state: "idle" });
                      setMatchup([CPU_BRAWLER_DESIGN, design]);
                    }}
                  >
                    Test fight vs Brawler
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="workshop-fight-action workshop-fight-rival"
                    onClick={async () => {
                      setEndInfo(null);
                      setVerification({ state: "idle" });
                      setRivalState("pending");
                      try {
                        const res = await fetch("/api/match/opponent");
                        if (!res.ok) {
                          setRivalState(res.status === 404 ? "none" : "error");
                          return;
                        }
                        const body = (await res.json()) as {
                          design: BotDesign;
                        };
                        setRivalState("idle");
                        setFightOpen(false);
                        setMatchup([body.design, design]);
                      } catch {
                        setRivalState("error");
                      }
                    }}
                    disabled={rivalState === "pending"}
                  >
                    {rivalState === "pending"
                      ? "Finding rival..."
                      : "Fight a rival"}
                  </button>
                  {rivalState === "none" && (
                    <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.7 }}>
                      No rival designs saved yet; fight the stock bots
                      meanwhile.
                    </p>
                  )}
                  {rivalState === "error" && (
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.72rem",
                        color: "#ff6b6b",
                      }}
                    >
                      Could not reach the rival ladder.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div
            className="workshop-tabs"
            role="tablist"
            aria-label="Workshop tabs"
          >
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => selectTab(id)}
                className={tab === id ? "workshop-tab-active" : undefined}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <aside
          ref={panelsRef}
          className="workshop-build-panels"
          aria-label="Workshop build controls"
          style={
            sheetDrag
              ? { maxHeight: sheetDrag.h, transition: "none" }
              : undefined
          }
        >
          {/* Content follows the deferred tab: React keeps the previous
              tab mounted until the next one is ready, so switching swaps
              content in place with no collapse/blink. Fetch-backed panels
              show their own inline spinner while loading. */}
          {deferredTab === "build" && (
            <>
              {mergePreviewLevel !== null && (
                <div
                  data-testid="merge-banner"
                  style={{
                    background: "#ffe08a",
                    color: "#0b0e14",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontWeight: 700,
                    textAlign: "center",
                    boxShadow: "0 0 16px rgba(255, 224, 138, 0.55)",
                  }}
                >
                  {`↑ Release to merge into Lv ${mergePreviewLevel}`}
                </div>
              )}

              {/* A tapped placed part shows its stats and build actions here in
                  the sheet, in place of the carousel browse details. Removal
                  lives on the on-part X, not a button in this panel. */}
              {selectedDef && selectedIid && (
                <section style={panelStyle} aria-label="Selected part">
                  <div className="inspector-head">
                    <span className="inspector-name">{selectedDef.name}</span>
                    <span className="inspector-level">
                      <span className="inspector-pips" aria-hidden="true">
                        {MERGE_PIP_IDS.map((pipId, i) => (
                          <span
                            key={`pip-${selectedIid}-${pipId}`}
                            className={
                              i < selectedMergeLevel
                                ? "inspector-pip inspector-pip-on"
                                : "inspector-pip"
                            }
                          />
                        ))}
                      </span>
                      Lv {selectedMergeLevel}
                    </span>
                  </div>
                  <p className="inspector-blurb">{selectedDef.blurb}</p>
                  <p className="inspector-stats" data-testid="selected-stats">
                    {`${selectedDef.category} · mass ${partMass(selectedDef).toFixed(2)} · ${selectedDef.powerDraw} power`}
                  </p>
                  {selectedDef.category !== "core" &&
                    selectedDurability !== null && (
                      <div className="inspector-durability">
                        <div
                          className="inspector-durability-fill"
                          style={{
                            width: `${Math.min(100, (selectedDurability / (selectedDef.durability * ((MAX_PART_MERGE_LEVEL + 1) / 2))) * 100)}%`,
                          }}
                        />
                        <span className="inspector-durability-text">
                          {Math.round(selectedDurability)} HP
                        </span>
                      </div>
                    )}
                  {chainCue && mergeEnabled && (
                    <p
                      className="inspector-chain"
                      data-testid="chain-cue"
                      role="status"
                    >
                      {`Merge again to Lv ${selectedMergeLevel + 1}`}
                    </p>
                  )}
                  <div className="inspector-actions">
                    <button
                      type="button"
                      onClick={rotateSelected}
                      disabled={
                        planRotateSelected(design, selectedIid) === null
                      }
                      title="Quarter-turn this part around its mount"
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        mergeSelectedPart();
                        buzz(HAPTIC_MERGE);
                      }}
                      disabled={!mergeEnabled}
                      title={
                        selectedMergePlan === null
                          ? "This part is already at max level"
                          : inventory.state === "loading"
                            ? "Checking inventory"
                            : inventory.state === "ready" &&
                                selectedAvailableAfterUse <= 0
                              ? "Needs another owned copy"
                              : undefined
                      }
                    >
                      {selectedMergeLevel >= MAX_PART_MERGE_LEVEL
                        ? "Max level"
                        : `Merge to Lv ${selectedMergeLevel + 1}`}
                    </button>
                  </div>
                </section>
              )}

              <section style={panelStyle} aria-label="Chassis">
                <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>
                  Chassis
                </h2>
                <div style={{ display: "flex", gap: 6 }}>
                  {CORE_PART_IDS.map((id) => {
                    const core = PART_CATALOG[id];
                    const active = activeCoreId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setCore(id)}
                        aria-pressed={active}
                        className={
                          active
                            ? "chassis-option chassis-active"
                            : "chassis-option"
                        }
                      >
                        {core.name.replace(" Core", "")}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section style={panelStyle} aria-label="Paint">
                <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>
                  Paint
                </h2>
                {(
                  [
                    ["primary", "Body"],
                    ["accent", "Trim"],
                  ] as const
                ).map(([channel, label]) => (
                  <div key={channel} className="paint-row">
                    <span className="paint-row-label">{label}</span>
                    <div
                      className="paint-swatches"
                      role="toolbar"
                      aria-label={`${label} paint`}
                    >
                      {PAINT_SWATCHES.map((swatch) => {
                        const pressed = design.paint?.[channel] === swatch.id;
                        return (
                          <button
                            key={swatch.id}
                            type="button"
                            className={
                              pressed
                                ? "paint-swatch paint-swatch-active"
                                : "paint-swatch"
                            }
                            style={{ background: swatch.hex }}
                            aria-label={`${label} paint ${swatch.name}`}
                            aria-pressed={pressed}
                            title={swatch.name}
                            onClick={() =>
                              setPaint({
                                primary: design.paint?.primary ?? "ember",
                                accent: design.paint?.accent ?? "slate",
                                [channel]: swatch.id,
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="mirror-toggle"
                  onClick={() => setPaint(undefined)}
                  disabled={!design.paint}
                  title="Back to every part's own finish"
                >
                  Clear paint
                </button>
              </section>

              <section style={panelStyle} aria-label="Parts">
                <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>
                  Parts
                </h2>
                <button
                  type="button"
                  className={
                    includeUnowned
                      ? "mirror-toggle mirror-active"
                      : "mirror-toggle"
                  }
                  aria-pressed={includeUnowned}
                  onClick={() => setIncludeUnowned((v) => !v)}
                  title="Show parts you have not bought yet in the carousel"
                >
                  {includeUnowned
                    ? "Carousel: all parts"
                    : "Carousel: owned only"}
                </button>
              </section>
            </>
          )}

          {deferredTab === "tune" && (
            <>
              <section style={panelStyle} aria-label="Design stats">
                <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>
                  Design stats
                </h2>
                {validation.ok ? (
                  <p style={{ margin: 0, fontSize: "0.8rem", opacity: 0.8 }}>
                    mass {validation.stats.totalMass.toFixed(2)}, power{" "}
                    {validation.stats.powerDraw}/{validation.stats.powerSupply}
                    <span style={{ color: "#54e0c7" }}> valid</span>
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 16,
                      fontSize: "0.8rem",
                      color: "#ff6b6b",
                    }}
                  >
                    {validation.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                )}
              </section>

              <TechInspection
                design={design}
                panelStyle={panelStyle}
                onSelectClass={setWeightClass}
              />

              <BalanceReadout panelStyle={panelStyle} design={design} />

              <GearingPanel design={design} panelStyle={panelStyle} />

              <section style={panelStyle} aria-label="Temperament">
                <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>
                  Temperament
                </h2>
                {(
                  [
                    ["aggression", "Aggression", "cautious", "relentless"],
                    ["flankBias", "Flanking", "hugs close", "swings wide"],
                    ["patience", "Patience", "brief resets", "long resets"],
                  ] as const
                ).map(([key, label, low, high]) => (
                  <label
                    key={key}
                    style={{
                      display: "block",
                      fontSize: "0.78rem",
                      marginBottom: 8,
                    }}
                  >
                    {label}
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={behavior[key]}
                      aria-label={`${label} slider`}
                      onChange={(event) =>
                        setBehavior({ [key]: Number(event.target.value) })
                      }
                      style={{ width: "100%", display: "block" }}
                    />
                    <span
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        opacity: 0.6,
                      }}
                    >
                      <span>{low}</span>
                      <span>{high}</span>
                    </span>
                  </label>
                ))}
              </section>

              <BenchPanel design={design} panelStyle={panelStyle} />
            </>
          )}

          {deferredTab === "garage" && (
            <>
              <section style={panelStyle} aria-label="Blueprints">
                <h2 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>
                  Blueprints
                </h2>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {BLUEPRINTS.map((bp) => (
                    <button
                      key={bp.id}
                      type="button"
                      className="blueprint-option"
                      onClick={() => loadDesign(bp.design)}
                    >
                      <span className="blueprint-label">{bp.label}</span>
                      <span className="blueprint-blurb">{bp.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>
              <DesignShare />
              <DesignSaves />
              <section style={panelStyle} aria-label="Danger zone">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={reset}>
                    Reset to starter bot
                  </button>
                  <button type="button" onClick={replayGuide}>
                    Replay the first build
                  </button>
                </div>
              </section>
            </>
          )}

          {deferredTab === "shop" && <PartsShop />}
        </aside>
      </div>

      {browseInspectorDocked && (
        <section className="workshop-inspector" aria-label="Part details">
          <div className="inspector-head">
            <span className="inspector-name">{browseDef.name}</span>
            {inventory.state === "ready" ? (
              <span
                data-testid="carousel-part-count"
                className={
                  countConsumed
                    ? "inspector-count count-consumed"
                    : "inspector-count"
                }
                style={{ color: browseAvailable > 0 ? "#54e0c7" : "#7f879a" }}
              >
                {`x${browseAvailable}`}
              </span>
            ) : null}
          </div>
          {/* What the part is for (G3), then its figures: the picker
              teaches the catalog one part at a time. */}
          <div className="inspector-copy">
            <p className="inspector-blurb">{browseDef.blurb}</p>
            <p className="inspector-stats">
              {`${browseDef.category} · mass ${partMass(browseDef).toFixed(2)} · ${browseDef.durability} HP · ${browseDef.powerDraw} power`}
            </p>
          </div>
          <div className="inspector-actions">
            <button
              type="button"
              onClick={rotateBrowse}
              aria-label={`Rotate mount, currently ${browseOrientation} degrees`}
              title="Turn how this part mounts (rigid mounts only)"
            >
              {`Rotate ${browseOrientation}°`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
