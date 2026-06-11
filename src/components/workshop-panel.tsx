"use client";

import { canRedo, canUndo } from "@randroids-dojo/vibekit";
import dynamic from "next/dynamic";
import { validateDesign } from "@/sim/design";
import { PART_CATALOG } from "@/sim/parts";
import { planAddPart, useWorkshopStore } from "@/state/workshop-store";

const WorkshopCanvas = dynamic(() => import("./workshop-canvas"), {
  ssr: false,
});

const panelStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.92)",
  border: "1px solid #26304a",
  borderRadius: 10,
  padding: 14,
};

export function WorkshopPanel() {
  const design = useWorkshopStore((s) => s.design);
  const selectedIid = useWorkshopStore((s) => s.selectedIid);
  const history = useWorkshopStore((s) => s.history);
  const addPart = useWorkshopStore((s) => s.addPart);
  const removeSelected = useWorkshopStore((s) => s.removeSelected);
  const undo = useWorkshopStore((s) => s.undo);
  const redo = useWorkshopStore((s) => s.redo);
  const reset = useWorkshopStore((s) => s.reset);

  const validation = validateDesign(design);
  const selectedPart = design.parts.find((p) => p.iid === selectedIid);
  const selectedDef = selectedPart ? PART_CATALOG[selectedPart.partId] : null;
  const selectedRemovable =
    selectedDef &&
    selectedDef.category !== "core" &&
    selectedIid !== null &&
    !design.connections.some((c) => c.parentIid === selectedIid);

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
      <WorkshopCanvas />

      <aside
        style={{
          position: "absolute",
          top: 70,
          left: 20,
          width: 250,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <section style={panelStyle} aria-label="Part palette">
          <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>Parts</h2>
          {Object.values(PART_CATALOG)
            .filter((p) => p.category !== "core")
            .map((part) => {
              const free = planAddPart(design, part) !== null;
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
                  </span>
                  <button
                    type="button"
                    onClick={() => addPart(part.id)}
                    disabled={!free}
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
            <button type="button" onClick={reset}>
              Reset
            </button>
          </div>
          {selectedDef && (
            <p style={{ margin: "8px 0 0", fontSize: "0.8rem", opacity: 0.75 }}>
              selected: {selectedDef.name} ({selectedIid}), durability{" "}
              {selectedDef.durability}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
