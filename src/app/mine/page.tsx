import { GameNav } from "@/components/game-nav";
import { MinePanel } from "@/components/mine-panel";

export default function MinePage() {
  return (
    <main>
      <header
        style={{
          position: "absolute",
          top: 16,
          left: 20,
          zIndex: 1,
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem", letterSpacing: "0.05em" }}>
          The Mine
        </h1>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.85rem" }}>
          dig deep, haul rich ore home, make it back before the lamp dies
        </p>
        <GameNav current="/mine" />
      </header>
      <MinePanel />
    </main>
  );
}
