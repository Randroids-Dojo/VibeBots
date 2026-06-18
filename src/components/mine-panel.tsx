"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampMineCameraZoom,
  MINE_CAMERA_STORAGE_KEY,
  MINE_CAMERA_ZOOM_DEFAULT,
  mineCameraDistance,
} from "@/components/mine-camera";
import type { PlayerAchievementView } from "@/lib/achievements";
import type { AppRelease } from "@/lib/app-release-types";
import {
  CONSUMABLE_PRICES,
  type CollectTarget,
  canPlacePlank,
  cargoCapacity,
  carriedCount,
  carriedValue,
  cellAt,
  collectAction,
  collectablePlacements,
  type Direction,
  DYNAMITE_TIERS,
  type DynamiteTier,
  dynamitePreviewCells,
  dynamiteTier,
  ELEVATOR_COL,
  ELEVATOR_SEGMENT_ROWS,
  elevatorSegmentPrice,
  elevatorSpeedRows,
  findBeacon,
  GEAR_TRACKS,
  type MineAction,
  type MineGear,
  type MineGearTrack,
  type MineState,
  maxEnergy,
  maxGearLevel,
  type OreId,
  oreDef,
  returnEnergyCost,
  returnLadderNeed,
  START_COL,
  stratumAt,
  supportSalvageValue,
  warpRange,
} from "@/sim/mine";
import { PART_CATALOG } from "@/sim/parts";
import { useMineStore } from "@/state/mine-store";
import { DESTINATIONS, destinationAt } from "./mine-destinations";
import { actionRepeatMs } from "./mine-pacing";
import { mineShopNoteSfxEvent, playMineSfxEvent } from "./mine-sfx";
import { STALLS, type StallDef, stallAt } from "./mine-stalls";
import { MineTouchControls } from "./mine-touch-controls";

const MineCanvas = dynamic(() => import("./mine-canvas"), { ssr: false });

const RELEASE_LAST_PLAYED_KEY = "vibebots-last-played-app-version";
const RELEASE_LAST_PLAYED_BUILD_KEY = "vibebots-last-played-app-build";
const RELEASE_DISMISSED_KEY = "vibebots-release-notes-dismissed-id";
const RELEASE_PENDING_FROM_BUILD_KEY = "vibebots-release-notes-from-build";

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowLeft: "left",
  ArrowRight: "right",
  s: "down",
  w: "up",
  a: "left",
  d: "right",
};

const MINE_CAMERA_FOV_DEGREES = 42;
const DYNAMITE_TIER_LABELS: Record<DynamiteTier, string> = {
  1: "Pulse",
  2: "Bore",
  3: "Block",
  4: "Lamp wipe",
};
const DYNAMITE_TIER_BLURBS: Record<DynamiteTier, string> = {
  1: "1 cell up, down, left, and right",
  2: "2 up, 2 left, 2 right, 3 down",
  3: "3 by 3 square around the miner",
  4: "clears blastable cells inside lamp range",
};
const BASE_BUILDING_COLS = [
  ...STALLS.map((stall) => stall.col),
  ...DESTINATIONS.map((destination) => destination.col),
];
const BASE_MIN_COL = Math.min(...BASE_BUILDING_COLS);
const BASE_MAX_COL = Math.max(...BASE_BUILDING_COLS);
const BASE_CENTER_COL = START_COL;

type ViewportSize = {
  width: number;
  height: number;
};

function baseReturnTarget(
  minerCol: number,
  cameraZoom: number,
  viewport: ViewportSize,
): {
  direction: "left" | "right";
  cost: number;
  distance: number;
} | null {
  const aspect = Math.max(0.5, viewport.width / Math.max(1, viewport.height));
  const halfWidth =
    Math.tan((MINE_CAMERA_FOV_DEGREES * Math.PI) / 360) *
    mineCameraDistance(cameraZoom) *
    aspect;
  const left = minerCol - halfWidth;
  const right = minerCol + halfWidth;
  if (BASE_MAX_COL >= left && BASE_MIN_COL <= right) return null;
  const direction = minerCol < BASE_CENTER_COL ? "right" : "left";
  const distance =
    minerCol < BASE_MIN_COL
      ? BASE_MIN_COL - minerCol
      : minerCol > BASE_MAX_COL
        ? minerCol - BASE_MAX_COL
        : Math.abs(minerCol - BASE_CENTER_COL);
  return {
    direction,
    distance,
    cost: Math.max(1, Math.min(9, Math.ceil(distance / 24))),
  };
}

function elevatorAutoDelayMs(gear: MineGear): number {
  return Math.max(70, 240 - ((gear.elevatorSpeed ?? 1) - 1) * 20);
}

const chipStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.82)",
  border: "1px solid #26304a",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: "0.8rem",
  lineHeight: 1.3,
  whiteSpace: "nowrap",
  display: "inline-block",
};

const RESOURCE_FLOAT_COLORS: Record<OreId, string> = {
  coal: "#8b93a7",
  copper: "#d28445",
  silver: "#cdd6ea",
  emerald: "#54e0c7",
  ruby: "#ff6b6b",
  diamond: "#7dd3fc",
  "core-crystal": "#d58cff",
};

const iconButtonStyle: React.CSSProperties = {
  background: "rgba(17, 21, 31, 0.88)",
  border: "1px solid #26304a",
  borderRadius: 14,
  color: "#e6e8ee",
  minWidth: 54,
  height: 46,
  fontSize: "0.95rem",
  pointerEvents: "auto",
};

function collectTargetKey(target: CollectTarget): string {
  return `${target.type}:${target.col},${target.row}`;
}

/** Banner shown for a few seconds when the miner enters a new stratum. */
function StratumBanner({ row }: { row: number }) {
  const [banner, setBanner] = useState<string | null>(null);
  const deepestSeen = useRef(0);
  const stratum = stratumAt(row);

  useEffect(() => {
    if (row <= deepestSeen.current) return;
    const wasStratum = stratumAt(deepestSeen.current);
    deepestSeen.current = row;
    if (stratum.name === wasStratum.name) return;
    setBanner(`Entering ${stratum.name}`);
    const timer = setTimeout(() => setBanner(null), 2600);
    return () => clearTimeout(timer);
  }, [row, stratum.name]);

  if (!banner) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 90,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(17, 21, 31, 0.92)",
        border: "1px solid #54e0c7",
        color: "#54e0c7",
        borderRadius: 10,
        padding: "10px 22px",
        fontSize: "1.1rem",
        fontWeight: 600,
        pointerEvents: "none",
      }}
    >
      {banner}
    </div>
  );
}

function storedBuild(key: string): number | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function releaseHistoryContent(release: AppRelease): {
  intro: string | null;
  items: string[];
  sections: Array<{
    version: string;
    date: string;
    title: string;
    intro: string | null;
    items: string[];
  }>;
} {
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

function ReleaseNotesPopup({
  release,
  manualOpenCount,
}: {
  release: AppRelease;
  manualOpenCount: number;
}) {
  const [content, setContent] = useState<{
    intro: string | null;
    items: string[];
    sections: Array<{
      version: string;
      date: string;
      title: string;
      intro: string | null;
      items: string[];
    }>;
  }>({ intro: null, items: [], sections: [] });
  const [visible, setVisible] = useState(false);

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
    <div
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
    </div>
  );
}

const ACHIEVEMENT_CATEGORY_LABELS: Record<string, string> = {
  depth: "Depth",
  haul: "Haul",
  tools: "Tools",
  survival: "Survival",
};

function StampBookPopup({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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
  }, [open]);

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
    <div
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
    </div>
  );
}

/**
 * Render-layer near-miss search (REQ-019): the best treasure within
 * reach of where the robot battery died, from rows the client already generated.
 */
function nearMissLine(
  mine: MineState,
  at: { col: number; row: number },
): string | null {
  let best: { name: string; value: number; dist: number } | null = null;
  const lo = Math.max(1, at.row - 6);
  const hi = at.row + 6;
  for (let r = lo; r <= hi; r++) {
    for (let c = at.col - 6; c <= at.col + 6; c++) {
      const cell = cellAt(mine, c, r);
      if (!cell) continue;
      const dist = Math.abs(r - at.row) + Math.abs(c - at.col);
      if (dist === 0 || dist > 6) continue;
      const value =
        cell.kind === "part-cache"
          ? 999
          : cell.kind === "ore" && cell.ore
            ? oreDef(cell.ore).value
            : 0;
      if (value < 20) continue;
      const name =
        cell.kind === "part-cache"
          ? "a part cache"
          : cell.ore
            ? oreDef(cell.ore).name.toLowerCase()
            : "";
      if (
        !best ||
        value > best.value ||
        (value === best.value && dist < best.dist)
      ) {
        best = { name, value, dist };
      }
    }
  }
  if (!best) return null;
  const what = best.name === "a part cache" ? best.name : `a ${best.name}`;
  return `${what} sat ${best.dist} block${best.dist > 1 ? "s" : ""} from where the battery died.`;
}

