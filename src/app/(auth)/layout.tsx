import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

/**
 * Clerk boots only on the sign-in and sign-up surfaces (F-073). Guests
 * never mount the provider, so the most common session type loads zero
 * Clerk JS and stops logging the two /__clerk 400s on every page view.
 * Server-side session reads (src/server/account-session.ts) and the
 * middleware are independent of this client provider.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  if (!publishableKey) return children;
  return (
    <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>
  );
}
