import { createHash } from "node:crypto";

type MonitoringSeverity = "info" | "warn" | "error";

export interface MineCashOutMonitoringEvent {
  code:
    | "cash_out_failed"
    | "consumables_not_owned"
    | "gear_not_owned"
    | "legacy_support_reconciled"
    | "mine_version_mismatch"
    | "no_mine_on_file"
    | "player_not_found"
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
  detail?: string;
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function writeMonitoringLog(
  severity: MonitoringSeverity,
  payload: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    source: "vibebots",
    component: "mine.cash_out",
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
  writeMonitoringLog(severity, {
    event: `mine.cash_out.${event.code}`,
    player: playerId ? hashIdentifier(playerId) : undefined,
    ...rest,
  });
}
