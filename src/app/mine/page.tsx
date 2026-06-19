import { MinePanel } from "@/components/mine-panel";
import { VersionRefreshPrompt } from "@/components/version-refresh-prompt";
import { getAppRelease } from "@/lib/app-release";

export default function MinePage() {
  const appRelease = getAppRelease();
  return (
    <main>
      <span hidden data-vibebots-app-version={appRelease.version} />
      <VersionRefreshPrompt currentVersion={appRelease.version} />
      <MinePanel appRelease={appRelease} />
    </main>
  );
}
