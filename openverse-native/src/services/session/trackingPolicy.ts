/**
 * The tracking invariant: location is collected and uploaded only while the
 * current authenticated user is an active seeker on a team in an active game.
 * The server enforces the same rules; this lets the app stop on its own.
 */

import { DEFAULT_EVENT_ID } from "../firebase/contract";
import { isValidEventId } from "./scope";

export type ProfileSnapshot = { role?: unknown; status?: unknown; teamId?: unknown };
export type GameSnapshot = { status?: unknown; eventId?: unknown };

export type TrackingDenial =
  | "signed-out"
  | "profile-missing"
  | "suspended"
  | "eliminated"
  | "not-seeker"
  | "no-team"
  | "game-missing"
  | "game-paused"
  | "game-ended"
  | "game-not-active";

export type TrackingDecision = { allowed: true } | { allowed: false; reason: TrackingDenial } | { allowed: null };

/**
 * `undefined` means "not loaded yet" and yields `{ allowed: null }` (neither
 * start nor stop); `null` means the document does not exist.
 */
export function evaluateTracking(input: {
  uid: string | null;
  profile: ProfileSnapshot | null | undefined;
  game: GameSnapshot | null | undefined;
}): TrackingDecision {
  if (!input.uid) return { allowed: false, reason: "signed-out" };
  const { profile, game } = input;
  if (profile === null) return { allowed: false, reason: "profile-missing" };
  if (profile) {
    if (profile.status === "suspended") return { allowed: false, reason: "suspended" };
    if (profile.status === "eliminated") return { allowed: false, reason: "eliminated" };
    if (profile.role !== "seeker") return { allowed: false, reason: "not-seeker" };
    if (typeof profile.teamId !== "string" || profile.teamId.length === 0) return { allowed: false, reason: "no-team" };
  }
  if (game === null) return { allowed: false, reason: "game-missing" };
  if (game) {
    if (game.status === "paused") return { allowed: false, reason: "game-paused" };
    if (game.status === "ended") return { allowed: false, reason: "game-ended" };
    if (game.status !== "active") return { allowed: false, reason: "game-not-active" };
  }
  if (profile === undefined || game === undefined) return { allowed: null };
  return { allowed: true };
}

/** Server reasons that mean the caller may no longer track at all. */
const TERMINAL_REASONS: Readonly<Record<string, TrackingDenial>> = {
  UNAUTHENTICATED: "signed-out",
  PROFILE_REQUIRED: "profile-missing",
  ACCOUNT_SUSPENDED: "suspended",
  PLAYER_ELIMINATED: "eliminated",
  ROLE_NOT_ALLOWED: "not-seeker",
  NO_TEAM: "no-team",
  GAME_ENDED: "game-ended",
  GAME_NOT_ACTIVE: "game-not-active",
};

export function denialFromServerReason(reason: string | null): TrackingDenial | null {
  return reason ? TERMINAL_REASONS[reason] ?? null : null;
}

/** The event a game/state snapshot belongs to (scopes on-device state). */
export function eventIdOf(game: GameSnapshot | null | undefined): string {
  return isValidEventId(game?.eventId) ? game.eventId : DEFAULT_EVENT_ID;
}
