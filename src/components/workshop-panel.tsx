"use client";

import { canRedo, canUndo } from "@randroids-dojo/vibekit";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchEndInfo } from "@/components/arena-canvas";
import { DesignSaves } from "@/components/design-saves";
import { PartsShop } from "@/components/parts-shop";
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
import { PART_CATALOG } from "@/sim/parts";
import {
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
    }
  | { state: "error" };

type WorkshopInventory =
  | { state: "loading" }
  | { state: "sandbox" }
  | { state: "ready"; counts: Map<string, number> };

const panelStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.92)",
  border: "1px solid #26304a",
  borderRadius: 10,
  padding: 14,
};

// One inspector pip per merge level, keyed by a stable id (never a bare
// array index). Length matches MAX_PART_MERGE_LEVEL.
const MERGE_PIP_IDS = ["i", "ii", "iii"] as const;

export function WorkshopPanel() {
  const design = useWorkshopStore((s) => s.design);
  // Captured at click time: the matchup identity is state, so nothing a
  // render does can reboot a running test fight.
  const [matchup, setMatchup] = useState<[BotDesign, BotDesign] | null>(null);
  const [endInfo, setEndInfo] = useState<MatchEndInfo | null>(null);
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
      setVerification({
        state: "done",
        agrees: official.hash === endInfo.hash,
        hash: official.hash,
        record: official.record ?? null,
      });
    } catch {
      setVerification({ state: "error" });
    }
  };
  const selectedIid = useWorkshopStore((s) => s.selectedIid);
  const browsePartId = useWorkshopStore((s) => s.browsePartId);
  const browseOrientation = useWorkshopStore((s) => s.browseOrientation);
  const browseBy = useWorkshopStore((s) => s.browseBy);
  const rotateBrowse = useWorkshopStore((s) => s.rotateBrowse);
  const setBuildActive = useWorkshopStore((s) => s.setBuildActive);
  const setBrowseDimmed = useWorkshopStore((s) => s.setBrowseDimmed);
  const browseStatsOpen = useWorkshopStore((s) => s.browseStatsOpen);
  const setCore = useWorkshopStore((s) => s.setCore);
  const mirrorEnabled = useWorkshopStore((s) => s.mirrorEnabled);
  const toggleMirror = useWorkshopStore((s) => s.toggleMirror);
  const mergePreviewLevel = useWorkshopStore((s) => s.mergePreviewLevel);
  const history = useWorkshopStore((s) => s.history);
  const removeSelected = useWorkshopStore((s) => s.removeSelected);
  const mergeSelectedPart = useWorkshopStore((s) => s.mergeSelectedPart);
  const rotateSelected = useWorkshopStore((s) => s.rotateSelected);
  const setBehavior = useWorkshopStore((s) => s.setBehavior);
  const undo = useWorkshopStore((s) => s.undo);
  const redo = useWorkshopStore((s) => s.redo);
  const reset = useWorkshopStore((s) => s.reset);
  const loadDesign = useWorkshopStore((s) => s.loadDesign);

  // The hero part belongs to the Build tab; leaving it hides the hero so it
  // does not hover over the bench while another tab is up.
  useEffect(() => {
    setBuildActive(tab === "build");
  }, [tab, setBuildActive]);

  const validation = validateDesign(design);
  const behavior = design.behavior ?? NEUTRAL_BEHAVIOR;
  const usedPartCounts = designPartCounts(design);
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

  if (matchup) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
        <ArenaCanvas
          designs={matchup}
          onMatchEnd={(info) => {
            // The exhibition loop reruns the fight; a verdict from the
            // previous run must not describe the new one.
            setEndInfo(info);
            setVerification({ state: "idle" });
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
            {verification.state === "done" && (
              <p
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: verification.agrees ? "#54e0c7" : "#ff6b6b",
                }}
              >
                {verification.agrees
                  ? `Official result matches (hash ${verification.hash.slice(0, 8)}...)`
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
        <button
          type="button"
          onClick={() => {
            setMatchup(null);
            setEndInfo(null);
            setVerification({ state: "idle" });
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
    <div className="workshop-stage">
      <WorkshopCanvas />

      {tab === "build" && (
        <section className="carousel-overlay" aria-label="Part carousel">
          <div
            className="carousel-overlay-name"
            data-testid="carousel-part-name"
          >
            {browseDef.name}
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
      )}

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
        <div className="workshop-header-actions">
          <button type="button" onClick={undo} disabled={!canUndo(history)}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo(history)}>
            Redo
          </button>
          <button
            type="button"
            onClick={() => {
              setEndInfo(null);
              setVerification({ state: "idle" });
              setMatchup([CPU_BRAWLER_DESIGN, design]);
            }}
            disabled={!validation.ok}
            title={validation.ok ? undefined : "fix validity errors first"}
            style={{
              background: validation.ok ? "#54e0c7" : "#161b28",
              color: validation.ok ? "#0b0e14" : "#5a6378",
              border: "1px solid #344061",
              borderRadius: 6,
              padding: "4px 12px",
              fontWeight: 600,
              cursor: validation.ok ? "pointer" : "not-allowed",
            }}
          >
            Test fight vs Brawler
          </button>
          <button
            type="button"
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
                setMatchup([body.design, design]);
              } catch {
                setRivalState("error");
              }
            }}
            disabled={!validation.ok || rivalState === "pending"}
            title={validation.ok ? undefined : "fix validity errors first"}
            style={{
              background: validation.ok ? "#7aa8ff" : "#161b28",
              color: validation.ok ? "#0b0e14" : "#5a6378",
              border: "1px solid #344061",
              borderRadius: 6,
              padding: "4px 12px",
              fontWeight: 600,
              cursor: validation.ok ? "pointer" : "not-allowed",
            }}
          >
            {rivalState === "pending" ? "Finding rival..." : "Fight a rival"}
          </button>
        </div>
        {rivalState === "none" && (
          <p style={{ margin: 0, fontSize: "0.78rem", opacity: 0.7 }}>
            No rival designs saved yet; fight the stock bots meanwhile.
          </p>
        )}
        {rivalState === "error" && (
          <p style={{ margin: 0, fontSize: "0.78rem", color: "#ff6b6b" }}>
            Could not reach the rival ladder.
          </p>
        )}
      </header>

      <div className="workshop-tabs" role="tablist" aria-label="Workshop tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={tab === id ? "workshop-tab-active" : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      <aside
        className="workshop-build-panels"
        aria-label="Workshop build controls"
      >
        {tab === "build" && (
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
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: "0.72rem",
                  opacity: 0.65,
                }}
              >
                Swapping the chassis starts a fresh build. Undo brings it back.
              </p>
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
          </>
        )}

        {tab === "tune" && (
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
              <p style={{ margin: 0, fontSize: "0.72rem", opacity: 0.65 }}>
                Bots fight on their own; temperament biases how this one does
                it.
              </p>
            </section>
          </>
        )}

        {tab === "garage" && (
          <>
            <section style={panelStyle} aria-label="Blueprints">
              <h2 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>
                Blueprints
              </h2>
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: "0.72rem",
                  opacity: 0.65,
                }}
              >
                Load a ready-made bot, then make it yours.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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

        {tab === "shop" && <PartsShop />}
      </aside>

      {selectedDef && selectedIid && (
        <section className="workshop-inspector" aria-label="Selected part">
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
          {selectedDef.category !== "core" && selectedDurability !== null && (
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
              disabled={planRotateSelected(design, selectedIid) === null}
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
            <button
              type="button"
              onClick={() => {
                removeSelected();
                buzz(HAPTIC_REMOVE);
              }}
              disabled={!selectedRemovable}
              title={
                selectedDef.category === "core"
                  ? "The core cannot be removed"
                  : "Remove this part and anything attached to it"
              }
            >
              Remove
            </button>
          </div>
        </section>
      )}

      {tab === "build" && browseStatsOpen && !selectedIid && (
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
