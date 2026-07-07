"use client";

import { memo, useRef } from "react";
import {
  DIALOG_BACKDROP_STYLE,
  DialogActionButton,
  dialogCardStyle,
  useFocusTrap,
} from "./dialog-primitives";
import { DismissibleDialogFrame } from "./dismissible-dialog-frame";

/**
 * Multi-device save conflict dialog (REQ-042): another device advanced the
 * cloud save while this one holds real trip progress. The run cannot be
 * merged; the player chooses between adopting the newer save (dropping this
 * run) and keeping the doomed run on screen. Dismissing the frame counts as
 * "keep playing" so an accidental backdrop tap never discards progress.
 */
export const SaveConflictPopup = memo(function SaveConflictPopup({
  open,
  onResolve,
}: {
  open: boolean;
  onResolve: (choice: "sync" | "keep") => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useFocusTrap(open, dialogRef);

  if (!open) return null;

  return (
    <DismissibleDialogFrame
      onDismiss={() => onResolve("keep")}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-conflict-title"
      aria-describedby="save-conflict-description"
      style={DIALOG_BACKDROP_STYLE}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        data-save-conflict-dialog
        style={dialogCardStyle(440)}
      >
        <h2 id="save-conflict-title" style={{ margin: 0, fontSize: "1.15rem" }}>
          Save updated on another device
        </h2>
        <p
          id="save-conflict-description"
          style={{ margin: "10px 0 14px", color: "#9aa6c4" }}
        >
          Your cloud save moved ahead while this run was in progress. Runs
          cannot be merged: sync now to load the newer save and discard this
          run, or keep playing knowing this run cannot be banked.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <DialogActionButton
            accent={{
              border: "#54e0c7",
              background: "#172b30",
              color: "#54e0c7",
            }}
            onClick={() => onResolve("sync")}
          >
            Sync now (discard this run)
          </DialogActionButton>
          <DialogActionButton
            accent={{
              border: "#72809b",
              background: "#1a2030",
              color: "#d8deec",
            }}
            onClick={() => onResolve("keep")}
          >
            Keep playing
          </DialogActionButton>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
});
