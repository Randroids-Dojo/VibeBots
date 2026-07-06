export interface AccountIdentity {
  provider: string;
  subject: string;
  email?: string;
}

export type AccountClaimResult =
  | { status: "claimed"; playerId: string }
  | { status: "already-linked"; playerId: string }
  | { status: "conflict"; playerId: string }
  | { status: "target-linked-to-other-account"; playerId: string }
  | { status: "invalid-identity" }
  | { status: "player-not-found" };

export type AccountLinkAttempt =
  | { status: "claimed"; playerId: string }
  | { status: "already-linked"; playerId: string }
  | { status: "account-already-linked"; playerId: string }
  | { status: "linked-to-other-account"; playerId: string }
  | { status: "invalid-identity" }
  | { status: "player-not-found" };

export type AccountLoadResult<Session> =
  | { status: "loaded"; playerId: string; session: Session }
  | { status: "invalid-identity" }
  | { status: "not-found" };

export type AccountLinkedSaveStatus =
  | { status: "signed-in-unlinked" }
  | { status: "cloud-loaded"; playerId: string }
  | { status: "conflict"; playerId: string };

export interface AccountLinkStore {
  findLinkedPlayer(identity: AccountIdentity): Promise<string | null>;
  claimUnlinkedPlayer(
    identity: AccountIdentity,
    playerId: string,
  ): Promise<AccountLinkAttempt>;
}

export interface AccountSessionWriter<Session> {
  writeActivePlayer(playerId: string): Promise<Session>;
}

const MAX_PROVIDER_LENGTH = 64;
const MAX_SUBJECT_LENGTH = 256;
const MAX_EMAIL_LENGTH = 320;
const PROVIDER_TOKEN_RE = /^[a-z0-9][a-z0-9._-]*$/;

function normalizeText(value: string): string {
  return value.trim();
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function normalizeAccountIdentity(
  identity: AccountIdentity,
): AccountIdentity | null {
  const provider = normalizeText(identity.provider).toLowerCase();
  const subject = normalizeText(identity.subject);
  const email = identity.email?.trim();
  if (!provider || !subject) return null;
  if (provider.length > MAX_PROVIDER_LENGTH) return null;
  if (!PROVIDER_TOKEN_RE.test(provider)) return null;
  if (subject.length > MAX_SUBJECT_LENGTH) return null;
  if (hasControlCharacter(subject)) return null;
  if (email && email.length > MAX_EMAIL_LENGTH) return null;
  if (email && hasControlCharacter(email)) return null;
  return {
    provider,
    subject,
    email: email || undefined,
  };
}

export async function claimAccountPlayer(
  store: AccountLinkStore,
  identity: AccountIdentity,
  playerId: string,
): Promise<AccountClaimResult> {
  const normalized = normalizeAccountIdentity(identity);
  if (!normalized) return { status: "invalid-identity" };

  const existingPlayerId = await store.findLinkedPlayer(normalized);
  if (existingPlayerId === playerId) {
    return { status: "already-linked", playerId };
  }
  if (existingPlayerId) {
    return { status: "conflict", playerId: existingPlayerId };
  }

  const attempt = await store.claimUnlinkedPlayer(normalized, playerId);
  if (attempt.status === "account-already-linked") {
    return { status: "conflict", playerId: attempt.playerId };
  }
  if (attempt.status === "linked-to-other-account") {
    return {
      status: "target-linked-to-other-account",
      playerId: attempt.playerId,
    };
  }
  return attempt;
}

export async function loadLinkedAccountPlayer<Session>(
  store: AccountLinkStore,
  session: AccountSessionWriter<Session>,
  identity: AccountIdentity,
): Promise<AccountLoadResult<Session>> {
  const normalized = normalizeAccountIdentity(identity);
  if (!normalized) return { status: "invalid-identity" };

  const playerId = await store.findLinkedPlayer(normalized);
  if (!playerId) return { status: "not-found" };

  return {
    status: "loaded",
    playerId,
    session: await session.writeActivePlayer(playerId),
  };
}

export function accountLinkedSaveStatus({
  activePlayerId,
  linkedPlayerId,
}: {
  activePlayerId: string | null | undefined;
  linkedPlayerId: string | null | undefined;
}): AccountLinkedSaveStatus {
  if (!linkedPlayerId) return { status: "signed-in-unlinked" };
  if (linkedPlayerId === activePlayerId) {
    return { status: "cloud-loaded", playerId: linkedPlayerId };
  }
  return { status: "conflict", playerId: linkedPlayerId };
}
