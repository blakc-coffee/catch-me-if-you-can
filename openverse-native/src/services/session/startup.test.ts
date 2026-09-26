import { describe, expect, it } from "vitest";
import { createScope } from "./scope";
import { firestoreErrorCode, profileSyncFailure, scopeKeyOf, shouldRetryAccountListener, startupPhase, trackingSyncKey } from "./startup";
import { evaluateTracking } from "./trackingPolicy";

const A = createScope("uidA", "event-1");
const readyInput = {
  authResolved: true,
  uid: "uidA",
  profileSync: "ok" as const,
  profileLoaded: true,
  gameLoaded: true,
  scopeKey: scopeKeyOf(A),
  localStateKey: scopeKeyOf(A),
  listenerFailed: false,
};

describe("startup phase", () => {
  it("walks deterministically from auth resolution to ready", () => {
    expect(startupPhase({ ...readyInput, authResolved: false, uid: null })).toBe("resolving-auth");
    expect(startupPhase({ ...readyInput, uid: null })).toBe("signed-out");
    expect(startupPhase({ ...readyInput, profileSync: "pending" })).toBe("syncing-profile");
    expect(startupPhase({ ...readyInput, profileSync: "error" })).toBe("profile-error");
    expect(startupPhase({ ...readyInput, listenerFailed: true })).toBe("listener-error");
    expect(startupPhase({ ...readyInput, profileLoaded: false })).toBe("loading-account");
    expect(startupPhase({ ...readyInput, gameLoaded: false })).toBe("loading-account");
    expect(startupPhase(readyInput)).toBe("ready");
  });

  it("allows a correctly scoped offline cache but does not hide an online listener failure", () => {
    expect(startupPhase({ ...readyInput, profileSync: "offline", listenerFailed: true })).toBe("ready");
    expect(startupPhase({ ...readyInput, profileSync: "ok", listenerFailed: true })).toBe("listener-error");
  });

  it("never shows a persisted user before auth has resolved", () => {
    expect(startupPhase({ ...readyInput, authResolved: false })).toBe("resolving-auth");
  });

  it("does not render until the loaded local state belongs to the current account and event", () => {
    expect(startupPhase({ ...readyInput, localStateKey: null })).toBe("loading-account");
    expect(startupPhase({ ...readyInput, localStateKey: scopeKeyOf(createScope("uidB", "event-1")) })).toBe("loading-account");
    expect(startupPhase({ ...readyInput, localStateKey: scopeKeyOf(createScope("uidA", "event-0")) })).toBe("loading-account");
  });

  it("retries a listener that failed before the ID token reached Firestore", () => {
    expect(firestoreErrorCode({ code: "firestore/permission-denied" })).toBe("permission-denied");
    expect(firestoreErrorCode({ code: "unavailable" })).toBe("unavailable");
    expect(firestoreErrorCode(new Error("no code"))).toBeNull();
    expect(shouldRetryAccountListener("permission-denied", 0)).toBe(true);
    expect(shouldRetryAccountListener("unauthenticated", 2)).toBe(true);
    expect(shouldRetryAccountListener("permission-denied", 3)).toBe(false);
    expect(shouldRetryAccountListener(null, 0)).toBe(true);
    expect(shouldRetryAccountListener("failed-precondition", 0)).toBe(false);
  });

  it("signs out only for terminal profile failures; network trouble is retryable", () => {
    expect(profileSyncFailure("INSTITUTIONAL_EMAIL_REQUIRED")).toBe("sign-out");
    expect(profileSyncFailure("ANONYMOUS_NOT_ALLOWED")).toBe("sign-out");
    expect(profileSyncFailure(null)).toBe("retry");
    expect(profileSyncFailure("INTERNAL")).toBe("retry");
    expect(profileSyncFailure("RATE_LIMITED")).toBe("retry");
  });
});

describe("tracking screen sync trigger", () => {
  const seeker = { role: "seeker", status: "active", teamId: "alpha" };
  const live = { status: "active", eventId: "event-1" };

  it("does not change on profile updates that do not affect tracking", () => {
    const before = trackingSyncKey(A, evaluateTracking({ uid: "uidA", profile: seeker, game: live }));
    const scoreChanged = trackingSyncKey(A, evaluateTracking({ uid: "uidA", profile: { ...seeker, score: 500, name: "Renamed" } as never, game: live }));
    const gameSettingChanged = trackingSyncKey(A, evaluateTracking({ uid: "uidA", profile: seeker, game: { ...live, telemetryMinIntervalSec: 5 } as never }));
    expect(scoreChanged).toBe(before);
    expect(gameSettingChanged).toBe(before);
  });

  it("changes on meaningful tracking or account events", () => {
    const base = trackingSyncKey(A, evaluateTracking({ uid: "uidA", profile: seeker, game: live }));
    expect(trackingSyncKey(A, evaluateTracking({ uid: "uidA", profile: { ...seeker, status: "eliminated" }, game: live }))).not.toBe(base);
    expect(trackingSyncKey(A, evaluateTracking({ uid: "uidA", profile: seeker, game: { status: "paused" } }))).not.toBe(base);
    expect(trackingSyncKey(createScope("uidB", "event-1"), { allowed: true })).not.toBe(base);
    expect(trackingSyncKey(createScope("uidA", "event-2"), { allowed: true })).not.toBe(base);
    expect(trackingSyncKey(null, { allowed: true })).not.toBe(base);
  });
});
