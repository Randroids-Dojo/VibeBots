"use client";

import { useEffect, useMemo, useState } from "react";
import {
  decodeDesignCode,
  designShareUrl,
  encodeDesignCode,
} from "@/lib/design-code";
import { validateDesign } from "@/sim/design";
import { useWorkshopStore } from "@/state/workshop-store";
import { panelStyle, pillStyle, STATUS } from "./workshop-ui";

/**
 * Share codes (G8): the current bot as a pasteable string and a link, and a
 * box to load someone else's. Needs no storage, so it renders in every
 * environment; the code is the design itself, validated on the way in.
 */
export function DesignShare() {
  const design = useWorkshopStore((s) => s.design);
  const loadDesign = useWorkshopStore((s) => s.loadDesign);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [draft, setDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const valid = validateDesign(design).ok;
  const code = useMemo(() => encodeDesignCode(design), [design]);
  const link = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : designShareUrl(window.location.origin, design),
    [design],
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (kind: "code" | "link") => {
    const text = kind === "code" ? code : link;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      // No clipboard permission: the code is on screen to select by hand.
      setCopied(null);
    }
  };

  const load = () => {
    const decoded = decodeDesignCode(draft);
    if (!decoded.ok) {
      setImportError(decoded.reason);
      setImported(null);
      return;
    }
    loadDesign(decoded.design);
    setImportError(null);
    setImported(decoded.design.name);
    setDraft("");
  };

  return (
    <section style={panelStyle} aria-label="Share">
      <h2 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>Share</h2>
      <p style={{ margin: "0 0 8px", fontSize: "0.74rem", opacity: 0.75 }}>
        {valid
          ? "This code is your whole bot. Anyone can paste it into their garage."
          : "Fix the inspection issues before sharing; a code that fails inspection will not load."}
      </p>
      <textarea
        readOnly
        aria-label="Share code"
        data-testid="share-code"
        value={code}
        rows={2}
        onFocus={(event) => event.currentTarget.select()}
        style={{
          width: "100%",
          boxSizing: "border-box",
          resize: "none",
          background: "#161b28",
          color: "#e6e8ee",
          border: "1px solid #344061",
          borderRadius: 6,
          padding: "6px 8px",
          fontFamily: "monospace",
          fontSize: "1rem",
          wordBreak: "break-all",
        }}
      />
      <div style={{ display: "flex", gap: 6, margin: "6px 0 12px" }}>
        <button
          type="button"
          style={pillStyle({ large: true, disabled: !valid })}
          disabled={!valid}
          onClick={() => copy("code")}
        >
          {copied === "code" ? "Copied" : "Copy code"}
        </button>
        <button
          type="button"
          style={pillStyle({ large: true, disabled: !valid })}
          disabled={!valid}
          onClick={() => copy("link")}
        >
          {copied === "link" ? "Copied" : "Copy link"}
        </button>
      </div>
      <label
        style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}
        htmlFor="design-share-import"
      >
        Load a code or link
      </label>
      <textarea
        id="design-share-import"
        data-testid="share-import"
        value={draft}
        rows={2}
        placeholder="VB1...."
        onChange={(event) => {
          setDraft(event.target.value);
          setImportError(null);
          setImported(null);
        }}
        style={{
          width: "100%",
          boxSizing: "border-box",
          resize: "none",
          background: "#161b28",
          color: "#e6e8ee",
          border: `1px solid ${importError ? STATUS.bad : "#344061"}`,
          borderRadius: 6,
          padding: "6px 8px",
          fontFamily: "monospace",
          fontSize: "1rem",
        }}
      />
      <div
        style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}
      >
        <button
          type="button"
          style={pillStyle({ large: true, primary: draft.trim().length > 0 })}
          onClick={load}
        >
          Load bot
        </button>
        {importError && (
          <span
            role="alert"
            data-testid="share-import-error"
            style={{ fontSize: "0.74rem", color: STATUS.bad }}
          >
            {importError}
          </span>
        )}
        {imported && (
          <span
            role="status"
            data-testid="share-import-ok"
            style={{ fontSize: "0.74rem", color: STATUS.good }}
          >
            Loaded {imported}. Rename it if you like.
          </span>
        )}
      </div>
    </section>
  );
}
