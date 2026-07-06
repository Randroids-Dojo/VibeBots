import { ArenaStage } from "@/components/arena-stage";
import { BackToMine } from "@/components/back-to-mine";
import { PerfTelemetry } from "@/components/perf-telemetry";
import { getAppRelease } from "@/lib/app-release";

export default function ArenaPage() {
  const appRelease = getAppRelease();
  return (
    <main>
      <BackToMine />
      <ArenaStage />
      <PerfTelemetry
        source="arena"
        appVersion={appRelease.version}
        appBuild={appRelease.build}
      />
    </main>
  );
}
