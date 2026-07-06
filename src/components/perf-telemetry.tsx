"use client";

import { useEffect, useState } from "react";
import {
  PERF_ANALYZER_CHANGED_EVENT,
  perfAnalyzerEnabled,
  readPerfAbVariant,
} from "@/lib/perf-analyzer-settings";
import {
  buildPerfSnapshot,
  type PerfMainThreadSample,
  type PerfSnapshot,
  type PerfSource,
} from "@/lib/perf-trace";
import {
  hasCoarsePointer,
  readStoredGraphicsQuality,
  resolveGraphicsQualityTier,
} from "./graphics-quality";
import { readPerfProbe } from "./perf-probe";

const SNAPSHOT_MS = 5_000;
const FLUSH_MS = 20_000;
const MAX_BUFFERED_SNAPSHOTS = 6;
const INPUT_EVENT_THRESHOLD_MS = 40;

interface PerfTraceWindowOverrides {
  __vibebotsPerfTraceSnapshotMs?: number;
  __vibebotsPerfTraceFlushMs?: number;
}

function traceOverride(
  key: keyof PerfTraceWindowOverrides,
  fallback: number,
): number {
  const value = (window as Window & PerfTraceWindowOverrides)[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function randomSessionId(): string {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
  }
}

function jsHeapMb(): number | null {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    }
  ).memory;
  const used = memory?.usedJSHeapSize;
  return typeof used === "number" && Number.isFinite(used)
    ? Math.round((used / (1024 * 1024)) * 10) / 10
    : null;
}

function browserNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function connectionType(): string | null {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string };
    }
  ).connection;
  return typeof connection?.effectiveType === "string"
    ? connection.effectiveType.slice(0, 20)
    : null;
}

/** GPU identity: WebGPU adapter info, else the unmasked WebGL string. */
async function readGpuInfo(): Promise<string | null> {
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: {
          requestAdapter?: () => Promise<{
            info?: Record<string, unknown>;
          } | null>;
        };
      }
    ).gpu;
    const adapter = await gpu?.requestAdapter?.();
    const info = adapter?.info;
    if (info) {
      const label = ["vendor", "architecture", "device", "description"]
        .map((key) => info[key])
        .filter((value) => typeof value === "string" && value !== "")
        .join(" ");
      if (label !== "") return label.slice(0, 200);
    }
  } catch {}
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return null;
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const value = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return typeof value === "string" ? value.slice(0, 200) : null;
  } catch {
    return null;
  }
}

interface MainThreadWindow {
  longTaskCount: number;
  longTaskTotalMs: number;
  loafCount: number;
  loafTotalMs: number;
  loafMaxMs: number;
  loafScriptMs: Map<string, number>;
  inputEventCount: number;
  inputEventMaxMs: number;
}

function emptyMainThreadWindow(): MainThreadWindow {
  return {
    longTaskCount: 0,
    longTaskTotalMs: 0,
    loafCount: 0,
    loafTotalMs: 0,
    loafMaxMs: 0,
    loafScriptMs: new Map(),
    inputEventCount: 0,
    inputEventMaxMs: 0,
  };
}

function summarizeMainThreadWindow(
  window: MainThreadWindow,
  loafSupported: boolean,
  longTaskSupported: boolean,
): PerfMainThreadSample {
  return {
    longTaskCount: longTaskSupported ? window.longTaskCount : null,
    longTaskTotalMs: longTaskSupported ? window.longTaskTotalMs : null,
    loafCount: loafSupported ? window.loafCount : null,
    loafTotalMs: loafSupported ? window.loafTotalMs : null,
    loafMaxMs: loafSupported ? window.loafMaxMs : null,
    loafTopScripts: [...window.loafScriptMs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([url, ms]) => ({ url, ms })),
    inputEventCount: window.inputEventCount,
    inputEventMaxMs: window.inputEventMaxMs,
  };
}

interface LoafScriptEntry {
  duration?: number;
  sourceURL?: string;
  invoker?: string;
}

/**
 * The opt-in deep performance collector (F-054). While the settings
 * toggle is on and the page is visible, it samples frame deltas every
 * animation frame, observes main-thread stalls (long animation frames,
 * long tasks, slow input events), and every few seconds pairs those
 * with the canvas probe (renderer info, scene composition, GPU pass
 * time) into a snapshot. Snapshots batch into POST /api/performance/
 * trace. Zero observers and zero frame work while the toggle is off.
 */
