"use client";

import { memo, useRef } from "react";
import { DismissibleDialogFrame } from "./dismissible-dialog-frame";
import { AccountActionButton, useFocusTrap } from "./mine-account-popup";

/**
 * Multi-device save conflict dialog (REQ-042): another device advanced the
 * cloud save while this one holds real trip progress. The run cannot be
 * merged; the player chooses between adopting the newer save (dropping this
 * run) and keeping the doomed run on screen. Dismissing the frame counts as
 * "keep playing" so an accidental backdrop tap never discards progress.
 */
export const SaveConflictPopup = memo(function SaveConflictPopup({
  open,
  onSync,
  onKeep,
}: {
  open: boolean;
  onSync: () => void;
  onKeep: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useFocusTrap(open, dialogRef);

  if (!open) return null;

  return (
    <DismissibleDialogFrame
      onDismiss={onKeep}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-conflict-title"
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
        ref={dialogRef}
        tabIndex={-1}
        data-save-conflict-dialog
        style={{
          width: "min(440px, 100%)",
          borderRadius: 12,
          border: "1px solid #384564",
          background: "rgba(16, 20, 31, 0.98)",
          boxShadow: "0 18px 60px rgba(0, 0, 0, 0.58)",
          color: "#e6e8ee",
          padding: 18,
        }}
      >
        <h2 id="save-conflict-title" style={{ margin: 0, fontSize: "1.15rem" }}>
          Save updated on another device
        </h2>
        <p style={{ margin: "10px 0 14px", color: "#9aa6c4" }}>
          Your cloud save moved ahead while this run was in progress. Runs
          cannot be merged: sync now to load the newer save and discard this
          run, or keep playing knowing this run cannot be banked.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <AccountActionButton
            accent={{
              border: "#54e0c7",
              background: "#172b30",
              color: "#54e0c7",
            }}
            disabled={false}
            onClick={onSync}
          >
            Sync now (discard this run)
          </AccountActionButton>
          <AccountActionButton
            accent={{
              border: "#72809b",
              background: "#1a2030",
              color: "#d8deec",
            }}
            disabled={false}
            onClick={onKeep}
          >
            Keep playing
          </AccountActionButton>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
});
