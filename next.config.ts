import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // VibeKit ships raw TypeScript source; Next must transpile it.
  transpilePackages: ["@randroids-dojo/vibekit"],
  // A stray lockfile above the repo otherwise makes Turbopack guess wrong.
  turbopack: { root: __dirname },
};

export default nextConfig;
