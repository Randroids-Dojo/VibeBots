import { getAppRelease } from "@/lib/app-release";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json(
    { version: getAppRelease().version },
    { headers: { "cache-control": "no-store" } },
  );
}
