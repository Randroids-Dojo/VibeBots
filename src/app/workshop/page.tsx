import { GameNav } from "@/components/game-nav";
import { WorkshopPanel } from "@/components/workshop-panel";

export default function WorkshopPage() {
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
          Workshop
        </h1>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.85rem" }}>
          snap parts onto connectors, then watch it fight
        </p>
        <GameNav current="/workshop" />
      </header>
      <WorkshopPanel />
    </main>
  );
}
