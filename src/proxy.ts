import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
  NextResponse,
} from "next/server";

let activeClerkMiddleware: NextMiddleware | null = null;

export interface ClerkProxyRequest {
  headers: Pick<Headers, "get">;
  nextUrl: { pathname: string };
}

function clerkProxyEnabled(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) &&
    Boolean(process.env.CLERK_SECRET_KEY?.trim())
  );
}

export function requestNeedsClerk(request: ClerkProxyRequest): boolean {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/__clerk" || pathname.startsWith("/__clerk/")) {
    return true;
  }
  return false;
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!clerkProxyEnabled() || !requestNeedsClerk(request)) {
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
