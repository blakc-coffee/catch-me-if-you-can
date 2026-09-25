import type { StoredPosition } from "../../types";
import type { ScopedStore } from "./localStore";
import { createScope, sameScope, type StorageScope } from "./scope";
import { evaluateTracking, eventIdOf, type GameSnapshot, type ProfileSnapshot, type TrackingDecision, type TrackingDenial } from "./trackingPolicy";

export interface TrackingSessionDeps {
  store: ScopedStore;
  /** UID of the currently authenticated Firebase user, or null. */
  currentUid(): string | null;
  /** Starts the OS background location task. */
  startLocationUpdates(): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Stops the OS background location task if it is running. */
  stopLocationUpdates(): Promise<void>;
  /** Hides the caller's live position on the server (stopTracking callable). */
  stopRemoteTracking(): Promise<void>;
  log?(message: string, error?: unknown): void;
}

export type ShutdownCause = TrackingDenial | "account-changed" | "user-stopped";

export type Purge =
  /** Keep queued samples (quarantined in their scope, never uploaded unless authorized again). */
  | "none"
  /** Delete every scope's sensitive data and the active-scope pointer. */
  | "all"
  /** Delete everything that does not belong to this UID. */
  | { keepUid: string };

export interface ShutdownReport {
  cause: ShutdownCause;
  failures: string[];
}

async function attempt(failures: string[], step: string, deps: TrackingSessionDeps, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    failures.push(step);
    deps.log?.(`tracking shutdown: ${step} failed`, error);
  }
}

/**
 * The single place tracking stops. Order matters for partial failure:
 * 1. stop background collection in storage first, so a still-running OS task
 *    can no longer append samples even if step 2 fails;
 * 2. stop the OS location task;
 * 3. hide the live position on the server, only while still signed in as the
 *    scope's owner (skipped offline or after an account change: the server's
 *    staleness window then hides the seeker);
 * 4. delete or quarantine sensitive local state.
 * Every step runs even if an earlier one fails, and repeating the whole
 * shutdown is harmless.
 */
export async function shutdownTracking(deps: TrackingSessionDeps, cause: ShutdownCause, purge: Purge): Promise<ShutdownReport> {
  const failures: string[] = [];
  let active = null as Awaited<ReturnType<ScopedStore["getActiveScope"]>>;
  await attempt(failures, "read-active-scope", deps, async () => {
    active = await deps.store.getActiveScope();
  });
  await attempt(failures, "stop-collecting", deps, () => deps.store.stopCollecting());
  await attempt(failures, "stop-location-updates", deps, () => deps.stopLocationUpdates());
  if (active && deps.currentUid() === active.uid) {
    await attempt(failures, "stop-remote-tracking", deps, () => deps.stopRemoteTracking());
  }
  if (purge === "all") await attempt(failures, "purge", deps, () => deps.store.purgeExcept({}));
  else if (purge !== "none") await attempt(failures, "purge", deps, () => deps.store.purgeExcept({ uid: purge.keepUid }));
  return { cause, failures };
}

/**
 * Call on every auth state change (including app start). A different or
 * missing user shuts down tracking left over from the previous account and
 * deletes that account's queued samples and progress; data of other
 * accounts and legacy global keys are always removed.
 */
export async function handleAuthChange(deps: TrackingSessionDeps, uid: string | null): Promise<ShutdownReport | null> {
  const active = await deps.store.getActiveScope().catch(() => null);
  if (active && active.uid !== uid) {
    return shutdownTracking(deps, uid ? "account-changed" : "signed-out", uid ? { keepUid: uid } : "all");
  }
  await deps.store.purgeExcept(uid ? { uid } : {});
  return null;
}

/**
 * Call whenever the profile, game state or scope changes. Stops tracking the
 * moment the invariant no longer holds; switching to a new event scope stops
 * tracking of the old one and deletes the old event's data.
 */
export async function enforceAuthorization(
  deps: TrackingSessionDeps,
  scope: StorageScope | null,
  decision: TrackingDecision,
): Promise<ShutdownReport | null> {
  const active = await deps.store.getActiveScope().catch(() => null);
  if (!active) return null;
  if (!scope || active.uid !== scope.uid) {
    return shutdownTracking(deps, "account-changed", scope ? { keepUid: scope.uid } : "all");
  }
  if (active.eventId !== scope.eventId) {
    const report = await shutdownTracking(deps, "game-not-active", "none");
    await deps.store.purgeExcept({ scope }).catch((error) => deps.log?.("purge of old event failed", error));
    return report;
  }
  if (decision.allowed === false && active.collecting) return shutdownTracking(deps, decision.reason, "none");
  return null;
}

export type StartResult = { ok: true } | { ok: false; reason: string };

