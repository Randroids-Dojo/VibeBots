import { getAppRelease } from "@/lib/app-release";
import { db, storageConfigured } from "@/server/db";
import { dispatchReleasePushOnce, webPushConfigured } from "@/server/web-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const release = getAppRelease();
  if (storageConfigured() && webPushConfigured()) {
    try {
      const sql = await db();
      await dispatchReleasePushOnce(sql, release);
    } catch (error) {
      console.warn(
        "release notification dispatch failed",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }
  return Response.json(
    { version: release.version },
    { headers: { "cache-control": "no-store" } },
  );
}
