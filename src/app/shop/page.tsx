import { GameNav } from "@/components/game-nav";
import { ShopPanel } from "@/components/shop-panel";

export default function ShopPage() {
  return (
    <main style={{ padding: "90px 24px 24px" }}>
      <header
        style={{
          position: "absolute",
          top: 16,
          left: 20,
          zIndex: 1,
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem", letterSpacing: "0.05em" }}>
          Part Shop
        </h1>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.85rem" }}>
          turn credits into machinery and better gear
        </p>
        <GameNav current="/shop" />
      </header>
      <ShopPanel />
    </main>
  );
}
