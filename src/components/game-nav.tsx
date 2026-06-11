import Link from "next/link";

const PAGES = [
  { href: "/", label: "Arena" },
  { href: "/workshop", label: "Workshop" },
  { href: "/mine", label: "Mine" },
  { href: "/shop", label: "Shop" },
] as const;

/** The one nav row every page shares; the current page renders unlinked. */
export function GameNav({
  current,
}: {
  current: "/" | "/workshop" | "/mine" | "/shop";
}) {
  return (
    <nav
      aria-label="Game sections"
      style={{
        display: "flex",
        gap: 10,
        fontSize: "0.85rem",
        pointerEvents: "auto",
      }}
    >
      {PAGES.map((page) =>
        page.href === current ? (
          <span key={page.href} style={{ opacity: 0.55 }}>
            {page.label}
          </span>
        ) : (
          <Link key={page.href} href={page.href} style={{ color: "#54e0c7" }}>
            {page.label}
          </Link>
        ),
      )}
    </nav>
  );
}