interface FloatNote {
  id: number;
  text: string;
  color: string;
  glow: string;
}

/** Floating pickup text, cache fanfare, and the collapse reveal. */
function JuiceOverlays() {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const [floats, setFloats] = useState<FloatNote[]>([]);
  const [fanfare, setFanfare] = useState<string | null>(null);
  const [wreck, setWreck] = useState<{
    crushed: boolean;
    fallFatal: boolean;
    abandoned: boolean;
    value: number;
    parts: number;
    nearMiss: string | null;
  } | null>(null);
  const nextId = useRef(1);
  const wreckTimeout = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (wreckTimeout.current != null) {
        window.clearTimeout(wreckTimeout.current);
        wreckTimeout.current = null;
      }
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the event stream; the rest is read-at-fire
  useEffect(() => {
    if (!lastResult?.ok) return;
    if (lastResult.oreHarvested) {
      const ore = oreDef(lastResult.oreHarvested.ore);
      const count = lastResult.oreHarvested.units;
      const color =
        RESOURCE_FLOAT_COLORS[lastResult.oreHarvested.ore] ?? "#54e0c7";
      const id = nextId.current++;
      setFloats((prev) => [
        ...prev.slice(-4),
        {
          id,
          text: `${ore.name} x${count}`,
          color,
          glow: `0 0 18px ${color}`,
        },
      ]);
      setTimeout(
        () => setFloats((prev) => prev.filter((f) => f.id !== id)),
        1300,
      );
    }
    if (lastResult.found) {
      const name = PART_CATALOG[lastResult.found]?.name ?? lastResult.found;
      setFanfare(`Cache cracked: ${name}!`);
      setTimeout(() => setFanfare(null), 2800);
    }
    if (wreckTimeout.current != null) {
      window.clearTimeout(wreckTimeout.current);
      wreckTimeout.current = null;
    }
    if (lastResult.collapsed && lastResult.lost) {
      const nextWreck = {
        crushed: lastResult.crushed ?? false,
        fallFatal: lastResult.fallFatal ?? false,
        abandoned: lastResult.abandoned ?? false,
        value: lastResult.lost.value,
        parts: lastResult.lost.parts.length,
        nearMiss: nearMissLine(mine, lastResult.lost),
      };
      if (lastResult.fallFatal) {
        wreckTimeout.current = window.setTimeout(() => {
          setWreck(nextWreck);
          wreckTimeout.current = null;
        }, 850);
      } else {
        setWreck(nextWreck);
      }
    }
  }, [tick]);

  return (
    <>
      {floats.map((f, i) => (
        <div
          key={f.id}
          className="mine-juice"
          style={{
            position: "absolute",
            left: "50%",
            top: `calc(50% - ${i * 18}px)`,
            transform: "translateX(-50%)",
            color: f.color,
            fontWeight: 700,
            fontSize: "1.05rem",
            letterSpacing: 0,
            textShadow: `0 1px 6px rgba(0,0,0,0.8), ${f.glow}`,
            pointerEvents: "none",
            animation: "mine-float-up 0.95s ease-out forwards",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            borderRadius: 999,
            background: "rgba(9, 12, 18, 0.72)",
            padding: "4px 10px",
            boxShadow: f.glow,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              marginRight: 6,
              borderRadius: 999,
              background: f.color,
              verticalAlign: "middle",
              boxShadow: f.glow,
            }}
          />
          {f.text}
        </div>
      ))}
      {fanfare && (
        <div
          className="mine-juice"
          style={{
            position: "absolute",
            top: 140,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(40, 32, 8, 0.95)",
            border: "2px solid #f5c542",
            color: "#f5c542",
            borderRadius: 12,
            padding: "14px 30px",
            fontSize: "1.25rem",
            fontWeight: 700,
            pointerEvents: "none",
            animation: "mine-fanfare-pop 2.8s ease-out forwards",
            boxShadow: "0 0 30px rgba(245, 197, 66, 0.35)",
          }}
        >
          {fanfare}
        </div>
      )}
      {wreck && (
        <button
          type="button"
          onClick={() => setWreck(null)}
          aria-label="Dismiss trip report"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            background:
              "radial-gradient(ellipse at center, rgba(60, 10, 10, 0.35), rgba(10, 4, 4, 0.85))",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "rgba(24, 12, 14, 0.96)",
              border: "1px solid #ff6b6b",
              borderRadius: 12,
              padding: "20px 30px",
              maxWidth: 360,
              color: "#ffd9d9",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>
              {wreck.fallFatal
                ? "Fell too far"
                : wreck.crushed
                  ? "Crushed by a boulder"
                  : wreck.abandoned
                    ? "Abandoned the dig"
                    : "Battery drained"}
            </p>
            <p style={{ margin: "10px 0 0", fontSize: "0.95rem" }}>
              {wreck.value > 0 || wreck.parts > 0
                ? `The cargo stayed below: ${wreck.value} vibes${wreck.parts > 0 ? ` and ${wreck.parts} part${wreck.parts > 1 ? "s" : ""}` : ""}.`
                : "At least the hold was empty."}
            </p>
            {wreck.nearMiss && (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: "0.9rem",
                  color: "#f5c542",
                }}
              >
                So close: {wreck.nearMiss}
              </p>
            )}
            <p style={{ margin: "12px 0 0", fontSize: "0.8rem", opacity: 0.7 }}>
              tap anywhere for one more trip
            </p>
          </div>
        </button>
      )}
    </>
  );
}

