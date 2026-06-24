"use client";

import { useEffect, useState } from "react";
import type { SaveSlotSummary, SaveSlotsState } from "@/state/mine-store";
import { DismissibleDialogFrame } from "./dismissible-dialog-frame";

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

export function SaveSlotsPopup({
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
