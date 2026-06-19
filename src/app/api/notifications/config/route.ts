import { getAppRelease } from "@/lib/app-release";
import {
  releaseNotificationSummary,
  webPushConfigured,
  webPushPublicKey,
} from "@/server/web-push";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const release = getAppRelease();
  return Response.json({
    configured: webPushConfigured(),
    vapidPublicKey: webPushPublicKey(),
    releaseNoticeId: release.noticeId,
    releaseSummary: releaseNotificationSummary(release),
  });
}