/** Big-tap-target sheet row: icon tile, label, action button. */
function SheetRow({
  icon,
  name,
  sub,
  badge,
  action,
}: {
  icon: string;
  name: string;
  sub?: string;
  badge?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid rgba(38, 48, 74, 0.55)",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: "rgba(38, 48, 74, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.2rem",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{ display: "block", fontSize: "0.95rem", fontWeight: 600 }}
        >
          {name}
          {badge && (
            <span
              style={{
                marginLeft: 8,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#54e0c7",
              }}
            >
              {badge}
            </span>
          )}
        </span>
        {sub && (
          <span
            style={{ display: "block", fontSize: "0.72rem", opacity: 0.55 }}
          >
            {sub}
          </span>
        )}
      </span>
      {action}
    </div>
  );
}

/** Downward drag distance (px) past which releasing closes the sheet. */
const SWIPE_DISMISS_PX = 70;

const sheetButtonStyle = (enabled: boolean): React.CSSProperties => ({
  minWidth: 78,
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid #2c3a5c",
  background: enabled ? "#1d2738" : "rgba(29, 39, 56, 0.4)",
  color: enabled ? "#e6e8ee" : "rgba(230, 232, 238, 0.35)",
  fontWeight: 700,
  fontSize: "0.9rem",
});

const STALL_ICONS: Record<StallDef["id"], string> = {
  buyer: "\u{1F3E6}",
  supply: "\u{1F4E6}",
  upgrades: "\u{1F6E0}\u{FE0F}",
  elevator: "\u{1F6D7}",
  warp: "\u{1F300}",
};

const ITEM_ICONS: Record<string, string> = {
  dynamite: "\u{1F9E8}",
  rope: "\u{1FAA2}",
  ladder: "\u{1FA9C}",
  plank: "\u{1FAB5}",
  beacon: "\u{1F4E1}",
  pickaxe: "\u{26CF}\u{FE0F}",
  battery: "\u{1F50B}",
  cargo: "\u{1F392}",
  lantern: "\u{1F3EE}",
  warpcoil: "\u{1F300}",
  blast: "\u{1F4A5}",
  elevatorSpeed: "\u{1F6D7}",
  fall: "\u{1FA82}",
};

function BuyerPanel({
  mine,
  balance,
}: {
  mine: MineState;
  balance: number | null;
}) {
  const miner = mine.miner;
  const carriedOre = carriedCount(miner);
  const capacity = cargoCapacity(mine.gear);
  const freeSpace = Math.max(0, capacity - carriedOre);
  const haulValue = carriedValue(miner);
  const partCount = miner.carriedParts.length;
  const deepest = miner.maxDepth;
  const cargoDef = GEAR_TRACKS.find((track) => track.track === "cargo");
  const nextCargoPrice =
    mine.gear.cargo >= maxGearLevel("cargo")
      ? null
      : cargoDef?.prices[mine.gear.cargo - 1];
  const nextDepth =
    deepest < 50
      ? 50
      : deepest < 100
        ? 100
        : deepest < 250
          ? 250
          : deepest < 500
            ? 500
            : 1000;
  const oreRows = Object.entries(miner.carried)
    .map(([id, count]) => ({
      def: oreDef(id as OreId),
      count: count ?? 0,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.def.value - a.def.value);
  const targetRows = [
    {
      label: "Current haul",
      value: haulValue > 0 ? `${haulValue} vibes` : "empty",
    },
    {
      label: "Hold space",
      value: `${carriedOre}/${capacity} used`,
    },
    {
      label: "Parts found",
      value: `${partCount}`,
    },
    {
      label: "Next depth mark",
      value: deepest >= 990 ? "metal cap near row 1000" : `row ${nextDepth}`,
    },
  ];
  if (nextCargoPrice !== null && nextCargoPrice !== undefined) {
    targetRows.push({
      label: "Cargo upgrade",
      value: `${nextCargoPrice} vibes at Upgrades`,
    });
  }

  return (
    <div>
      <p style={{ margin: "12px 0 8px", fontSize: "0.85rem", opacity: 0.72 }}>
        Your haul sells automatically as soon as you reach the surface. The
        Buyer keeps the appraisal visible so you know what this trip is worth.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))",
          gap: 8,
          margin: "10px 0",
        }}
      >
        {targetRows.map((row) => (
          <div
            key={row.label}
            style={{
              background: "rgba(38, 48, 74, 0.46)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 10,
              padding: "8px",
              minHeight: 66,
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: "0.68rem",
                color: "#8b93a7",
                marginBottom: 4,
              }}
            >
              {row.label}
            </span>
            <strong
              style={{
                display: "block",
                fontSize: "0.84rem",
                lineHeight: 1.2,
              }}
            >
              {row.value}
            </strong>
          </div>
        ))}
      </div>
      {oreRows.length > 0 ? (
        <div
          style={{
            display: "grid",
            gap: 6,
            marginTop: 10,
          }}
        >
          {oreRows.map(({ def, count }) => (
            <div
              key={def.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 10,
                alignItems: "center",
                background: "rgba(17, 21, 31, 0.6)",
                border: "1px solid rgba(255, 255, 255, 0.07)",
                borderRadius: 10,
                padding: "8px 10px",
              }}
            >
              <span>
                {def.name} x{count}
                <small
                  style={{
                    display: "block",
                    color: "#8b93a7",
                    fontSize: "0.68rem",
                  }}
                >
                  {def.value} vibes each
                </small>
              </span>
              <strong>{def.value * count}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: "10px 0 0", fontSize: "0.78rem", opacity: 0.62 }}>
          No ore in the hold. Deeper rows yield richer stacks, but even old ore
          types scale up as you push down.
        </p>
      )}
      {freeSpace === 0 && (
        <p
          style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#f5c542" }}
        >
          Hold full. Keep digging if you want, overflow ore will drop into the
          mine for later pickup.
        </p>
      )}
      {balance === null && (
        <p
          style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#f5c542" }}
        >
          Ledger offline. The Buyer can appraise the trip, but wallet updates
          wait until storage is online.
        </p>
      )}
    </div>
  );
}

type DepotItem = "dynamite" | "rope" | "ladder" | "plank" | "beacon";
const DEPOT_BUY_QUANTITIES = [1, 5, 10] as const;

/**
 * The shop sheet (REQ-021): standing at a stall slides a mobile bottom
 * sheet up over the lower screen, with thumb-sized rows and the wallet
 * in the header. Walking off the column closes it.
 */
