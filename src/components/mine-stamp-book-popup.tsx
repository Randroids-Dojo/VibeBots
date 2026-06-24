"use client";

import { useEffect, useState } from "react";
import type { PlayerAchievementView } from "@/lib/achievements";
import { DismissibleDialogFrame } from "./dismissible-dialog-frame";

const ACHIEVEMENT_CATEGORY_LABELS: Record<string, string> = {
  depth: "Depth",
  haul: "Haul",
  tools: "Tools",
  survival: "Survival",
};

export function StampBookPopup({
  open,
  onClose,
  onBeforeLoad,
}: {
  open: boolean;
  onClose: () => void;
  onBeforeLoad: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [achievements, setAchievements] = useState<PlayerAchievementView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    onBeforeLoad();
    fetch("/api/achievements")
      .then(async (res) => {
        if (!res.ok) throw new Error("stamp book unavailable");
        return (await res.json()) as {
          offline?: boolean;
          achievements?: PlayerAchievementView[];
        };
      })
      .then((body) => {
        if (cancelled) return;
        setOffline(Boolean(body.offline));
        setAchievements(body.achievements ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "stamp book unavailable");
        setAchievements([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onBeforeLoad]);

  if (!open) return null;

  const collected = achievements.filter((achievement) => achievement.unlocked);
  const byCategory = achievements.reduce<
    Record<string, PlayerAchievementView[]>
  >((groups, achievement) => {
    groups[achievement.category] ??= [];
    groups[achievement.category].push(achievement);
    return groups;
  }, {});

  return (
    <DismissibleDialogFrame
      onDismiss={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stamp-book-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 32,
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
          width: "min(560px, 100%)",
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
              id="stamp-book-title"
              style={{ margin: 0, fontSize: "1.25rem" }}
            >
              Stamp Book
            </h2>
            <p style={{ margin: "6px 0 0", color: "#9aa6c4" }}>
              {loading
                ? "Loading stamps..."
                : `${collected.length}/${achievements.length} collected`}
            </p>
            {offline && (
              <p style={{ margin: "6px 0 0", color: "#f5c542" }}>
                Stamp ledger offline. Stamps are visible, progress waits for
                storage.
              </p>
            )}
            {error && (
              <p style={{ margin: "6px 0 0", color: "#ff8a8a" }}>{error}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close Stamp Book"
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

        {(["depth", "haul", "tools", "survival"] as const).map((category) => {
          const items = byCategory[category] ?? [];
          if (items.length === 0) return null;
          return (
            <section key={category} style={{ marginTop: 16 }}>
              <h3
                style={{
                  margin: "0 0 8px",
                  color: "#54e0c7",
                  fontSize: "0.9rem",
                  textTransform: "uppercase",
                  letterSpacing: 0,
                }}
              >
                {ACHIEVEMENT_CATEGORY_LABELS[category]}
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                  gap: 10,
                }}
              >
                {items.map((achievement) => {
                  const done = achievement.unlocked;
                  return (
                    <article
                      key={achievement.id}
                      data-achievement-id={achievement.id}
                      data-achievement-unlocked={done ? "true" : "false"}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "54px 1fr",
                        gap: 10,
                        minHeight: 96,
                        borderRadius: 8,
                        border: done
                          ? "1px solid #54e0c7"
                          : "1px solid #2c3651",
                        background: done
                          ? "rgba(84, 224, 199, 0.1)"
                          : "rgba(38, 48, 74, 0.42)",
                        padding: 10,
                      }}
                    >
                      <div
                        aria-hidden
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 8,
                          display: "grid",
                          placeItems: "center",
                          border: done
                            ? "2px solid #54e0c7"
                            : "2px solid #59647d",
                          color: done ? "#54e0c7" : "#8b93a7",
                          fontWeight: 900,
                          fontSize: "0.8rem",
                          background: done ? "#102a2d" : "#151b2a",
                        }}
                      >
                        {achievement.stamp}
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: "0.94rem" }}>
                          {achievement.title}
                        </h4>
                        <p
                          style={{
                            margin: "4px 0 8px",
                            color: "#aeb8d0",
                            fontSize: "0.8rem",
                          }}
                        >
                          {achievement.description}
                        </p>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 999,
                            background: "#252f47",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.round((achievement.progress.current / achievement.progress.target) * 100))}%`,
                              height: "100%",
                              background: done ? "#54e0c7" : "#f5c542",
                            }}
                          />
                        </div>
                        <p
                          style={{
                            margin: "6px 0 0",
                            color: done ? "#54e0c7" : "#f5c542",
                            fontSize: "0.74rem",
                            fontWeight: 800,
                          }}
                        >
                          {done
                            ? `Collected ${achievement.unlockedAt?.slice(0, 10) ?? ""}`
                            : achievement.progress.label}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </section>
    </DismissibleDialogFrame>
  );
}
