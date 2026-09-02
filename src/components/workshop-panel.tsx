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
import { GearingPanel } from "@/components/gearing-panel";
import { MatchTeardownSheet } from "@/components/match-teardown";
import { StampBookPopup } from "@/components/mine-stamp-book-popup";
import { PartsShop, prefetchShop } from "@/components/parts-shop";
import { StampCollectAlert } from "@/components/stamp-collect-alert";
import { TechInspection } from "@/components/tech-inspection";
import { playWorkshopSfx } from "@/components/workshop-sfx";
import { panelStyle, pillStyle } from "@/components/workshop-ui";
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
import { PART_CATALOG } from "@/sim/parts";
import type { MatchTeardown } from "@/sim/telemetry";
import { enqueueStampAlertsFromResponse } from "@/state/stamp-alert-store";
import {
  CAROUSEL_PART_IDS,
  CORE_PART_IDS,
  currentCoreId,
  planMergeSelectedPart,
  planRotateSelected,
  useWorkshopStore,
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
  // The top bar is a compact options menu: the bot actions (undo/redo, fights)
  // live in a dropdown so the bar stays a thin strip and leaves room for the
  // bot below it.
  const [actionsOpen, setActionsOpen] = useState(false);
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
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
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

  // Close the options menu when a pointer goes down outside it (tap a tab, the
  // bot, anywhere). Actions inside the menu keep it open until they choose to
  // close (the fights navigate away and close it themselves).
  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!actionsMenuRef.current?.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [actionsOpen]);

  const toggleSheetTap = () => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }
    setSheetOpen((o) => !o);
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
      const peekPx = 100; // handle + tab bar always showing at the sheet top
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
  const usedPartCounts = designPartCounts(design);

  // The carousel pool: with the toggle off (default) it is only the parts the
  // player owns; with it on, or when ownership is unknown (sandbox/loading), it
  // is every non-core part. Push it into the store so browseBy cycles the same
  // list and the shown part snaps back in when the filter removes it.
  const browsableIds = useMemo(() => {
    if (includeUnowned || inventory.state !== "ready") return CAROUSEL_PART_IDS;
    const counts = inventory.counts;
    return CAROUSEL_PART_IDS.filter((id) => (counts.get(id) ?? 0) > 0);
  }, [includeUnowned, inventory]);
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
    let raf = 0;
    const tick = () => {
      const x = Number.parseFloat(canvas.dataset.selectedScreenX ?? "");
      const y = Number.parseFloat(canvas.dataset.selectedScreenY ?? "");
      if (Number.isFinite(x) && Number.isFinite(y)) {
        btn.style.left = `${x * 100}%`;
        btn.style.top = `${y * 100}%`;
        btn.style.visibility = "visible";
      } else {
        btn.style.visibility = "hidden";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedIid, selectedRemovable]);

  // The build carousel (N1): one non-core part at a time, dragged onto the
  // bot to place or merge (tap-to-place was removed as redundant).
  const activeCoreId = currentCoreId(design);
  const browseDef = PART_CATALOG[browsePartId];
  const browseOwned =
    inventory.state === "ready" ? (inventory.counts.get(browsePartId) ?? 0) : 0;
  const browseUsed = usedPartCounts.get(browsePartId) ?? 0;
  const browseAvailable = Math.max(0, browseOwned - browseUsed);

  // Gray the hero part in the canvas when the shop says you own none to
  // place (P3, user feedback), so an unplaceable part reads as unavailable.
  // Sandbox and still-loading states never dim (ownership is unknown).
  useEffect(() => {
    setBrowseDimmed(inventory.state === "ready" && browseAvailable <= 0);
  }, [inventory.state, browseAvailable, setBrowseDimmed]);

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
        {endInfo && (
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
                style={{ margin: "4px 0 0", fontSize: "0.8rem", opacity: 0.85 }}
              >
                Record: {verification.record.wins}W {verification.record.losses}
                L {verification.record.draws}D
              </p>
            )}
            {verification.state === "error" && (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#ff6b6b" }}>
                Verification request failed.
              </p>
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
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}

      {/* Recenter (G1): one tap brings the view home to the front
          three-quarter with the whole bot in frame, after orbiting or after
          a tap has framed one part. Lives on the bench, not in a menu. */}
      <button
        type="button"
        className="workshop-recenter"
        aria-label="Recenter the view on the bot"
        title="Recenter the view"
        onClick={recenterView}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z M12 2.5v3 M12 18.5v3 M2.5 12h3 M18.5 12h3 M12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
        </svg>
        <span>Recenter</span>
      </button>

      {/* The carousel stays live on every tab. When a menu covers the lower
          screen the bot lifts, so the carousel lifts with it to stay clear. */}
      <section
        className={`carousel-overlay${
          menuLift > 0.05 ? " carousel-overlay-lifted" : ""
        }${browseInspectorDocked ? " carousel-overlay-raised" : ""}`}
        aria-label="Part carousel"
      >
        <div className="carousel-overlay-name" data-testid="carousel-part-name">
          {browseDef?.name ?? "No parts owned"}
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

      <header className="workshop-header">
        <span className="workshop-header-title">
          {design.name}: {design.parts.length}{" "}
          {design.parts.length === 1 ? "part" : "parts"}
          {validation.ok ? (
            <span style={{ color: "#54e0c7", marginLeft: 8 }}>valid</span>
          ) : (
            <span style={{ color: "#ff6b6b", marginLeft: 8 }}>
              {validation.errors.length}{" "}
              {validation.errors.length === 1 ? "issue" : "issues"}
            </span>
          )}
        </span>
        <div className="workshop-header-menu" ref={actionsMenuRef}>
          <button
            type="button"
            className="workshop-header-menu-button"
            aria-haspopup="true"
            aria-expanded={actionsOpen}
            aria-label="Bot actions"
            onClick={() => setActionsOpen((o) => !o)}
          >
            Actions
          </button>
          {actionsOpen && (
            <div className="workshop-header-menu-panel" role="menu">
              <div className="workshop-header-menu-row">
                <button
                  type="button"
                  role="menuitem"
                  onClick={undo}
                  disabled={!canUndo(history)}
                >
                  Undo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={redo}
                  disabled={!canRedo(history)}
                >
                  Redo
                </button>
              </div>
              {REPLICA_OPPONENTS.map((opponent) => (
                <button
                  key={opponent.id}
                  type="button"
                  role="menuitem"
                  className="workshop-fight-action"
                  onClick={() => {
                    setActionsOpen(false);
                    setEndInfo(null);
                    setVerification({ state: "idle" });
                    setMatchup([opponent.design, design]);
                  }}
                  disabled={!validation.ok}
                  title={
                    validation.ok
                      ? `${opponent.blurb} (in the style of ${opponent.inspiredBy})`
                      : "fix validity errors first"
                  }
                >
                  Fight {opponent.name}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="workshop-fight-action"
                onClick={() => {
                  setActionsOpen(false);
                  setEndInfo(null);
                  setVerification({ state: "idle" });
                  setMatchup([CPU_BRAWLER_DESIGN, design]);
                }}
                disabled={!validation.ok}
                title={validation.ok ? undefined : "fix validity errors first"}
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
                    const body = (await res.json()) as { design: BotDesign };
                    setRivalState("idle");
                    setActionsOpen(false);
                    setMatchup([body.design, design]);
                  } catch {
                    setRivalState("error");
                  }
                }}
                disabled={!validation.ok || rivalState === "pending"}
                title={validation.ok ? undefined : "fix validity errors first"}
              >
                {rivalState === "pending"
                  ? "Finding rival..."
                  : "Fight a rival"}
              </button>
              {rivalState === "none" && (
                <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.7 }}>
                  No rival designs saved yet; fight the stock bots meanwhile.
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
                        playWorkshopSfx("merge");
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
                <button
                  type="button"
                  className={
                    mirrorEnabled
                      ? "mirror-toggle mirror-active"
                      : "mirror-toggle"
                  }
                  aria-pressed={mirrorEnabled}
                  onClick={toggleMirror}
                  title="Placing a part on a side mount also fills its mirror"
                >
                  {mirrorEnabled ? "Mirror: on" : "Mirror: off"}
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
              <DesignSaves />
              <section style={panelStyle} aria-label="Danger zone">
                <button type="button" onClick={reset}>
                  Reset to starter bot
                </button>
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
          <p className="inspector-stats">
            {`${browseDef.category} · ${browseDef.durability} HP · ${browseDef.powerDraw} power`}
          </p>
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
