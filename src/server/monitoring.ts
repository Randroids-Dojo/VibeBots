import { createHash } from "node:crypto";
import type {
  MINE_VERSION_MISMATCH_CODE,
  TRIP_ALREADY_CASHED_OUT_CODE,
} from "@/lib/api-codes";

type MonitoringSeverity = "info" | "warn" | "error";

export interface MineCashOutMonitoringEvent {
  code:
    | "cash_out_failed"
    | "cash_out_succeeded"
    | "consumables_not_owned"
    | "elevator_rail_migration_required"
    | "gear_not_owned"
    | "invalid_json_body"
    | "legacy_support_reconciled"
    | typeof MINE_VERSION_MISMATCH_CODE
    | "no_mine_on_file"
    | "player_not_found"
    | "request_validation_failed"
    | "storage_not_configured"
    | typeof TRIP_ALREADY_CASHED_OUT_CODE
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
    | "movement_disabled_by_bunker_panel"
    | "bunker_overlay_during_terminal"
    | "saved_trip_replay_collapsed";
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

export interface AppClientErrorEvent {
  code: "react_error_boundary" | "global_error" | "unhandled_rejection";
  severity: MonitoringSeverity;
  playerId?: string;
  source?: "app" | "global" | "window";
  appVersion?: string;
  path?: string;
  message?: string;
  digest?: string | null;
  stack?: string;
  userAgent?: string;
}

export interface AccountLinkMonitoringEvent {
  code:
    | "claim_already_linked"
    | "claim_conflict"
    | "claim_failed"
    | "claim_invalid_identity"
    | "claim_player_not_found"
    | "claim_succeeded"
    | "claim_target_linked_to_other_account"
    | "cloud_load_invalid_identity"
    | "cloud_load_not_found"
    | "cloud_load_succeeded"
    | "handoff_already_linked"
    | "handoff_conflict"
    | "handoff_expired"
    | "handoff_invalid_identity"
    | "handoff_missing_initiating_session"
    | "handoff_player_not_found"
    | "handoff_start_missing_player"
    | "handoff_started"
    | "handoff_succeeded"
    | "handoff_target_linked_to_other_account";
  severity: MonitoringSeverity;
  provider?: string;
  subject?: string;
  playerId?: string | null;
  targetPlayerId?: string | null;
  activeSlot?: number;
  result?: string;
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

export function logAppClientErrorEvent(event: AppClientErrorEvent): void {
  const { playerId, severity, source, ...rest } = event;
  writeMonitoringLog(severity, "app.client_error", {
    event: `app.client_error.${event.code}`,
    player: playerId ? hashIdentifier(playerId) : undefined,
    errorSource: source,
    ...rest,
  });
}

export function logAccountLinkEvent(event: AccountLinkMonitoringEvent): void {
  const { playerId, targetPlayerId, provider, subject, severity, ...rest } =
    event;
  writeMonitoringLog(severity, "account.link", {
    event: `account.link.${event.code}`,
    provider,
    account:
      provider && subject
        ? hashIdentifier(`${provider}:${subject}`)
        : undefined,
    player: playerId ? hashIdentifier(playerId) : undefined,
    targetPlayer: targetPlayerId ? hashIdentifier(targetPlayerId) : undefined,
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
