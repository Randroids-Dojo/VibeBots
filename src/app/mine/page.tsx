import { MinePanel } from "@/components/mine-panel";
import { getAppRelease } from "@/lib/app-release";

export default function MinePage() {
  const appRelease = getAppRelease();
  return (
    <main>
      <MinePanel appRelease={appRelease} />
    </main>
  );
}
