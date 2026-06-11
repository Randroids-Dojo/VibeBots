import { ArenaStage } from "@/components/arena-stage";
import { GameNav } from "@/components/game-nav";

export default function HomePage() {
  return (
    <main>
      <header
        style={{
          position: "absolute",
          top: 16,
          left: 20,
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem", letterSpacing: "0.05em" }}>
          VibeBots
        </h1>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.85rem" }}>
          exhibition match: Brawler vs Rammer
        </p>
        <GameNav current="/" />
      </header>
      <ArenaStage />
    </main>
  );
}
