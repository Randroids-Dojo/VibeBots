import { MINE_VERSION } from "@/sim/mine";
import packageJson from "../../package.json";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

export type BalanceEventName =
  | "mine.cash_out"
  | "gear.upgrade"
  | "consumable.purchase"
  | "base_part.purchase"
  | "elevator.upgrade"
  | "bunker.raid_reward"
  | "bunker.live_raid_reward";

export type BalanceEventProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

export async function recordBalanceEvent(
  sql: Sql,
  playerId: string,
  event: BalanceEventName,
  properties: BalanceEventProperties,
): Promise<void> {
  await sql`
    INSERT INTO player_balance_events (
      player_id,
      event,
      app_version,
      mine_version,
      properties
    )
    VALUES (
      ${playerId},
      ${event},
      ${packageJson.version},
      ${MINE_VERSION},
      ${JSON.stringify(properties)}::jsonb
    )`;
}
