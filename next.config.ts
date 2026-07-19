import type { NextConfig } from "next";
import { canonicalHostRedirects } from "./src/server/canonical-redirects";

// Monotonic build number baked in at build time. Runtime git is not
// available in deployed serverless functions and Vercel builds from a
// shallow clone, so `git rev-list --count HEAD` cannot identify a
// deploy in production (null at request time, the clone depth at build
// time). Minutes since 2026-01-01 UTC orders deploys and stays well
// inside a Postgres integer.
const APP_BUILD = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60_000);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_BUILD: String(APP_BUILD) },
  // VibeKit ships raw TypeScript source; Next must transpile it.
  transpilePackages: ["@randroids-dojo/vibekit"],
  // A stray lockfile above the repo otherwise makes Turbopack guess wrong.
  turbopack: { root: __dirname },
  // Production-only: send *.vercel.app alias traffic to the canonical
  // domain, where the production Clerk instance can attribute requests.
  redirects: async () => canonicalHostRedirects(process.env.VERCEL_ENV),
};

export default nextConfig;
