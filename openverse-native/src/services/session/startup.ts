import type { StorageScope } from "./scope";
import type { TrackingDecision } from "./trackingPolicy";

export type ProfileSync = "pending" | "ok" | "offline" | "error";

export type StartupPhase =
  /** Firebase has not reported the persisted user yet. */
  | "resolving-auth"
  | "signed-out"
  /** createOrSyncProfile is running for this user. */
  | "syncing-profile"
  /** Profile sync failed for a retryable reason (e.g. offline): offer retry or sign-out. */
  | "profile-error"
  /** A required Firestore listener failed and can be explicitly retried. */
  | "listener-error"
  /** Signed in, waiting for the profile/game documents and this account's local state. */
  | "loading-account"
  | "ready";

/**
 * Deterministic startup gate: nothing account-specific renders until auth is
 * resolved, the profile is synced, the live documents have arrived and the
 * local state loaded belongs to the current account and event. This prevents
 * a previous account's data from flashing during auth changes.
 */
export function startupPhase(s: {
  authResolved: boolean;
  uid: string | null;
  profileSync: ProfileSync;
  profileLoaded: boolean;
  gameLoaded: boolean;
  scopeKey: string | null;
  localStateKey: string | null;
  listenerFailed: boolean;
}): StartupPhase {
  if (!s.authResolved) return "resolving-auth";
  if (!s.uid) return "signed-out";
  if (s.profileSync === "pending") return "syncing-profile";
  if (s.profileSync === "error") return "profile-error";
  if (s.profileSync !== "offline" && s.listenerFailed) return "listener-error";
  if (!s.profileLoaded || !s.gameLoaded || !s.scopeKey || s.localStateKey !== s.scopeKey) return "loading-account";
  return "ready";
}

/** Profile-sync failures that mean this account can never use the app: sign it out. Anything else is retryable. */
const TERMINAL_PROFILE_REASONS = new Set(["INSTITUTIONAL_EMAIL_REQUIRED", "ANONYMOUS_NOT_ALLOWED", "UNAUTHENTICATED"]);

export function profileSyncFailure(reason: string | null): "sign-out" | "retry" {
  return reason && TERMINAL_PROFILE_REASONS.has(reason) ? "sign-out" : "retry";
}

export function scopeKeyOf(scope: StorageScope | null): string | null {
  return scope ? `${scope.uid}/${scope.eventId}` : null;
}

const RETRYABLE_LISTENER_CODES = new Set([
  "permission-denied",
  "unauthenticated",
  "unavailable",
  "deadline-exceeded",
  "cancelled",
  "aborted",
  "internal",
  "unknown",
]);

/** Firestore native errors use `firestore/<code>` or a bare code. */
export function firestoreErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || code.length === 0) return null;
  const slash = code.lastIndexOf("/");
  return slash >= 0 ? code.slice(slash + 1) : code;
}

/**
 * A listener attached in the same turn as sign-in often fails once with
 * permission-denied before the ID token reaches Firestore, and that listener
 * never recovers. Retry those failures (and transport blips) a few times
 * after refreshing the token. A later failure is shown to the user.
 */
export function shouldRetryAccountListener(code: string | null, attempt: number, maxAttempts = 3): boolean {
  if (attempt >= maxAttempts) return false;
  if (code == null) return true;
  return RETRYABLE_LISTENER_CODES.has(code);
}

/**
 * The tracking screen synchronizes when this key changes (or on explicit
 * refresh), not on every profile/game snapshot: score or name updates leave
 * it unchanged.
 */
export function trackingSyncKey(scope: StorageScope | null, decision: TrackingDecision): string {
  const d = decision.allowed === false ? `denied:${decision.reason}` : String(decision.allowed);
  return `${scopeKeyOf(scope) ?? "none"}|${d}`;
}
