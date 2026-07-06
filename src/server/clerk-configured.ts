export function clerkConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) &&
    Boolean(process.env.CLERK_SECRET_KEY?.trim())
  );
}
