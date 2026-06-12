import { GameNav } from "@/components/game-nav";
import { MinePanel } from "@/components/mine-panel";

export default function MinePage() {
  return (
    <main>
      {/* Game-first chrome: just the nav, floated clear of the HUD. */}
      <header
        style={{
          position: "absolute",
          top: 12,
          right: 14,
          zIndex: 6,
        }}
      >
        <GameNav current="/mine" />
      </header>
      <MinePanel />
    </main>
  );
}