export function PerfTelemetry({
  source,
  appVersion,
  appBuild,
  mineVersion,
}: {
  source: PerfSource;
  appVersion: string;
  appBuild: number | null;
  mineVersion?: number;
}) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const refresh = () => setEnabled(perfAnalyzerEnabled());
    refresh();
    window.addEventListener(PERF_ANALYZER_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PERF_ANALYZER_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let frame = 0;
    let snapshotTimer = 0;
    const sessionId = randomSessionId();
    const snapshotMs = traceOverride(
      "__vibebotsPerfTraceSnapshotMs",
      SNAPSHOT_MS,
    );
    const flushMs = traceOverride("__vibebotsPerfTraceFlushMs", FLUSH_MS);

    let seq = 0;
    let frameSamples: number[] = [];
    let windowStartedAt = performance.now();
    let previousFrameAt: number | null = null;
    let mainWindow = emptyMainThreadWindow();
    let buffer: PerfSnapshot[] = [];
    let lastFlushAt = performance.now();
    let gpuInfo: string | null = null;
    void readGpuInfo().then((value) => {
      gpuInfo = value;
    });

    const collectFrame = (now: number) => {
      if (cancelled) return;
      if (previousFrameAt !== null) frameSamples.push(now - previousFrameAt);
      previousFrameAt = now;
      frame = requestAnimationFrame(collectFrame);
    };
    frame = requestAnimationFrame(collectFrame);

    let loafSupported = false;
    let longTaskSupported = false;
    const observers: PerformanceObserver[] = [];
    const observe = (
      type: string,
      handle: (entries: PerformanceEntry[]) => void,
      options: PerformanceObserverInit = {},
    ): boolean => {
      try {
        const observer = new PerformanceObserver((list) =>
          handle(list.getEntries()),
        );
        observer.observe({ type, ...options } as PerformanceObserverInit);
        observers.push(observer);
        return true;
      } catch {
        return false;
      }
    };
    loafSupported = observe("long-animation-frame", (entries) => {
      for (const entry of entries) {
        mainWindow.loafCount += 1;
        mainWindow.loafTotalMs += entry.duration;
        mainWindow.loafMaxMs = Math.max(mainWindow.loafMaxMs, entry.duration);
        const scripts = (
          entry as PerformanceEntry & {
            scripts?: LoafScriptEntry[];
          }
        ).scripts;
        for (const script of scripts ?? []) {
          const url = script.sourceURL || script.invoker || "unknown";
          const ms = script.duration ?? 0;
          mainWindow.loafScriptMs.set(
            url,
            (mainWindow.loafScriptMs.get(url) ?? 0) + ms,
          );
        }
      }
    });
    longTaskSupported = observe("longtask", (entries) => {
      for (const entry of entries) {
        mainWindow.longTaskCount += 1;
        mainWindow.longTaskTotalMs += entry.duration;
      }
    });
    observe(
      "event",
      (entries) => {
        for (const entry of entries) {
          mainWindow.inputEventCount += 1;
          mainWindow.inputEventMaxMs = Math.max(
            mainWindow.inputEventMaxMs,
            entry.duration,
          );
        }
      },
      { durationThreshold: INPUT_EVENT_THRESHOLD_MS } as never,
    );

    const flush = (useBeacon: boolean) => {
      if (buffer.length === 0) return;
      const snapshots = buffer;
      buffer = [];
      lastFlushAt = performance.now();
      const canvas = document.querySelector("canvas");
      const body = JSON.stringify({
        source,
        sessionId,
        appVersion,
        appBuild,
        mineVersion: mineVersion ?? null,
        renderer:
          canvas instanceof HTMLCanvasElement
            ? (canvas.dataset.renderer ?? null)
            : null,
        qualityTier: resolveGraphicsQualityTier(
          readStoredGraphicsQuality(),
          hasCoarsePointer(),
        ),
        abVariant: readPerfAbVariant(),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        hardwareConcurrency: browserNumber(navigator.hardwareConcurrency),
        deviceMemoryGb: browserNumber(
          (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        ),
        gpu: gpuInfo,
        connectionType: connectionType(),
        visibilityState: document.visibilityState,
        snapshots,
      });
      fetch("/api/performance/trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: useBeacon,
      }).catch(() => {});
    };

    const takeSnapshot = () => {
      if (cancelled) return;
      const now = performance.now();
      // Two frames is the floor: a device crawling at under 1 fps is
      // exactly the kind of session this telemetry exists to explain.
      if (document.visibilityState === "visible" && frameSamples.length >= 2) {
        seq += 1;
        buffer.push(
          buildPerfSnapshot({
            seq,
            durationMs: now - windowStartedAt,
            frameMs: frameSamples,
            jsHeapMb: jsHeapMb(),
            main: summarizeMainThreadWindow(
              mainWindow,
              loafSupported,
              longTaskSupported,
            ),
            probe: readPerfProbe(source),
          }),
        );
      }
      frameSamples = [];
      mainWindow = emptyMainThreadWindow();
      windowStartedAt = now;
      previousFrameAt = null;
      if (
        buffer.length >= MAX_BUFFERED_SNAPSHOTS ||
        now - lastFlushAt >= flushMs
      ) {
        flush(false);
      }
      snapshotTimer = window.setTimeout(takeSnapshot, snapshotMs);
    };
    snapshotTimer = window.setTimeout(takeSnapshot, snapshotMs);

    const flushNow = () => flush(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flush(true);
        return;
      }
      // Resuming from background: rAF was paused, so the next frame's
      // delta would span the whole hidden gap and corrupt the window.
      previousFrameAt = null;
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(snapshotTimer);
      for (const observer of observers) observer.disconnect();
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush(true);
    };
  }, [enabled, source, appVersion, appBuild, mineVersion]);

  return null;
}
