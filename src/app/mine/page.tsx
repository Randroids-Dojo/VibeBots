import { headers } from "next/headers";
import { MinePanel } from "@/components/mine-panel";
import { VersionRefreshPrompt } from "@/components/version-refresh-prompt";
import { getAppRelease } from "@/lib/app-release";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MinePage() {
  const appRelease = getAppRelease();
  const requestHeaders = await headers();
  const functionalRendererBypass =
    process.env.VIBEBOTS_E2E_MODE === "1" &&
    requestHeaders.get("x-vibebots-e2e-capability") === "functional";
  return (
    <main>
      <span hidden data-vibebots-app-version={appRelease.version} />
      <VersionRefreshPrompt currentVersion={appRelease.version} />
      <MinePanel
        appRelease={appRelease}
        functionalRendererBypass={functionalRendererBypass}
      />
    </main>
  );
}
