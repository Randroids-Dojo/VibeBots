import { BackToMine } from "@/components/back-to-mine";
import { PerfTelemetry } from "@/components/perf-telemetry";
import { WorkshopPanel } from "@/components/workshop-panel";
import { getAppRelease } from "@/lib/app-release";

export default function WorkshopPage() {
  const appRelease = getAppRelease();
  return (
    <main>
      <BackToMine />
      <WorkshopPanel />
      <PerfTelemetry
        source="workshop"
        appVersion={appRelease.version}
        appBuild={appRelease.build}
      />
    </main>
  );
}
