import webpush, { type PushSubscription } from "web-push";
import type { AppRelease } from "@/lib/app-release-types";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ReleasePushResult {
  attempted: number;
  sent: number;
  expired: number;
  failed: number;
}

export interface ReleasePushDispatchResult extends ReleasePushResult {
  dispatched: boolean;
}

export function webPushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export function webPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureWebPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    `mailto:${process.env.WEB_PUSH_CONTACT_EMAIL ?? "support@randroid.dev"}`,
    publicKey,
    privateKey,
  );
  return true;
}

export function releaseNotificationSummary(release: AppRelease): string {
  const newest = release.notes[0];
  const detail =
    newest?.intro ??
    release.intro ??
    release.changes[0]?.text ??
    "Fresh build deployed.";
  return newest ? `${newest.title}: ${detail}` : detail;
}

function releaseNotificationPayload(release: AppRelease): string {
  return JSON.stringify({
    type: "release",
    noticeId: release.noticeId,
    title: "VibeBots update",
    body: releaseNotificationSummary(release),
    url: "/mine",
  });
}

export async function upsertWebPushSubscription({
  sql,
  playerId,
  subscription,
  platform,
  userAgent,
}: {
  sql: Sql;
  playerId: string;
  subscription: PushSubscription;
  platform: string;
  userAgent: string;
}): Promise<void> {
  await sql`
    INSERT INTO web_push_subscriptions (
      player_id,
      endpoint,
      p256dh,
      auth,
      platform,
      user_agent,
      enabled,
      updated_at
    )
    VALUES (
      ${playerId},
      ${subscription.endpoint},
      ${subscription.keys.p256dh},
      ${subscription.keys.auth},
      ${platform},
      ${userAgent},
      true,
      now()
    )
    ON CONFLICT (endpoint)
    DO UPDATE SET
      player_id = EXCLUDED.player_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      platform = EXCLUDED.platform,
      user_agent = EXCLUDED.user_agent,
      enabled = true,
      updated_at = now()`;
}

export async function disableWebPushSubscription(
  sql: Sql,
  endpoint: string,
): Promise<void> {
  await sql`
    UPDATE web_push_subscriptions
    SET enabled = false,
        updated_at = now()
    WHERE endpoint = ${endpoint}`;
}

async function markReleaseSent(
  sql: Sql,
  endpoint: string,
  noticeId: string,
): Promise<void> {
  await sql`
    UPDATE web_push_subscriptions
    SET last_release_notice_id = ${noticeId},
        last_sent_at = now(),
        updated_at = now()
    WHERE endpoint = ${endpoint}`;
}

export async function releasePushTargets(
  sql: Sql,
  noticeId: string,
): Promise<StoredPushSubscription[]> {
  const rows = (await sql`
    SELECT endpoint, p256dh, auth
    FROM web_push_subscriptions
    WHERE enabled = true
      AND (
        last_release_notice_id IS NULL
        OR last_release_notice_id <> ${noticeId}
      )
    ORDER BY created_at ASC`) as StoredPushSubscription[];
  return rows;
}

async function claimReleasePushDispatch(
  sql: Sql,
  release: AppRelease,
): Promise<boolean> {
  const inserted = (await sql`
    INSERT INTO release_push_dispatches (
      notice_id,
      release_version,
      status,
      started_at,
      updated_at
    )
    VALUES (
      ${release.noticeId},
      ${release.version},
      'sending',
      now(),
      now()
    )
    ON CONFLICT DO NOTHING
    RETURNING notice_id`) as { notice_id: string }[];
  if (inserted.length > 0) return true;

  const retried = (await sql`
    UPDATE release_push_dispatches
    SET status = 'sending',
        started_at = now(),
        updated_at = now()
    WHERE notice_id = ${release.noticeId}
      AND status IN ('failed', 'partial', 'sending')
      AND updated_at < now() - interval '15 minutes'
    RETURNING notice_id`) as { notice_id: string }[];
  return retried.length > 0;
}

async function finishReleasePushDispatch(
  sql: Sql,
  release: AppRelease,
  result: ReleasePushResult,
): Promise<void> {
  await sql`
    UPDATE release_push_dispatches
    SET status = ${result.failed > 0 ? "partial" : "sent"},
        attempted = ${result.attempted},
        sent = ${result.sent},
        expired = ${result.expired},
        failed = ${result.failed},
        finished_at = now(),
        updated_at = now()
    WHERE notice_id = ${release.noticeId}`;
}

async function failReleasePushDispatch(
  sql: Sql,
  release: AppRelease,
): Promise<void> {
  await sql`
    UPDATE release_push_dispatches
    SET status = 'failed',
        failed = failed + 1,
        updated_at = now()
    WHERE notice_id = ${release.noticeId}`;
}

function toWebPushSubscription(row: StoredPushSubscription): PushSubscription {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

function isExpiredPushError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

export async function sendReleasePushNotifications(
  sql: Sql,
  release: AppRelease,
): Promise<ReleasePushResult> {
  if (!configureWebPush()) {
    throw new Error("web push is not configured");
  }
  const targets = await releasePushTargets(sql, release.noticeId);
  const result: ReleasePushResult = {
    attempted: targets.length,
    sent: 0,
    expired: 0,
    failed: 0,
  };
  const payload = releaseNotificationPayload(release);
  for (const target of targets) {
    try {
      await webpush.sendNotification(toWebPushSubscription(target), payload);
      await markReleaseSent(sql, target.endpoint, release.noticeId);
      result.sent += 1;
    } catch (error) {
      if (isExpiredPushError(error)) {
        await disableWebPushSubscription(sql, target.endpoint);
        result.expired += 1;
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
}

export async function dispatchReleasePushOnce(
  sql: Sql,
  release: AppRelease,
): Promise<ReleasePushDispatchResult> {
  const claimed = await claimReleasePushDispatch(sql, release);
  if (!claimed) {
    return {
      dispatched: false,
      attempted: 0,
      sent: 0,
      expired: 0,
      failed: 0,
    };
  }
  try {
    const result = await sendReleasePushNotifications(sql, release);
    await finishReleasePushDispatch(sql, release, result);
    return { dispatched: true, ...result };
  } catch (error) {
    await failReleasePushDispatch(sql, release);
    throw error;
  }
}
