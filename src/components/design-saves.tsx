"use client";

import { useCallback, useEffect, useState } from "react";
import { type BotDesign, botDesignSchema } from "@/sim/design";
import { useWorkshopStore } from "@/state/workshop-store";

interface SavedDesign {
  id: string;
  name: string;
  design: unknown;
  updated_at: string;
}

type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

/**
 * Save/load panel for the player's designs. Hidden entirely when the
 * server reports storage unavailable (previews without secrets, CI).
 */
export function DesignSaves() {
  const design = useWorkshopStore((s) => s.design);
  const setName = useWorkshopStore((s) => s.setName);
  const loadDesign = useWorkshopStore((s) => s.loadDesign);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saves, setSaves] = useState<SavedDesign[]>([]);
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const [nameDraft, setNameDraft] = useState(design.name);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/designs");
      if (res.status === 503) {
        setAvailable(false);
        return;
      }
      if (!res.ok) {
        // Storage is configured; only the list failed. Keep the panel.
        setAvailable(true);
        return;
      }
      const body = await res.json();
      setAvailable(true);
      setSaves(body.designs ?? []);
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setNameDraft(design.name);
  }, [design.name]);

  if (available === false) return null;
  if (available === null) {
    return (
      <div
        className="workshop-sheet-loading"
        role="status"
        aria-label="Loading saved designs"
      >
        <span className="workshop-spinner" aria-hidden="true" />
      </div>
    );
  }

  const save = async () => {
    setStatus({ state: "saving" });
    try {
      const res = await fetch("/api/designs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ design }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus({
          state: "error",
          message: typeof body.error === "string" ? body.error : "save failed",
        });
        return;
      }
      setStatus({ state: "saved" });
      void refresh();
    } catch {
      setStatus({ state: "error", message: "save failed" });
    }
  };

  const load = (saved: SavedDesign) => {
    const parsed = botDesignSchema.safeParse(saved.design);
    if (!parsed.success) {
      setStatus({ state: "error", message: "saved design is corrupt" });
      return;
    }
    loadDesign(parsed.data as BotDesign);
    setStatus({ state: "idle" });
  };

  return (
    <section
      aria-label="Saved designs"
      style={{
        background: "rgba(17, 21, 31, 0.92)",
        border: "1px solid #26304a",
        borderRadius: 10,
        padding: 14,
      }}
    >
      <h2 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>Garage</h2>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          aria-label="Design name"
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => setName(nameDraft)}
          style={{
            flex: 1,
            minWidth: 0,
            background: "#161b28",
            color: "#e6e8ee",
            border: "1px solid #344061",
            borderRadius: 6,
            padding: "4px 8px",
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={status.state === "saving"}
        >
          {status.state === "saving" ? "Saving..." : "Save"}
        </button>
      </div>
      {status.state === "saved" && (
        <p style={{ margin: "0 0 6px", fontSize: "0.75rem", color: "#54e0c7" }}>
          saved to the garage
        </p>
      )}
      {status.state === "error" && (
        <p style={{ margin: "0 0 6px", fontSize: "0.75rem", color: "#ff6b6b" }}>
          {status.message}
        </p>
      )}
      {saves.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {saves.map((saved) => (
            <li key={saved.id} style={{ marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => load(saved)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#a3b1cc",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: "0.85rem",
                }}
              >
                {saved.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
