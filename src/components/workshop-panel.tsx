"use client";

import { canRedo, canUndo } from "@randroids-dojo/vibekit";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { MatchEndInfo } from "@/components/arena-canvas";
import { DesignSaves } from "@/components/design-saves";
import { SIM_VERSION } from "@/sim/constants";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  partInstanceDurability,
  partMergeLevel,
  validateDesign,
} from "@/sim/design";
import { designPartCounts, partInventoryCounts } from "@/sim/inventory";
import { PART_CATALOG } from "@/sim/parts";
import {
  planAddPart,
  planMergeSelectedPart,
  planRotateSelected,
  useWorkshopStore,
} from "@/state/workshop-store";

const WorkshopCanvas = dynamic(() => import("./workshop-canvas"), {
  ssr: false,
});
const ArenaCanvas = dynamic(() => import("./arena-canvas"), { ssr: false });

type Verification =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; agrees: boolean; hash: string }
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

export function WorkshopPanel() {
  const design = useWorkshopStore((s) => s.design);
  // Captured at click time: the matchup identity is state, so nothing a
  // render does can reboot a running test fight.
  const [matchup, setMatchup] = useState<[BotDesign, BotDesign] | null>(null);
  const [endInfo, setEndInfo] = useState<MatchEndInfo | null>(null);
  const [verification, setVerification] = useState<Verification>({
    state: "idle",
  });
  const [inventory, setInventory] = useState<WorkshopInventory>({
    state: "loading",
  });

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
      });
    } catch {
      setVerification({ state: "error" });
    }
  };
  const selectedIid = useWorkshopStore((s) => s.selectedIid);
  const history = useWorkshopStore((s) => s.history);
  const addPart = useWorkshopStore((s) => s.addPart);
  const removeSelected = useWorkshopStore((s) => s.removeSelected);
  const mergeSelectedPart = useWorkshopStore((s) => s.mergeSelectedPart);
  const rotateSelected = useWorkshopStore((s) => s.rotateSelected);
  const undo = useWorkshopStore((s) => s.undo);
  const redo = useWorkshopStore((s) => s.redo);
  const reset = useWorkshopStore((s) => s.reset);

  const validation = validateDesign(design);
  const usedPartCounts = designPartCounts(design);
  const selectedPart = design.parts.find((p) => p.iid === selectedIid);
  const selectedDef = selectedPart ? PART_CATALOG[selectedPart.partId] : null;
  const selectedMergeLevel = selectedPart ? partMergeLevel(selectedPart) : 1;
  const selectedDurability =
    selectedPart && selectedDef ? partInstanceDurability(selectedPart) : null;
  const selectedRemovable =
    selectedDef &&
    selectedDef.category !== "core" &&
    selectedIid !== null &&
    !design.connections.some((c) => c.parentIid === selectedIid);
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

  return (
    <div className="workshop-stage">
      <WorkshopCanvas />

      <aside
        className="workshop-build-panels"
        aria-label="Workshop build controls"
      >
        <section style={panelStyle} aria-label="Part palette">
          <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>Parts</h2>
          {Object.values(PART_CATALOG)
            .filter((p) => p.category !== "core")
            .map((part) => {
              const owned =
                inventory.state === "ready"
                  ? (inventory.counts.get(part.id) ?? 0)
                  : 0;
              const used = usedPartCounts.get(part.id) ?? 0;
              const available = Math.max(0, owned - used);
              const inventoryAllows =
                inventory.state === "sandbox" ||
                (inventory.state === "ready" && available > 0);
              const free =
                planAddPart(design, part) !== null && inventoryAllows;
              return (
                <div
                  key={part.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: "0.85rem" }}>
                    {part.name}
                    <span style={{ opacity: 0.5 }}> ({part.category})</span>
                    {inventory.state === "ready" ? (
                      <span
                        style={{
                          color: available > 0 ? "#54e0c7" : "#7f879a",
                        }}
                      >
                        {" "}
                        x{available}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => addPart(part.id)}
                    disabled={!free}
                    title={
                      inventory.state === "loading"
                        ? "Checking inventory"
                        : inventory.state === "ready" && available <= 0
                          ? "None owned"
                          : undefined
                    }
                    style={{
                      cursor: free ? "pointer" : "not-allowed",
                      background: free ? "#26304a" : "#161b28",
                      color: free ? "#e6e8ee" : "#5a6378",
                      border: "1px solid #344061",
                      borderRadius: 6,
                      padding: "3px 10px",
                    }}
                  >
                    Add
                  </button>
                </div>
              );
            })}
        </section>

        <section style={panelStyle} aria-label="Design stats">
          <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>
            {design.name}: {design.parts.length}{" "}
            {design.parts.length === 1 ? "part" : "parts"}
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

        <section style={panelStyle} aria-label="Actions">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={undo} disabled={!canUndo(history)}>
              Undo
            </button>
            <button type="button" onClick={redo} disabled={!canRedo(history)}>
              Redo
            </button>
            <button
              type="button"
              onClick={removeSelected}
              disabled={!selectedRemovable}
              title={selectedIid ? undefined : "select a part in the scene"}
            >
              Remove selected
            </button>
            <button
              type="button"
              onClick={mergeSelectedPart}
              disabled={!mergeEnabled}
              title={
                selectedIid === null
                  ? "select a part in the scene"
                  : selectedMergePlan === null
                    ? "selected part cannot merge"
                    : inventory.state === "loading"
                      ? "Checking inventory"
                      : inventory.state === "ready" &&
                          selectedAvailableAfterUse <= 0
                        ? "Needs another owned copy"
                        : undefined
              }
            >
              Merge selected
            </button>
            <button
              type="button"
              onClick={rotateSelected}
              disabled={planRotateSelected(design, selectedIid) === null}
              title="quarter-turn the selected part around its mount"
            >
              Rotate
            </button>
            <button type="button" onClick={reset}>
              Reset
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
          </div>
          {selectedDef && (
            <p style={{ margin: "8px 0 0", fontSize: "0.8rem", opacity: 0.75 }}>
              selected: {selectedDef.name} ({selectedIid}), level{" "}
              {selectedMergeLevel}, durability {selectedDurability}/
              {selectedDef.durability}
            </p>
          )}
        </section>

        <DesignSaves />
      </aside>
    </div>
  );
}
