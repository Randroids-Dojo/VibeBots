import { getAppRelease } from "@/lib/app-release";
import { db, storageConfigured } from "@/server/db";
import {
  sendReleasePushNotifications,
  webPushConfigured,
} from "@/server/web-push";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const token = process.env.NOTIFICATION_ADMIN_TOKEN;
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  if (!webPushConfigured()) {
    return Response.json({ error: "web push not configured" }, { status: 503 });
  }
  const sql = await db();
  const release = getAppRelease();
  const result = await sendReleasePushNotifications(sql, release);
  return Response.json({
    releaseNoticeId: release.noticeId,
    releaseVersion: release.version,
    ...result,
  });
}
