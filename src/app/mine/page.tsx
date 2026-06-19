import { MinePanel } from "@/components/mine-panel";
import { VersionRefreshPrompt } from "@/components/version-refresh-prompt";
import { getAppRelease } from "@/lib/app-release";

export default function MinePage() {
  const appRelease = getAppRelease();
  return (
    <main>
      <VersionRefreshPrompt currentVersion={appRelease.version} />
      <MinePanel appRelease={appRelease} />
    </main>
  );
}
