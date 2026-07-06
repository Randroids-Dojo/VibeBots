import {
  type AccountIdentity,
  normalizeAccountIdentity,
} from "@/lib/account-link-core";

export interface ClerkEmailAddressLike {
  id?: unknown;
  emailAddress?: unknown;
}

export interface ClerkUserLike {
  id?: unknown;
  primaryEmailAddressId?: unknown;
  primaryEmailAddress?: ClerkEmailAddressLike | null;
  emailAddresses?: ClerkEmailAddressLike[] | null;
}

export interface ClerkAuthLike {
  userId?: unknown;
}

export type ClerkAuthResolver = () =>
  | ClerkAuthLike
  | null
  | Promise<ClerkAuthLike | null>;
export type ClerkCurrentUserResolver = () =>
  | ClerkUserLike
  | null
  | Promise<ClerkUserLike | null>;

export interface ClerkAccountResolverDeps {
  auth: ClerkAuthResolver;
  currentUser: ClerkCurrentUserResolver;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function primaryEmailFromClerkUser(user: ClerkUserLike): string | undefined {
  const direct = stringValue(user.primaryEmailAddress?.emailAddress);
  if (direct) return direct;
  const primaryId = stringValue(user.primaryEmailAddressId);
  if (!primaryId) return undefined;
  const match = user.emailAddresses?.find(
    (email) => stringValue(email.id) === primaryId,
  );
  return stringValue(match?.emailAddress);
}

export function accountIdentityFromClerkUser(
  user: ClerkUserLike | null | undefined,
): AccountIdentity | null {
  const userId = stringValue(user?.id);
  if (!user || !userId) return null;
  return normalizeAccountIdentity({
    provider: "clerk",
    subject: userId,
    email: primaryEmailFromClerkUser(user),
  });
}

export function clerkAccountIdentityResolver({
  auth,
  currentUser,
}: ClerkAccountResolverDeps): () => Promise<AccountIdentity | null> {
  return async () => {
    let authState: ClerkAuthLike | null;
    try {
      authState = await auth();
    } catch {
      return null;
    }
    const userId = stringValue(authState?.userId);
    if (!userId) return null;

    let user: ClerkUserLike | null;
    try {
      user = await currentUser();
    } catch {
      return null;
    }
    if (stringValue(user?.id) !== userId) return null;

    return accountIdentityFromClerkUser(user);
  };
}
