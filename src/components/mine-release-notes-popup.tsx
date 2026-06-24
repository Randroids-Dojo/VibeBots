"use client";

import { useEffect, useState } from "react";
import type { AppRelease } from "@/lib/app-release-types";
import { DismissibleDialogFrame } from "./dismissible-dialog-frame";

const RELEASE_LAST_PLAYED_KEY = "vibebots-last-played-app-version";
const RELEASE_LAST_PLAYED_BUILD_KEY = "vibebots-last-played-app-build";
const RELEASE_DISMISSED_KEY = "vibebots-release-notes-dismissed-id";
const RELEASE_PENDING_FROM_BUILD_KEY = "vibebots-release-notes-from-build";

type ReleaseNoteContent = {
  intro: string | null;
  items: string[];
  sections: Array<{
    version: string;
    date: string;
    title: string;
    intro: string | null;
    items: string[];
  }>;
};

function storedBuild(key: string): number | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function releaseHistoryContent(release: AppRelease): ReleaseNoteContent {
  const notes = release.notes.length > 0 ? release.notes : [];
  return {
    intro: "Newest first. All shipped notes are kept here.",
    items: [],
    sections: notes.map((note) => ({
      version: note.version,
      date: note.date,
      title: note.title,
      intro: note.intro ?? null,
      items:
        note.changes.length > 0
          ? note.changes.map((change) => change.text)
          : ["Fresh build deployed."],
    })),
  };
}

export function ReleaseNotesPopup({
  release,
  manualOpenCount,
  onVisibleChange,
}: {
  release: AppRelease;
  manualOpenCount: number;
  onVisibleChange?: (visible: boolean) => void;
}) {
  const [content, setContent] = useState<ReleaseNoteContent>({
    intro: null,
    items: [],
    sections: [],
  });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [onVisibleChange, visible]);

  useEffect(() => {
    if (manualOpenCount <= 0) return;
    setContent(releaseHistoryContent(release));
    setVisible(true);
  }, [manualOpenCount, release]);

  useEffect(() => {
    const lastPlayed = localStorage.getItem(RELEASE_LAST_PLAYED_KEY);
    const dismissed = localStorage.getItem(RELEASE_DISMISSED_KEY);
    const lastPlayedBuild = storedBuild(RELEASE_LAST_PLAYED_BUILD_KEY);
    let fromBuild = storedBuild(RELEASE_PENDING_FROM_BUILD_KEY);

    if (lastPlayed && lastPlayed !== release.version) {
      fromBuild = lastPlayedBuild;
      if (fromBuild !== null) {
        localStorage.setItem(RELEASE_PENDING_FROM_BUILD_KEY, String(fromBuild));
      } else {
        localStorage.removeItem(RELEASE_PENDING_FROM_BUILD_KEY);
      }
    }

    if (lastPlayed !== release.version) {
      localStorage.setItem(RELEASE_LAST_PLAYED_KEY, release.version);
      if (release.build !== null) {
        localStorage.setItem(
          RELEASE_LAST_PLAYED_BUILD_KEY,
          String(release.build),
        );
      } else {
        localStorage.removeItem(RELEASE_LAST_PLAYED_BUILD_KEY);
      }
    }

    if (dismissed === release.noticeId) return;
    if (!lastPlayed && !release.showToAll) return;

    const unseen = release.showToAll
      ? release.changes.map((change) => change.text)
      : release.changes
          .filter(
            (change) =>
              fromBuild === null ||
              change.build === null ||
              change.build > fromBuild,
          )
          .slice(0, 4)
          .map((change) => change.text);
    setContent({
      intro: release.intro ?? null,
      items: unseen.length > 0 ? unseen : ["Fresh build deployed."],
      sections: [],
    });
    setVisible(true);
  }, [release]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(RELEASE_DISMISSED_KEY, release.noticeId);
    localStorage.removeItem(RELEASE_PENDING_FROM_BUILD_KEY);
    setVisible(false);
  };

  return (
    <DismissibleDialogFrame
      onDismiss={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-notes-title"
      data-app-version={release.version}
      data-release-note-id={release.noticeId}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.58)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 360px)",
          border: "1px solid #54e0c7",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.97)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.52)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <h2
            id="release-notes-title"
            style={{
              margin: 0,
              flex: 1,
              color: "#54e0c7",
              fontSize: "1.02rem",
              lineHeight: 1.2,
            }}
          >
            New in VibeBots
          </h2>
          <span
            style={{
              color: "#8b93a7",
              fontSize: "0.72rem",
              fontWeight: 700,
            }}
          >
            v{release.version}
          </span>
        </header>
        {content.intro && (
          <p
            style={{
              margin: "0 0 12px",
              color: "#dce5f7",
              fontSize: "0.9rem",
              lineHeight: 1.35,
            }}
          >
            {content.intro}
          </p>
        )}
        {content.sections.length > 0 ? (
          <section
            aria-label="Release notes"
            style={{
              display: "grid",
              gap: 12,
              maxHeight: "min(54vh, 420px)",
              overflowY: "auto",
              marginBottom: 14,
            }}
          >
            {content.sections.map((section) => (
              <article
                key={section.version}
                data-release-note={section.version}
              >
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "baseline",
                    marginBottom: 6,
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      color: "#e6e8ee",
                      fontSize: "0.9rem",
                      lineHeight: 1.2,
                    }}
                  >
                    {section.version}: {section.title}
                  </h3>
                  <time
                    style={{
                      color: "#8b93a7",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                    }}
                  >
                    {section.date}
                  </time>
                </header>
                {section.intro && (
                  <p
                    style={{
                      margin: "0 0 6px",
                      color: "#dce5f7",
                      fontSize: "0.78rem",
                      lineHeight: 1.3,
                    }}
                  >
                    {section.intro}
                  </p>
                )}
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: "#cdd6ea",
                    fontSize: "0.78rem",
                    lineHeight: 1.32,
                  }}
                >
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        ) : (
          <ul
            style={{
              margin: "0 0 14px",
              paddingLeft: 18,
              color: "#cdd6ea",
              fontSize: "0.88rem",
              lineHeight: 1.35,
            }}
          >
            {content.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={dismiss}
          style={{
            width: "100%",
            minHeight: 42,
            borderRadius: 10,
            border: "1px solid #54e0c7",
            background: "#172b30",
            color: "#54e0c7",
            fontWeight: 800,
            fontSize: "0.9rem",
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </section>
    </DismissibleDialogFrame>
  );
}
