import { HolodeckPanel } from "@/components/holodeck-panel";
import { PerfTelemetry } from "@/components/perf-telemetry";
import { getAppRelease } from "@/lib/app-release";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HolodeckPage() {
  const appRelease = getAppRelease();
  return (
    <>
      <HolodeckPanel />
      <PerfTelemetry
        source="holodeck"
        appVersion={appRelease.version}
        appBuild={appRelease.build}
      />
    </>
  );
}
