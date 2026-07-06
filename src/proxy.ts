import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
  NextResponse,
} from "next/server";
import { clerkConfigured } from "@/server/clerk-configured";

let activeClerkMiddleware: NextMiddleware | null = null;

export interface ClerkProxyRequest {
  headers: Pick<Headers, "get">;
  nextUrl: { pathname: string };
}

export function requestNeedsClerk(request: ClerkProxyRequest): boolean {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/__clerk" || pathname.startsWith("/__clerk/")) {
    return true;
  }
  return false;
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!clerkConfigured() || !requestNeedsClerk(request)) {
    return NextResponse.next();
  }

  activeClerkMiddleware ??= clerkMiddleware() as NextMiddleware;
  return activeClerkMiddleware(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
