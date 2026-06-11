import Link from "next/link";
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
          dig for emeralds, find rare parts, make it back up
        </p>
        <Link href="/" style={{ fontSize: "0.85rem", color: "#54e0c7" }}>
          back to the arena
        </Link>
      </header>
      <MinePanel />
    </main>
  );
}
