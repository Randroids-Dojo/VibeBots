import Link from "next/link";

/**
 * Floating "back to the mine village" control for screens entered from
 * the surface (Workshop, Battles). With the top nav gone, the mine
 * surface is the overworld hub and every other screen returns to it.
 */
export function BackToMine() {
  return (
    <Link
      href="/mine"
      aria-label="Back to mine"
      style={{
        position: "absolute",
        top: 14,
        left: 16,
        zIndex: 10,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 999,
        border: "2px solid #54e0c7",
        background: "rgba(17, 21, 31, 0.92)",
        color: "#54e0c7",
        fontWeight: 700,
        fontSize: "0.9rem",
        textDecoration: "none",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
      }}
    >
      <span aria-hidden>{"⛏\u{FE0F}"}</span> Back to mine
    </Link>
  );
}