/** Starts collection for `scope` only when the invariant holds right now. */
export async function startTracking(deps: TrackingSessionDeps, scope: StorageScope, decision: TrackingDecision): Promise<StartResult> {
  if (decision.allowed !== true) return { ok: false, reason: decision.allowed === false ? decision.reason : "authorization-unknown" };
  if (deps.currentUid() !== scope.uid) return { ok: false, reason: "account-changed" };
  await deps.store.purgeExcept({ scope });
  await deps.store.activate(scope, true);
  const started = await deps.startLocationUpdates().catch((error: unknown) => {
    deps.log?.("start location updates failed", error);
    return { ok: false as const, reason: "unavailable" };
  });
  if (!started.ok) await deps.store.stopCollecting();
  return started;
}

/** User pressed "stop": keep the queue for a later sync by the same account. */
export function stopTrackingByUser(deps: TrackingSessionDeps): Promise<ShutdownReport> {
  return shutdownTracking(deps, "user-stopped", "none");
}

export interface SignOutProviders {
  /** Signs out of the identity provider (Google) so the next sign-in can choose an account. */
  signOutProvider(): Promise<void>;
  /** Signs out of Firebase Auth; a no-op when already signed out. */
  signOutFirebase(): Promise<void>;
}

/**
 * User-initiated sign-out. Tracking shuts down first, while still signed in,
 * so the live position can be hidden on the server and nothing queued can be
 * uploaded later under another account; all account-scoped local state is
 * deleted. Provider and network failures never block the Firebase sign-out.
 */
export async function signOut(deps: TrackingSessionDeps, providers: SignOutProviders): Promise<ShutdownReport> {
  const report = await shutdownTracking(deps, "signed-out", "all");
  await attempt(report.failures, "provider-sign-out", deps, () => providers.signOutProvider());
  await providers.signOutFirebase();
  return report;
}

export interface BackgroundAuthorization {
  profile: ProfileSnapshot | null;
  game: GameSnapshot | null;
}

export type BackgroundResult = "appended" | "refused-no-scope" | "refused-account" | "refused-denied" | "refused-store";

/**
 * Gate for the headless background task. Samples are appended only into the
 * persisted active scope, only while it is collecting, and only while the
 * authenticated user is that scope's owner. Every `recheckMs` the task also
 * re-reads profile and game state; a definitive denial stops tracking. A
 * failed read (offline) keeps collecting so the same account can sync later,
 * and the next attempt backs off exponentially from `retryBaseMs` up to
 * `retryMaxMs` instead of retrying on every sample.
 */
export function createBackgroundGate(
  deps: TrackingSessionDeps,
  fetchAuthorization: (uid: string) => Promise<BackgroundAuthorization>,
  {
    recheckMs = 60_000,
    retryBaseMs = 30_000,
    retryMaxMs = 10 * 60_000,
    now = () => Date.now(),
  }: { recheckMs?: number; retryBaseMs?: number; retryMaxMs?: number; now?: () => number } = {},
) {
  let nextCheckAt = Number.NEGATIVE_INFINITY;
  let consecutiveFailures = 0;
  return async function onSamples(samples: StoredPosition[]): Promise<BackgroundResult> {
    const active = await deps.store.getActiveScope().catch(() => null);
    if (!active?.collecting) {
      await deps.stopLocationUpdates().catch(() => undefined);
      return "refused-no-scope";
    }
    const uid = deps.currentUid();
    if (uid !== active.uid) {
      await shutdownTracking(deps, uid ? "account-changed" : "signed-out", uid ? { keepUid: uid } : "all");
      return "refused-account";
    }
    if (now() >= nextCheckAt) {
      let auth: BackgroundAuthorization | null = null;
      try {
        auth = await fetchAuthorization(uid);
        consecutiveFailures = 0;
        nextCheckAt = now() + recheckMs;
      } catch (error) {
        consecutiveFailures += 1;
        nextCheckAt = now() + Math.min(retryMaxMs, retryBaseMs * 2 ** (consecutiveFailures - 1));
        deps.log?.("background authorization check failed; collecting offline", error);
      }
      if (auth) {
        const decision = evaluateTracking({ uid, profile: auth.profile, game: auth.game });
        if (decision.allowed === false) {
          await shutdownTracking(deps, decision.reason, "none");
          return "refused-denied";
        }
        if (!sameScope(active, { uid, eventId: eventIdOf(auth.game) })) {
          await shutdownTracking(deps, "game-not-active", "none");
          return "refused-denied";
        }
      }
    }
    const appended = await deps.store.appendLocations(createScope(active.uid, active.eventId), samples);
    return appended ? "appended" : "refused-store";
  };
}
