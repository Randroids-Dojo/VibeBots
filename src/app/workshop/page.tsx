import Link from "next/link";
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
        <Link href="/" style={{ fontSize: "0.85rem", color: "#54e0c7" }}>
          back to the arena
        </Link>
      </header>
      <WorkshopPanel />
    </main>
  );
}
