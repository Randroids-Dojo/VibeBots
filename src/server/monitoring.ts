import { createHash } from "node:crypto";

type MonitoringSeverity = "info" | "warn" | "error";

export interface MineCashOutMonitoringEvent {
  code:
    | "cash_out_failed"
    | "cash_out_succeeded"
    | "consumables_not_owned"
    | "gear_not_owned"
    | "invalid_json_body"
    | "legacy_support_reconciled"
    | "mine_version_mismatch"
    | "no_mine_on_file"
    | "player_not_found"
    | "request_validation_failed"
    | "storage_not_configured"
    | "trip_already_cashed_out"
    | "wrong_mine_seed";
  severity: MonitoringSeverity;
  playerId?: string;
  tripIndex?: number;
  moveCount?: number;
  seed?: number;
  mineVersion?: number;
  expectedMineVersion?: number;
  worldTripIndex?: number;
  submitted?: unknown;
  owned?: unknown;
  replay?: unknown;
  charged?: unknown;
  credited?: unknown;
  remaining?: unknown;
  request?: unknown;
  issues?: unknown;
  detail?: string;
}

export interface MineClientDiagnosticEvent {
  code:
    | "touch_surface_missing"
    | "touch_surface_not_topmost"
    | "movement_layer_disabled";
  severity: MonitoringSeverity;
  playerId?: string;
  appVersion?: string;
  appBuild?: number | null;
  mineVersion?: number;
  activeSlot?: number;
  minerRow?: number;
  hasActiveBunker?: boolean;
  bunkerPanelOpen?: boolean;
  activeBunkerRaid?: boolean;
  collectMode?: boolean;
  creditsOpen?: boolean;
  mineSceneReady?: boolean;
  movementTouchEnabled?: boolean;
  displayMode?: string | null;
  viewport?: unknown;
  target?: unknown;
  detail?: string;
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function writeMonitoringLog(
  severity: MonitoringSeverity,
  component: string,
  payload: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    source: "vibebots",
    component,
    alert: severity !== "info",
    severity,
    ...payload,
  });
  if (severity === "error") {
    console.error(line);
    return;
  }
  if (severity === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function logMineCashOutEvent(event: MineCashOutMonitoringEvent): void {
  const { playerId, severity, ...rest } = event;
  writeMonitoringLog(severity, "mine.cash_out", {
    event: `mine.cash_out.${event.code}`,
    player: playerId ? hashIdentifier(playerId) : undefined,
    ...rest,
  });
}

export function logMineClientDiagnosticEvent(
  event: MineClientDiagnosticEvent,
): void {
  const { playerId, severity, ...rest } = event;
  writeMonitoringLog(severity, "mine.client_diagnostic", {
    event: `mine.client_diagnostic.${event.code}`,
    player: playerId ? hashIdentifier(playerId) : undefined,
    ...rest,
  });
}

export function logSaveSlotEvent(payload: {
  event: string;
  activeSlot: number;
  requestedSlot?: number;
  currentPlayerId?: string | null;
  selectedPlayerId?: string | null;
  created?: boolean;
  accepted?: boolean;
  reason?: string;
  referrerHost?: string | null;
  secFetchSite?: string | null;
}): void {
  const { currentPlayerId, selectedPlayerId, ...rest } = payload;
  console.info(
    JSON.stringify({
      source: "vibebots",
      component: "save_slots",
      alert: false,
      severity: "info",
      currentPlayer: currentPlayerId
        ? hashIdentifier(currentPlayerId)
        : undefined,
      selectedPlayer: selectedPlayerId
        ? hashIdentifier(selectedPlayerId)
        : undefined,
      ...rest,
    }),
  );
}
