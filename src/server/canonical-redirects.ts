export const CANONICAL_HOST = "vibebots.randroid.dev";

// Anchored regex for Next's host `has` matcher. Every Vercel-generated
// alias for this project (vibe-bots.vercel.app, the git-main alias, raw
// per-deployment URLs) lives under vercel.app; the canonical domain does
// not, so one pattern covers all aliases without listing them.
export const VERCEL_ALIAS_HOST_PATTERN = ".*\\.vercel\\.app";

type HostRedirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has: Array<{ type: "host"; value: string }>;
};

/**
 * Production traffic arriving on a *.vercel.app alias cannot sign in: the
 * production Clerk instance only attributes requests from the canonical
 * domain, so clerk-js errors out and /sign-in renders blank there. Redirect
 * every alias request to the canonical host instead. Baked in at build time,
 * so preview deployments (which legitimately live on *.vercel.app) and local
 * builds keep their own hosts.
 */
export function canonicalHostRedirects(
  vercelEnv: string | undefined,
): HostRedirect[] {
  if (vercelEnv !== "production") return [];
  return [
    {
      source: "/:path(.*)",
      has: [{ type: "host", value: VERCEL_ALIAS_HOST_PATTERN }],
      destination: `https://${CANONICAL_HOST}/:path`,
      permanent: true,
    },
  ];
}