function StallMenu({
  stall,
  mine,
  gear,
  balance,
  shopNote,
  cashOutPending,
  onBuyConsumable,
  onBuyGear,
  onBuyElevator,
  onRide,
  onClose,
}: {
  stall: StallDef;
  mine: MineState;
  gear: MineGear;
  balance: number | null;
  shopNote: string | null;
  cashOutPending: boolean;
  onBuyConsumable: (item: DepotItem, quantity: number) => void;
  onBuyGear: (track: MineGearTrack) => void;
  onBuyElevator: () => void;
  onRide: (dir: "ride-down" | "ride-up" | "warp-down" | "warp-home") => void;
  onClose: () => void;
}) {
  const miner = mine.miner;
  const banked = miner.bankedCredits;
  const bankedParts = miner.bankedParts.length;
  const autoBanking = banked > 0 || bankedParts > 0;
  const upgradeFunds = balance === null ? null : balance + banked;
  const offline = balance === null;
  const beacon = findBeacon(mine);
  // Swipe-to-dismiss: the grab zone follows the finger down, and a far
  // enough pull (or a flick) closes the sheet. A short tug snaps back.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [buyQuantity, setBuyQuantity] = useState(1);
  const dragStart = useRef<number | null>(null);
  const dismiss = () => {
    setDragY(0);
    setDragging(false);
    dragStart.current = null;
    onClose();
  };
  const onGrabDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = e.clientY;
    setDragging(true);
  };
  const onGrabMove = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    const dy = e.clientY - dragStart.current;
    setDragY(dy > 0 ? dy : 0);
  };
  const onGrabUp = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    const dy = e.clientY - dragStart.current;
    dragStart.current = null;
    setDragging(false);
    if (dy > SWIPE_DISMISS_PX) dismiss();
    else setDragY(0);
  };
  return (
    <section
      aria-label={stall.name}
      className="stall-sheet"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        margin: "0 auto",
        maxWidth: 440,
        background:
          "linear-gradient(180deg, rgba(21, 27, 41, 0.97), rgba(12, 15, 23, 0.99))",
        borderTop: `2px solid ${stall.color}`,
        borderRadius: "18px 18px 0 0",
        boxShadow: "0 -14px 44px rgba(0, 0, 0, 0.55)",
        padding: "8px 18px 18px",
        zIndex: 10,
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragging ? "none" : "transform 180ms ease",
      }}
    >
      {/* Grab zone: the handle plus the strip around it (the iOS sheet
          convention). Pointer drag here pulls the sheet down to close. */}
      <div
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabUp}
        onPointerCancel={onGrabUp}
        style={{
          margin: "-8px -18px 0",
          padding: "10px 18px 4px",
          touchAction: "none",
          cursor: "grab",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 38,
            height: 4,
            borderRadius: 999,
            background: stall.color,
            opacity: 0.4,
            margin: "0 auto 8px",
          }}
        />
      </div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: "1.5rem" }}>{STALL_ICONS[stall.id]}</span>
        <span style={{ flex: 1 }}>
          <span
            style={{
              display: "block",
              fontWeight: 800,
              fontSize: "1.05rem",
              color: stall.color,
            }}
          >
            {stall.name}
          </span>
          <span
            style={{ display: "block", fontSize: "0.72rem", opacity: 0.55 }}
          >
            {stall.blurb}
          </span>
        </span>
        <span
          style={{
            background: "rgba(38, 48, 74, 0.6)",
            borderRadius: 999,
            padding: "6px 12px",
            fontSize: "0.85rem",
            fontWeight: 700,
            color: offline ? "#8b93a7" : "#f5c542",
            whiteSpace: "nowrap",
          }}
        >
          {offline ? "offline" : `\u{1F4B0} ${balance} vibes`}
        </span>
        <button
          type="button"
          aria-label="Close shop"
          onClick={dismiss}
          style={{
            flexShrink: 0,
            width: 34,
            height: 34,
            borderRadius: 999,
            border: "1px solid rgba(255, 255, 255, 0.18)",
            background: "rgba(38, 48, 74, 0.6)",
            color: "#cdd6ea",
            fontSize: "1.2rem",
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          {"×"}
        </button>
      </header>
      {offline && (
        <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#f5c542" }}>
          the ledger is offline right now; browsing only
        </p>
      )}
      {stall.id === "buyer" && <BuyerPanel mine={mine} balance={balance} />}
      {stall.id === "supply" && (
        <div>
          <fieldset
            aria-label="Buy quantity"
            style={{
              display: "flex",
              gap: 8,
              margin: "10px 0 6px",
              padding: 0,
              border: 0,
            }}
          >
            {DEPOT_BUY_QUANTITIES.map((quantity) => {
              const active = buyQuantity === quantity;
              return (
                <button
                  key={quantity}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setBuyQuantity(quantity)}
                  style={{
                    border: active ? "1px solid #54e0c7" : "1px solid #2c3a5c",
                    background: active
                      ? "rgba(84, 224, 199, 0.16)"
                      : "rgba(38, 48, 74, 0.55)",
                    color: active ? "#54e0c7" : "#cdd6ea",
                    borderRadius: 10,
                    minWidth: 48,
                    minHeight: 34,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  x{quantity}
                </button>
              );
            })}
          </fieldset>
          {(
            [
              ["dynamite", "Dynamite", "fuels your selected blast tier"],
              ["rope", "Recall Rope", "bank the carry from anywhere"],
              ["ladder", "Ladder", "climbs one cell, stays planted"],
              ["plank", "Plank", "bridges one gap, stays planted"],
              ["beacon", "Warp Beacon", "plants the warp anchor"],
            ] as const
          ).map(([item, name, blurb]) => {
            const price = CONSUMABLE_PRICES[item];
            const totalPrice = price * buyQuantity;
            const affordable = balance !== null && balance >= totalPrice;
            return (
              <SheetRow
                key={item}
                icon={ITEM_ICONS[item]}
                name={name}
                sub={blurb}
                badge={`have ${mine.consumables[item]}`}
                action={
                  <button
                    type="button"
                    onClick={() => onBuyConsumable(item, buyQuantity)}
                    disabled={!affordable}
                    style={{ ...sheetButtonStyle(affordable), minWidth: 124 }}
                  >
                    Buy {buyQuantity} for {totalPrice} vibes
                  </button>
                }
              />
            );
          })}
          <p style={{ margin: "10px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            purchases pack straight into your current trip. Ladders and planks
            cost vibes now; the only free batch comes from dying in the mine,
            which refills you to 8 ladders and 4 planks.
          </p>
        </div>
      )}
      {stall.id === "upgrades" && (
        <div>
          {GEAR_TRACKS.map((def) => {
            // blast is optional on gear (absent reads as level 1).
            const level = gear[def.track] ?? 1;
            const maxed = level >= maxGearLevel(def.track);
            const price = maxed ? null : def.prices[level - 1];
            const affordable =
              price !== null &&
              upgradeFunds !== null &&
              upgradeFunds >= price &&
              !cashOutPending;
            return (
              <SheetRow
                key={def.track}
                icon={ITEM_ICONS[def.track] ?? "\u{2699}\u{FE0F}"}
                name={def.name}
                sub={def.blurb}
                badge={def.track === "blast" ? `tier ${level}` : `lv ${level}`}
                action={
                  maxed ? (
                    <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                      max
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBuyGear(def.track)}
                      disabled={!affordable}
                      style={sheetButtonStyle(affordable)}
                    >
                      {autoBanking ? "Bank + " : ""}
                      {price} vibes
                    </button>
                  )
                }
              />
            );
          })}
          <p style={{ margin: "10px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            Upgrades sell any hauled-up loot first, then apply immediately.
          </p>
        </div>
      )}
      {stall.id === "elevator" && (
        <div>
          <SheetRow
            icon={"\u{1F6D7}"}
            name={
              gear.elevator > 0
                ? `rail reaches ${gear.elevator} deep`
                : "no rail yet; the shaft waits"
            }
            sub="free rides, surface to rail end"
            action={
              <button
                type="button"
                onClick={onBuyElevator}
                disabled={
                  balance === null ||
                  balance <
                    elevatorSegmentPrice(
                      gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                    )
                }
                style={sheetButtonStyle(
                  balance !== null &&
                    balance >=
                      elevatorSegmentPrice(
                        gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                      ),
                )}
              >
                {elevatorSegmentPrice(
                  gear.elevator / ELEVATOR_SEGMENT_ROWS + 1,
                )}{" "}
                vibes
              </button>
            }
          />
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            each segment extends the rail {ELEVATOR_SEGMENT_ROWS} rows
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "0.7rem", opacity: 0.55 }}>
            speed level {gear.elevatorSpeed ?? 1} moves{" "}
            {elevatorSpeedRows(gear)} rows per automatic step
          </p>
          <button
            type="button"
            onClick={() => onRide("ride-down")}
            disabled={mine.gear.elevator <= 0}
            style={{
              ...sheetButtonStyle(mine.gear.elevator > 0),
              width: "100%",
              marginTop: 12,
              minHeight: 48,
            }}
          >
            {mine.gear.elevator > 0
              ? `Auto ride to ${mine.gear.elevator}`
              : "Ride down (no rail)"}
          </button>
        </div>
      )}
      {stall.id === "warp" && (
        <div>
          <SheetRow
            icon={ITEM_ICONS.beacon}
            name={
              beacon
                ? `beacon planted at ${beacon.row} deep`
                : "no beacon planted; kits at the depot"
            }
            sub={`warpcoil range ${warpRange(mine.gear)} rows (upgrade at the Upgrades stall)`}
          />
          <button
            type="button"
            onClick={() => onRide("warp-down")}
            disabled={!beacon || beacon.row > warpRange(mine.gear)}
            style={{
              ...sheetButtonStyle(
                !!beacon && beacon.row <= warpRange(mine.gear),
              ),
              width: "100%",
              marginTop: 12,
              minHeight: 48,
            }}
          >
            Warp to beacon
          </button>
        </div>
      )}
      {shopNote && (
        <p style={{ margin: "12px 0 0", fontSize: "0.8rem", color: "#54e0c7" }}>
          {shopNote}
        </p>
      )}
    </section>
  );
}

export function MinePanel({ appRelease }: { appRelease: AppRelease }) {
  const tick = useMineStore((s) => s.tick);
  const mine = useMineStore((s) => s.mine);
  const lastResult = useMineStore((s) => s.lastResult);
  const lastAction = useMineStore((s) => s.lastAction);
  const move = useMineStore((s) => s.move);
  const seed = useMineStore((s) => s.seed);
  const tripIndex = useMineStore((s) => s.tripIndex);
  const movesLength = useMineStore((s) => s.moves.length);
  const cashOut = useMineStore((s) => s.cashOut);
  const submitCashOut = useMineStore((s) => s.submitCashOut);
  const gear = useMineStore((s) => s.gear);
  const loadGear = useMineStore((s) => s.loadGear);
  const loadWorld = useMineStore((s) => s.loadWorld);
  const balance = useMineStore((s) => s.balance);
  const shopNote = useMineStore((s) => s.shopNote);
  const buyConsumable = useMineStore((s) => s.buyConsumable);
  const buyGearUpgrade = useMineStore((s) => s.buyGearUpgrade);
  const buyElevator = useMineStore((s) => s.buyElevator);
  const teleportToBase = useMineStore((s) => s.teleportToBase);
  const router = useRouter();
  const [dynamiteMenuOpen, setDynamiteMenuOpen] = useState(false);
  const [selectedDynamiteTier, setSelectedDynamiteTier] =
    useState<DynamiteTier>(1);
  const [abandonArmed, setAbandonArmed] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [collectMode, setCollectMode] = useState(false);
  const [collectSelection, setCollectSelection] = useState<string[]>([]);
  const [elevatorAutoDir, setElevatorAutoDir] = useState<
    "ride-down" | "ride-up" | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stampBookOpen, setStampBookOpen] = useState(false);
  const [releaseNotesOpenCount, setReleaseNotesOpenCount] = useState(0);
  const [cashNoteVisible, setCashNoteVisible] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(MINE_CAMERA_ZOOM_DEFAULT);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({
    width: 1024,
    height: 768,
  });
  const [baseReturnOpen, setBaseReturnOpen] = useState(false);
  const [baseReturnConfirm, setBaseReturnConfirm] = useState(false);
  const [baseReturnPending, setBaseReturnPending] = useState(false);
  const [teleportBurstKey, setTeleportBurstKey] = useState(0);
  // The column whose stall sheet is open. Standing on a stall no longer
  // auto-opens it: a prompt button appears and tapping it sets this.
  // Stepping off clears it, so walking by never pops the menu.
  const [openStallCol, setOpenStallCol] = useState<number | null>(null);
  // Touch players never see keyboard copy (matches the renderer's
  // coarse-pointer heuristic). False during SSR; set before paint.
  const [coarsePointer, setCoarsePointer] = useState(false);
  const lastCashOutStateRef = useRef(cashOut.state);
  const lastShopNoteRef = useRef<string | null>(null);
  const lastGamepadZoomRef = useRef(0);
  const lastDirectionActionRef = useRef(0);
  const lastAutoCashOutKeyRef = useRef<string | null>(null);
  const previousMinerRowRef = useRef(mine.miner.row);
  void tick;

  const persistCameraZoom = useCallback((zoom: number) => {
    try {
      localStorage.setItem(MINE_CAMERA_STORAGE_KEY, String(zoom));
    } catch {
      // Private browsing or blocked storage: keep the preference in memory.
    }
  }, []);

  const adjustCameraZoom = useCallback(
    (delta: number) => {
      setCameraZoom((prev) => {
        const next = clampMineCameraZoom(prev + delta, gear);
        persistCameraZoom(next);
        return next;
      });
    },
    [gear, persistCameraZoom],
  );

  useEffect(() => {
    // The world first (it seeds the mine), then gear (which rebuilds
    // the trip over that world when levels differ).
    void loadWorld().then(() => loadGear());
  }, [loadWorld, loadGear]);

  useEffect(() => {
    setCoarsePointer(window.matchMedia?.("(pointer: coarse)").matches ?? false);
  }, []);

  useEffect(() => {
    const updateViewport = () =>
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MINE_CAMERA_STORAGE_KEY);
      if (!raw) return;
      setCameraZoom(clampMineCameraZoom(Number(raw), gear));
    } catch {
      // Storage unavailable: default zoom remains active.
    }
  }, [gear]);

  useEffect(() => {
    setCameraZoom((prev) => {
      const next = clampMineCameraZoom(prev, gear);
      if (next !== prev) persistCameraZoom(next);
      return next;
    });
  }, [gear, persistCameraZoom]);

  useEffect(() => {
    let frame = 0;
    const pollGamepadZoom = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const now = Date.now();
      for (const pad of pads) {
        if (!pad) continue;
        const modifier =
          pad.buttons[6]?.pressed ||
          pad.buttons[7]?.pressed ||
          pad.buttons[4]?.pressed ||
          pad.buttons[5]?.pressed;
        if (!modifier) continue;
        const zoomIn = pad.buttons[12]?.pressed;
        const zoomOut = pad.buttons[13]?.pressed;
        if (!zoomIn && !zoomOut) continue;
        if (now - lastGamepadZoomRef.current < 160) break;
        lastGamepadZoomRef.current = now;
        adjustCameraZoom(zoomOut ? 0.05 : -0.05);
        break;
      }
      frame = requestAnimationFrame(pollGamepadZoom);
    };
    frame = requestAnimationFrame(pollGamepadZoom);
    return () => cancelAnimationFrame(frame);
  }, [adjustCameraZoom]);

  useEffect(() => {
    if (lastCashOutStateRef.current === cashOut.state) return;
    lastCashOutStateRef.current = cashOut.state;
    if (cashOut.state === "done") playMineSfxEvent("sell");
    else if (cashOut.state === "error" || cashOut.state === "unavailable") {
      playMineSfxEvent("deny");
    }
  }, [cashOut.state]);

  useEffect(() => {
    if (cashOut.state === "idle" || cashOut.state === "pending") {
      setCashNoteVisible(false);
      return;
    }
    setCashNoteVisible(true);
    const timer = setTimeout(() => setCashNoteVisible(false), 3600);
    return () => clearTimeout(timer);
  }, [cashOut]);

  useEffect(() => {
    if (!shopNote || shopNote === lastShopNoteRef.current) return;
    lastShopNoteRef.current = shopNote;
    const event = mineShopNoteSfxEvent(shopNote);
    if (event) playMineSfxEvent(event);
  }, [shopNote]);

  useEffect(() => {
    if (
      lastResult?.ok &&
      (lastAction === "warp-home" || lastAction === "warp-down")
    ) {
      setTeleportBurstKey((key) => key + 1);
    }
  }, [lastAction, lastResult]);

  const fireDirection = useCallback(
    (dir: Direction, options: { repeat?: boolean } = {}) => {
      if (elevatorAutoDir) return;
      const state = useMineStore.getState();
      const now = Date.now();
      if (
        options.repeat &&
        now - lastDirectionActionRef.current < actionRepeatMs(state.mine.gear)
      ) {
        return;
      }
      lastDirectionActionRef.current = now;
      if (dir === "left" || dir === "right") setFacing(dir);
      state.move(dir);
    },
    [elevatorAutoDir],
  );

  // Moving off the column closes any open sheet, so the menu never
  // follows the miner and a return shows the prompt, not the open sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: column is the reset trigger, not read in the body; dropping it would fire once and never re-close
  useEffect(() => {
    setOpenStallCol(null);
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
  }, [mine.miner.col]);

  // The abandon confirm disarms itself; a stray thumb cannot torch a
  // haul twenty minutes deep.
  useEffect(() => {
    if (!abandonArmed) return;
    // Generous on purpose: the guard exists to stop double-tap
    // accidents (sub-second), and slow devices can take seconds
    // between deliberate taps.
    const timer = setTimeout(() => setAbandonArmed(false), 8000);
    return () => clearTimeout(timer);
  }, [abandonArmed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const targetEl = event.target as HTMLElement | null;
      if (
        targetEl &&
        (targetEl.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(targetEl.tagName))
      ) {
        return;
      }
      const dir = KEY_DIRECTIONS[event.key];
      if (!dir) return;
      event.preventDefault();
      fireDirection(dir, { repeat: event.repeat });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fireDirection]);

  const miner = mine.miner;
  const currentCell = cellAt(mine, miner.col, miner.row);
  const stratum = stratumAt(miner.row);
  const horizontalDistance = miner.col - START_COL;
  const horizontalDistanceLabel =
    horizontalDistance > 0 ? `+${horizontalDistance}` : `${horizontalDistance}`;
  const carryValue = carriedValue(miner);
  const climbCost = returnEnergyCost(miner);
  // The climb estimate assumes a cleared shaft; warn with a margin so a
  // detour or two does not turn the warning into a lie (REQ-017).
  const batteryLow = miner.row > 0 && miner.energy < climbCost * 1.25 + 2;
  // Ladder budget for the same straight-home climb (REQ-020).
  const laddersNeeded = returnLadderNeed(mine);
  const ladderShort = miner.row > 0 && laddersNeeded > mine.consumables.ladder;
  // The village (REQ-021): standing on a stall's column opens its menu,
  // unless the player just closed it here (swipe-down or close button).
  const stall = miner.row === 0 ? stallAt(miner.col) : null;
  // Destination buildings (Workshop, Battles) route to another screen
  // instead of opening a sheet. The surface is the overworld hub.
  const destination = miner.row === 0 ? destinationAt(miner.col) : null;
  const lostCargo = miner.lostCargo;
  const lostDistance = lostCargo
    ? Math.abs(lostCargo.col - miner.col) + Math.abs(lostCargo.row - miner.row)
    : 0;
  const lostPulseSeconds = lostCargo
    ? Math.max(0.45, Math.min(1.6, 0.35 + lostDistance * 0.08))
    : 1;
  const visibleSupports = collectablePlacements(mine);
  const visibleSupportKeyList = visibleSupports.map(collectTargetKey).join("|");
  const selectedSupports = visibleSupports.filter((target) =>
    collectSelection.includes(collectTargetKey(target)),
  );
  const selectedSupportValue = selectedSupports.reduce(
    (sum, target) => sum + supportSalvageValue(target.type),
    0,
  );
  const plankEnabled = !elevatorAutoDir && canPlacePlank(mine, facing);
  const minerOnElevatorRail = miner.col === ELEVATOR_COL;
  const elevatorAvailable =
    mine.gear.elevator > 0 &&
    minerOnElevatorRail &&
    miner.row >= 0 &&
    miner.row <= mine.gear.elevator;
  const canRideElevatorDown =
    elevatorAvailable && miner.row < mine.gear.elevator;
  const canRideElevatorUp = elevatorAvailable && miner.row > 0;
  const salvagedSupportCount =
    lastResult?.ok && lastResult.supportCollected
      ? (lastResult.supportCollected.ladder ?? 0) +
        (lastResult.supportCollected.plank ?? 0)
      : 0;
  const salvagedSupportValue =
    lastResult?.ok && lastResult.supportSalvageValue
      ? lastResult.supportSalvageValue
      : 0;
  const bankedCredits = miner.bankedCredits;
  const bankedPartsCount = miner.bankedParts.length;
  const baseReturn =
    miner.row === 0
      ? baseReturnTarget(miner.col, cameraZoom, viewportSize)
      : null;
  const baseReturnDisabled =
    !baseReturn ||
    baseReturnPending ||
    balance === null ||
    balance < baseReturn.cost ||
    cashOut.state === "pending";
  const baseReturnButtonLabel =
    balance === null
      ? "Ledger offline"
      : baseReturn && balance < baseReturn.cost
        ? `Need ${baseReturn.cost} vibes`
        : baseReturnConfirm && baseReturn
          ? `Confirm for ${baseReturn.cost} vibes`
          : baseReturn
            ? `Teleport for ${baseReturn.cost} vibes`
            : "Base visible";
  const baseReturnConfirmActive = baseReturnConfirm && !baseReturnDisabled;
  const baseReturnButtonColors = baseReturnDisabled
    ? {
        border: "1px solid #343b52",
        background: "#1b2030",
        color: "#6f7892",
      }
    : baseReturnConfirmActive
      ? {
          border: "1px solid #ff6b6b",
          background: "#4a1f28",
          color: "#ffd9d9",
        }
      : {
          border: "1px solid #54e0c7",
          background: "#173033",
          color: "#54e0c7",
        };

  const handleBaseReturn = async () => {
    if (!baseReturn || baseReturnDisabled) return;
    if (!baseReturnConfirm) {
      setBaseReturnConfirm(true);
      return;
    }
    setBaseReturnPending(true);
    const ok = await teleportToBase(baseReturn.cost);
    setBaseReturnPending(false);
    if (!ok) return;
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
    setTeleportBurstKey((key) => key + 1);
    playMineSfxEvent("warp");
  };

  useEffect(() => {
    const visibleSupportKeys = new Set(
      visibleSupportKeyList ? visibleSupportKeyList.split("|") : [],
    );
    setCollectSelection((prev) =>
      prev.filter((key) => visibleSupportKeys.has(key)),
    );
  }, [visibleSupportKeyList]);

  useEffect(() => {
    if (baseReturn) return;
    setBaseReturnOpen(false);
    setBaseReturnConfirm(false);
  }, [baseReturn]);

  useEffect(() => {
    if (!elevatorAutoDir) return;
    const atEnd =
      elevatorAutoDir === "ride-down"
        ? !minerOnElevatorRail || miner.row >= mine.gear.elevator
        : !minerOnElevatorRail || miner.row <= 0;
    if (atEnd || cashOut.state === "pending") {
      setElevatorAutoDir(null);
      return;
    }
    const timer = setTimeout(() => {
      move(elevatorAutoDir);
    }, elevatorAutoDelayMs(mine.gear));
    return () => clearTimeout(timer);
  }, [
    cashOut.state,
    elevatorAutoDir,
    mine.gear,
    miner.row,
    minerOnElevatorRail,
    move,
  ]);

  useEffect(() => {
    const previousRow = previousMinerRowRef.current;
    previousMinerRowRef.current = miner.row;
    if (cashOut.state === "pending") return;
    if (!(previousRow > 0 && miner.row === 0)) return;
    if (bankedCredits <= 0 && bankedPartsCount <= 0) return;
    const key = `${seed}:${tripIndex}:${movesLength}:${bankedCredits}:${bankedPartsCount}`;
    if (lastAutoCashOutKeyRef.current === key) return;
    lastAutoCashOutKeyRef.current = key;
    void submitCashOut();
  }, [
    bankedCredits,
    bankedPartsCount,
    cashOut.state,
    miner.row,
    movesLength,
    seed,
    submitCashOut,
    tripIndex,
  ]);

  const startElevatorRide = (
    dir: "ride-down" | "ride-up" | "warp-down" | "warp-home",
  ) => {
    setDynamiteMenuOpen(false);
    if (dir === "ride-down" || dir === "ride-up") {
      setElevatorAutoDir(dir);
      move(dir);
      return;
    }
    move(dir);
  };

  const toggleCollectTarget = useCallback((target: CollectTarget) => {
    const key = collectTargetKey(target);
    setCollectSelection((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }, []);

  // One terse toast, game-style: the chips carry the numbers.
  const statusLine =
    lastResult && !lastResult.ok
      ? lastResult.reason === "rock"
        ? "Too hard for this pickaxe."
        : lastResult.reason === "hold-full"
          ? "Hold full. Bank it topside."
          : lastResult.reason === "no-dynamite"
            ? "No dynamite."
            : lastResult.reason === "no-ladder"
              ? "No ladders to climb. Recall or buy more."
              : lastResult.reason === "no-plank"
                ? "No planks to bridge that drop."
                : lastResult.reason === "no-beacon"
                  ? "No beacon. Kits are at the depot."
                  : lastResult.reason === "out-of-range"
                    ? "Beacon out of warpcoil range. Upgrade at the Upgrades stall."
                    : lastResult.reason === "no-rope"
                      ? "No rope."
                      : lastResult.reason === "surface"
                        ? undefined
                        : lastResult.reason === "blocked"
                          ? "No way through."
                          : "Edge of the mine."
      : lastResult?.ok && lastResult.fallFatal
        ? "Fell too far. The crew hauled you out; the cargo stayed below."
        : lastResult?.ok && lastResult.crushed
          ? "Crushed! The crew dug you out; the cargo stayed behind."
          : lastResult?.ok && lastResult.abandoned
            ? "Abandoned the dig; the carry stayed behind."
            : lastResult?.ok && lastResult.collapsed
              ? "Battery drained. Hauled up empty."
              : lastResult?.ok && lastResult.recalled
                ? "Roped home; carry sold."
                : lastResult?.ok && lastResult.exploded
                  ? "Boom!"
                  : lastResult?.ok && lastResult.dynamitePlanted
                    ? "Fuse lit. Move away."
                    : lastResult?.ok && lastResult.plankPlaced
                      ? "Plank placed."
                      : salvagedSupportCount > 0
                        ? `Salvaged ${salvagedSupportCount} support${salvagedSupportCount > 1 ? "s" : ""} for ${salvagedSupportValue} vibes.`
                        : lastResult?.ok && (lastResult.dropped ?? 0) > 0
                          ? `${lastResult.dropped} ore dropped.`
                          : lastResult?.ok && (lastResult.pickedUp ?? 0) > 0
                            ? `Picked up ${lastResult.pickedUp} ore.`
                            : lastResult?.ok && (lastResult.vented ?? 0) > 0
                              ? `Gas! ${(lastResult.vented ?? 0) * 8} charge burned.`
                              : miner.row === 0 &&
                                  (bankedCredits > 0 || bankedPartsCount > 0)
                                ? cashOut.state === "pending"
                                  ? "Selling haul..."
                                  : undefined
                                : miner.row === 0 &&
                                    mine.consumables.ladder === 0
                                  ? "Out of ladders? Buy more at the depot, or a cave-in refills you to 8."
                                  : undefined;
  const cashNote =
    cashOut.state === "done"
      ? `Sold ${cashOut.credits} vibes${cashOut.parts.length > 0 ? ` +${cashOut.parts.length} parts` : ""}. Your mine stays.`
      : cashOut.state === "unavailable"
        ? "Couldn't sell; loot is safe, try again."
        : cashOut.state === "error"
          ? cashOut.message
          : null;

  const act = fireDirection;
  const unlockedDynamiteTier = dynamiteTier(mine.gear);
  const selectedDynamiteLocked = selectedDynamiteTier > unlockedDynamiteTier;
  const selectedDynamitePreview = dynamiteMenuOpen
    ? dynamitePreviewCells(mine, selectedDynamiteTier)
    : [];
  const canConfirmDynamite =
    dynamiteMenuOpen &&
    !selectedDynamiteLocked &&
    mine.consumables.dynamite > 0 &&
    !elevatorAutoDir &&
    !mine.pendingDynamite;
  const dynamiteHelperText = selectedDynamiteLocked
    ? "Locked. Buy this dynamite tier at the Upgrades stall."
    : mine.consumables.dynamite <= 0
      ? "No dynamite packed. Buy sticks at the Supply Depot."
      : mine.pendingDynamite
        ? "One fuse is already lit."
        : null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
      <MineCanvas
        zoom={cameraZoom}
        collectMode={collectMode}
        selectedSupportKeys={collectSelection}
        dynamitePreviewCells={selectedDynamitePreview}
        onToggleSupport={toggleCollectTarget}
      />
      {!collectMode && (
        <MineTouchControls
          onDirection={act}
          onZoomChange={adjustCameraZoom}
          repeatMs={actionRepeatMs(mine.gear)}
        />
      )}
      <StratumBanner row={miner.row} />
      <JuiceOverlays />
      {teleportBurstKey > 0 && (
        <div
          key={teleportBurstKey}
          className="mine-base-teleport-burst"
          aria-hidden="true"
          onAnimationEnd={() => setTeleportBurstKey(0)}
        >
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <ReleaseNotesPopup
        release={appRelease}
        manualOpenCount={releaseNotesOpenCount}
      />
      <StampBookPopup
        open={stampBookOpen}
        onClose={() => setStampBookOpen(false)}
      />
      <button
        type="button"
        aria-label="Open settings"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen((open) => !open)}
        style={{
          position: "absolute",
          top: 58,
          right: 14,
          zIndex: 7,
          width: 42,
          height: 42,
          borderRadius: 12,
          border: "1px solid #26304a",
          background: "rgba(17, 21, 31, 0.88)",
          color: "#e6e8ee",
          fontSize: "1.12rem",
          fontWeight: 800,
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        &#9881;
      </button>
      {settingsOpen && (
        <section
          aria-label="Settings"
          style={{
            position: "absolute",
            top: 108,
            right: 14,
            zIndex: 7,
            width: 210,
            border: "1px solid #26304a",
            borderRadius: 12,
            background: "rgba(17, 21, 31, 0.96)",
            boxShadow: "0 12px 34px rgba(0, 0, 0, 0.42)",
            padding: 10,
            color: "#e6e8ee",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setStampBookOpen(true);
            }}
            style={{
              width: "100%",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #f5c542",
              background: "#2d2616",
              color: "#f5c542",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            Stamp Book
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setReleaseNotesOpenCount((count) => count + 1);
            }}
            style={{
              width: "100%",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: "#172b30",
              color: "#54e0c7",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Release notes
          </button>
        </section>
      )}
      {baseReturn && (
        <>
          <button
            type="button"
            className={`mine-base-indicator mine-base-indicator-${baseReturn.direction}`}
            aria-label={`Base is ${baseReturn.direction}`}
            aria-expanded={baseReturnOpen}
            data-base-direction={baseReturn.direction}
            onClick={() => {
              setBaseReturnOpen((open) => !open);
              setBaseReturnConfirm(false);
            }}
          >
            <span aria-hidden="true">
              {baseReturn.direction === "left" ? "\u2190" : "\u2192"}
            </span>
            <span aria-hidden="true">⌂</span>
          </button>
          {baseReturnOpen && (
            <section
              aria-label="Base return"
              className={`mine-base-return-menu mine-base-return-menu-${baseReturn.direction}`}
            >
              <div style={{ fontWeight: 800, color: "#e6e8ee" }}>
                Base is {baseReturn.distance} cells {baseReturn.direction}
              </div>
              <div style={{ fontSize: "0.82rem", color: "#aab2c7" }}>
                Return to the shaft center on the surface.
              </div>
              <button
                type="button"
                disabled={baseReturnDisabled}
                onClick={() => void handleBaseReturn()}
                style={{
                  width: "100%",
                  minHeight: 44,
                  marginTop: 10,
                  borderRadius: 10,
                  ...baseReturnButtonColors,
                  fontSize: "0.9rem",
                  fontWeight: 800,
                  cursor: baseReturnDisabled ? "not-allowed" : "pointer",
                }}
              >
                {baseReturnPending ? "Teleporting..." : baseReturnButtonLabel}
              </button>
            </section>
          )}
        </>
      )}
      {/* Standing on a stall shows a prompt; the menu opens on tap, not
          on walk-by. Tapping again after close needs another tap. */}
      {stall && openStallCol !== miner.col && (
        <button
          type="button"
          aria-label={`Open ${stall.name}`}
          onClick={() => setOpenStallCol(miner.col)}
          style={{
            position: "absolute",
            bottom: 92,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 999,
            border: `2px solid ${stall.color}`,
            background: "rgba(17, 21, 31, 0.92)",
            color: "#e6e8ee",
            fontWeight: 700,
            fontSize: "0.95rem",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
            zIndex: 8,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>{STALL_ICONS[stall.id]}</span>
          <span style={{ color: stall.color }}>{stall.name}</span>
          <span style={{ opacity: 0.6, fontSize: "0.82rem" }}>Tap to open</span>
        </button>
      )}
      {/* Destination buildings route to another screen on tap. */}
      {destination && (
        <button
          type="button"
          aria-label={`Enter ${destination.name}`}
          onClick={() => router.push(destination.href)}
          style={{
            position: "absolute",
            bottom: 92,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 999,
            border: `2px solid ${destination.color}`,
            background: "rgba(17, 21, 31, 0.92)",
            color: "#e6e8ee",
            fontWeight: 700,
            fontSize: "0.95rem",
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
            zIndex: 8,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>{destination.icon}</span>
          <span style={{ color: destination.color }}>{destination.name}</span>
          <span style={{ opacity: 0.6, fontSize: "0.82rem" }}>
            Tap to enter
          </span>
        </button>
      )}
      {stall && openStallCol === miner.col && (
        <StallMenu
          stall={stall}
          mine={mine}
          gear={gear}
          balance={balance}
          shopNote={shopNote}
          cashOutPending={cashOut.state === "pending"}
          onBuyConsumable={(item, quantity) =>
            void buyConsumable(item, quantity)
          }
          onBuyGear={(track) => void buyGearUpgrade(track)}
          onBuyElevator={() => void buyElevator()}
          onRide={startElevatorRide}
          onClose={() => setOpenStallCol(null)}
        />
      )}

      {/* Chip HUD (REQ-024): thin, glanceable, game-first. Data
          attributes are the stable test surface; copy can change. */}
      <section
        aria-label="Mine status"
        data-depth={miner.row}
        data-horizontal-distance={horizontalDistance}
        data-energy={miner.energy.toFixed(1)}
        data-ladders={mine.consumables.ladder}
        data-planks={mine.consumables.plank}
        data-banked={miner.bankedCredits}
        data-wallet={balance ?? ""}
        data-climb-ladders={laddersNeeded}
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          right: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 6,
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            maxWidth: "calc(100% - 250px)",
          }}
        >
          <span style={{ ...chipStyle, color: "#f5c542", fontWeight: 700 }}>
            &#129689; {balance === null ? "offline" : `${balance} vibes`}
          </span>
          <span style={chipStyle}>
            <span style={{ opacity: 0.65 }}>&#9660;</span> Depth {miner.row}{" "}
            <span style={{ opacity: 0.65 }}>{stratum.name}</span>
            <span style={{ opacity: 0.65 }}> | Base </span>
            {horizontalDistanceLabel}
          </span>
          <span
            style={{
              ...chipStyle,
              position: "relative",
              overflow: "hidden",
              minWidth: 118,
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                width: `${Math.max(0, Math.min(100, (miner.energy / maxEnergy(mine.gear)) * 100))}%`,
                background: batteryLow ? "#ff6b6b" : "#54e0c7",
                opacity: 0.3,
              }}
            />
            <span style={{ position: "relative" }}>
              &#128267; {miner.energy.toFixed(1)}/{maxEnergy(mine.gear)}
            </span>
          </span>
          <span style={chipStyle}>
            &#127890; {carriedCount(miner)}/{cargoCapacity(mine.gear)}
          </span>
          {(carryValue > 0 || miner.carriedParts.length > 0) && (
            <span style={{ ...chipStyle, color: "#f5c542" }}>
              &#128176; {carryValue} vibes
              {miner.carriedParts.length > 0 &&
                ` +${miner.carriedParts.length}p`}
            </span>
          )}
        </div>
        {statusLine && (
          <span style={{ ...chipStyle, color: "#f5c542" }}>{statusLine}</span>
        )}
        {cashNote && cashNoteVisible && (
          <span
            style={{
              ...chipStyle,
              color: cashOut.state === "error" ? "#ff6b6b" : "#54e0c7",
            }}
          >
            {cashNote}
          </span>
        )}
        {lostCargo && (
          <span
            className="mine-lost-locator"
            title={`Dropped cargo locator, ${lostDistance} cells away`}
            style={{
              ...chipStyle,
              color: lostDistance <= 1 ? "#f5c542" : "#ff9f6b",
              borderColor:
                lostDistance <= 1
                  ? "rgba(245, 197, 66, 0.75)"
                  : "rgba(255, 159, 107, 0.55)",
              animationDuration: `${lostPulseSeconds}s`,
            }}
          >
            &#128229;{" "}
            {lostDistance === 0
              ? "Dropped cargo here"
              : `Dropped cargo ${lostDistance} cells away`}
          </span>
        )}
      </section>

      {collectMode && (
        <section
          aria-label="Support salvage"
          style={{
            position: "absolute",
            right: 12,
            bottom: 82,
            zIndex: 6,
            width: "min(300px, calc(100vw - 24px))",
            border: "1px solid #26304a",
            borderRadius: 12,
            background: "rgba(17, 21, 31, 0.96)",
            boxShadow: "0 12px 34px rgba(0, 0, 0, 0.42)",
            padding: 10,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <span style={{ ...chipStyle, color: "#8b93a7" }}>
              {visibleSupports.length === 0
                ? "no visible supports"
                : "tap visible supports"}
            </span>
            <span style={{ ...chipStyle, color: "#54e0c7" }}>
              {selectedSupports.length} selected, {selectedSupportValue} vibes
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              aria-label="Confirm support salvage"
              disabled={selectedSupports.length === 0}
              onClick={() => {
                move(collectAction(selectedSupports));
                setCollectSelection([]);
                setCollectMode(false);
              }}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: 10,
                border: "1px solid #54e0c7",
                background:
                  selectedSupports.length > 0
                    ? "#172b30"
                    : "rgba(23, 43, 48, 0.35)",
                color: selectedSupports.length > 0 ? "#54e0c7" : "#8b93a7",
                fontWeight: 800,
                cursor: selectedSupports.length > 0 ? "pointer" : "default",
              }}
            >
              Salvage
            </button>
            <button
              type="button"
              aria-label="Cancel support salvage"
              onClick={() => {
                setCollectSelection([]);
                setCollectMode(false);
              }}
              style={{
                minWidth: 78,
                minHeight: 40,
                borderRadius: 10,
                border: "1px solid #2c3a5c",
                background: "rgba(38, 48, 74, 0.55)",
                color: "#cdd6ea",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Consumable cluster: thumb-reach icon buttons. Movement is the
          thumbstick (or WASD/arrows); the D-pad is gone. */}
      <section
        aria-label="Dig controls"
        style={{
          position: "absolute",
          right: 12,
          bottom: 18,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "flex-end",
          maxWidth: "calc(100vw - 24px)",
          zIndex: 5,
        }}
      >
        <span
          style={{
            ...chipStyle,
            color: ladderShort ? "#ff6b6b" : "#8b93a7",
          }}
        >
          &#129692; {mine.consumables.ladder}
        </span>
        <span style={{ ...chipStyle, color: "#8b93a7" }}>
          &#129717; {mine.consumables.plank}
        </span>
        {miner.row >= 1 && currentCell?.ladder && (
          <button
            type="button"
            aria-label="Salvage ladder"
            onClick={() => {
              setDynamiteMenuOpen(false);
              if (!elevatorAutoDir) move("collect-ladder");
            }}
            disabled={!!elevatorAutoDir}
            style={iconButtonStyle}
          >
            &#129692;&#8593;
          </button>
        )}
        <button
          type="button"
          aria-label={`Place plank ${facing}`}
          onClick={() => {
            setDynamiteMenuOpen(false);
            move(`plank-${facing}` as MineAction);
          }}
          disabled={!plankEnabled}
          style={{
            ...iconButtonStyle,
            opacity: plankEnabled ? 1 : 0.42,
            cursor: plankEnabled ? "pointer" : "default",
          }}
        >
          &#129717; {facing === "left" ? "\u25C0" : "\u25B6"}
        </button>
        <button
          type="button"
          aria-label="Salvage placed supports"
          aria-pressed={collectMode}
          onClick={() => {
            setDynamiteMenuOpen(false);
            setCollectMode((open) => !open);
          }}
          disabled={!collectMode && visibleSupports.length === 0}
          style={{
            ...iconButtonStyle,
            opacity: collectMode || visibleSupports.length > 0 ? 1 : 0.42,
            cursor:
              collectMode || visibleSupports.length > 0 ? "pointer" : "default",
            ...(collectMode
              ? {
                  background: "#172b30",
                  borderColor: "#54e0c7",
                  color: "#54e0c7",
                }
              : null),
          }}
        >
          &#8635;
        </button>
        <div style={{ position: "relative", pointerEvents: "auto" }}>
          <button
            type="button"
            aria-label={`Dynamite ${DYNAMITE_TIER_LABELS[selectedDynamiteTier]} (${mine.consumables.dynamite})`}
            onClick={() => setDynamiteMenuOpen((open) => !open)}
            disabled={!!elevatorAutoDir}
            aria-pressed={dynamiteMenuOpen}
            style={{
              ...iconButtonStyle,
              ...(dynamiteMenuOpen
                ? {
                    background: "#3a2430",
                    borderColor: "#ffb347",
                    boxShadow: "0 0 12px rgba(255, 179, 71, 0.42)",
                  }
                : null),
            }}
          >
            &#129512; {mine.consumables.dynamite} &#9662;
          </button>
          {dynamiteMenuOpen && (
            <div
              role="menu"
              aria-label="Dynamite tiers"
              style={{
                position: "absolute",
                right: 0,
                bottom: 54,
                width: 260,
                padding: 10,
                borderRadius: 12,
                border: "1px solid #34415f",
                background: "rgba(10, 13, 20, 0.96)",
                color: "#e6e8ee",
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.38)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                {DYNAMITE_TIERS.map((tier) => {
                  const selected = tier === selectedDynamiteTier;
                  const locked = tier > unlockedDynamiteTier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => setSelectedDynamiteTier(tier)}
                      style={{
                        border: selected
                          ? "1px solid #ffb347"
                          : "1px solid #2c3a5c",
                        background: selected
                          ? "rgba(255, 179, 71, 0.16)"
                          : "rgba(38, 48, 74, 0.55)",
                        color: locked ? "#8b93a7" : "#f5efe3",
                        borderRadius: 8,
                        padding: "8px 6px",
                        textAlign: "left",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      T{tier} {DYNAMITE_TIER_LABELS[tier]}
                      {locked ? " lock" : ""}
                    </button>
                  );
                })}
              </div>
              <p
                style={{
                  margin: "8px 0 10px",
                  fontSize: "0.72rem",
                  opacity: 0.78,
                }}
              >
                {DYNAMITE_TIER_BLURBS[selectedDynamiteTier]}
              </p>
              {dynamiteHelperText && (
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: "0.72rem",
                    color: "#ffcf7a",
                  }}
                >
                  {dynamiteHelperText}
                </p>
              )}
              <button
                type="button"
                aria-label={`Deploy tier ${selectedDynamiteTier} dynamite`}
                disabled={!canConfirmDynamite}
                onClick={() => {
                  if (!canConfirmDynamite) return;
                  setDynamiteMenuOpen(false);
                  move(`dynamite-${selectedDynamiteTier}` as MineAction);
                }}
                style={{
                  ...sheetButtonStyle(canConfirmDynamite),
                  width: "100%",
                  minHeight: 36,
                }}
              >
                &#10003; Deploy
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label={`Recall (${mine.consumables.rope})`}
          onClick={() => {
            setDynamiteMenuOpen(false);
            if (!elevatorAutoDir) move("recall");
          }}
          disabled={
            !!elevatorAutoDir || mine.consumables.rope <= 0 || miner.row === 0
          }
          style={iconButtonStyle}
        >
          &#129526; {mine.consumables.rope}
        </button>
        {miner.row >= 1 && mine.consumables.beacon > 0 && (
          <button
            type="button"
            aria-label="Plant warp beacon"
            onClick={() => {
              if (!elevatorAutoDir) move("place-beacon");
            }}
            disabled={!!elevatorAutoDir}
            style={iconButtonStyle}
          >
            &#128225; {mine.consumables.beacon}
          </button>
        )}
        {(() => {
          const beacon = findBeacon(mine);
          return (
            beacon &&
            miner.row === beacon.row &&
            miner.col === beacon.col &&
            beacon.row <= warpRange(mine.gear) && (
              <button
                type="button"
                aria-label="Warp home"
                onClick={() => {
                  if (!elevatorAutoDir) move("warp-home");
                }}
                disabled={!!elevatorAutoDir}
                style={iconButtonStyle}
              >
                &#127756;
              </button>
            )
          );
        })()}
        {canRideElevatorDown && (
          <button
            type="button"
            aria-label="Ride elevator down"
            onClick={() => startElevatorRide("ride-down")}
            disabled={!!elevatorAutoDir}
            style={iconButtonStyle}
          >
            &#128727;&#11015;&#65039;
          </button>
        )}
        {canRideElevatorUp && (
          <button
            type="button"
            aria-label="Ride elevator up"
            onClick={() => startElevatorRide("ride-up")}
            disabled={!!elevatorAutoDir}
            style={iconButtonStyle}
          >
            &#128727;&#11014;&#65039;
          </button>
        )}
        <button
          type="button"
          aria-label="Abandon trip"
          onClick={() => {
            if (abandonArmed) {
              setAbandonArmed(false);
              setDynamiteMenuOpen(false);
              move("abandon");
            } else {
              setAbandonArmed(true);
            }
          }}
          disabled={!!elevatorAutoDir || miner.row === 0}
          style={{
            ...iconButtonStyle,
            ...(abandonArmed
              ? {
                  background: "#7a2c2c",
                  borderColor: "#ff6b6b",
                  color: "#ffd9d9",
                }
              : null),
          }}
        >
          {abandonArmed ? "Sure?" : <>&#127987;</>}
        </button>
      </section>

      {/* One-shot onboarding: gone after the first action. */}
      {tick === 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 88,
            left: "50%",
            transform: "translateX(-50%)",
            ...chipStyle,
            color: "#8b93a7",
            pointerEvents: "none",
          }}
        >
          {coarsePointer
            ? "drag anywhere to move"
            : "drag anywhere to move \u00b7 WASD works too"}
        </div>
      )}
    </div>
  );
}
