import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
  NextResponse,
} from "next/server";
import { clerkConfigured } from "@/server/clerk-configured";

let activeClerkMiddleware: NextMiddleware | null = null;

export function requestNeedsClerk(pathname: string): boolean {
  return pathname === "/__clerk" || pathname.startsWith("/__clerk/");
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!clerkConfigured() || !requestNeedsClerk(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  activeClerkMiddleware ??= clerkMiddleware() as NextMiddleware;
  return activeClerkMiddleware(request, event);
}

// Clerk's frontend bridge is the only surface the middleware handles; account
// routes authenticate per-request in their handlers. Keep the matcher scoped
// so every other page and API request skips the middleware hop entirely.
export const config = {
  matcher: ["/__clerk", "/__clerk/(.*)"],
};
