/**
 * Storage scope for sensitive on-device state (game progress and queued GPS
 * samples): one Firebase UID in one game event. A scope is only created from
 * the authenticated Firebase user at the app boundary (see sessionRuntime),
 * never from a caller-supplied UID string.
 */

declare const scopeBrand: unique symbol;

export type StorageScope = Readonly<{ uid: string; eventId: string }> & { readonly [scopeBrand]: true };

/** Persisted pointer to the scope the background task may record into. */
export type ActiveScopeRecord = { uid: string; eventId: string; collecting: boolean };

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EVENT_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export const KEY_PREFIX = "openverse.v2.";
export const ACTIVE_SCOPE_KEY = `${KEY_PREFIX}activeScope`;
/** Installation-global keys from before scoping. Ownership is unknown, so they are deleted. */
export const LEGACY_KEYS = ["openverse.game.v1", "openverse.locations.v1"] as const;

export function isValidUid(uid: unknown): uid is string {
  return typeof uid === "string" && UID_PATTERN.test(uid);
}

export function isValidEventId(eventId: unknown): eventId is string {
  return typeof eventId === "string" && EVENT_PATTERN.test(eventId);
}

/**
 * Only for the auth boundary (sessionRuntime) and tests. Throws on anything
 * that is not a well-formed Firebase UID / event id so it can never be used
 * to build a key outside the scope's namespace.
 */
export function createScope(uid: string, eventId: string): StorageScope {
  if (!isValidUid(uid)) throw new Error("Invalid storage scope uid.");
  if (!isValidEventId(eventId)) throw new Error("Invalid storage scope event id.");
  return Object.freeze({ uid, eventId }) as StorageScope;
}

export function sameScope(a: { uid: string; eventId: string } | null | undefined, b: { uid: string; eventId: string } | null | undefined): boolean {
  return Boolean(a && b && a.uid === b.uid && a.eventId === b.eventId);
}

const scopePrefix = (scope: { uid: string; eventId: string }) => `${KEY_PREFIX}u.${scope.uid}.e.${scope.eventId}.`;
export const userPrefix = (uid: string) => `${KEY_PREFIX}u.${uid}.`;

export const scopedKeys = (scope: StorageScope) => ({
  game: `${scopePrefix(scope)}game`,
  locations: `${scopePrefix(scope)}locations`,
});

export function keyBelongsToScope(key: string, scope: { uid: string; eventId: string }): boolean {
  return key.startsWith(scopePrefix(scope));
}
