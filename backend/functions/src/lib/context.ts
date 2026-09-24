import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { COL, GAME_DOC, type GameDoc, type TeamDoc, type UserDoc } from "../models.js";
import type { Role } from "../shared/contract.js";
import { sha256Hex } from "./crypto.js";
import { fail } from "./errors.js";

/** Verified caller identity handed to every handler. */
export interface CallContext {
  uid: string;
  email: string | null;
  signInProvider: string | null;
}

export function contextFromRequest(request: CallableRequest<unknown>): CallContext {
  const a = request.auth;
  if (!a?.uid) fail("unauthenticated", "UNAUTHENTICATED", "Sign in required.");
  const token = a.token as { email?: string; firebase?: { sign_in_provider?: string } };
  return {
    uid: a.uid,
    email: token.email ?? null,
    signInProvider: token.firebase?.sign_in_provider ?? null,
  };
}

type Reader = Firestore | Transaction;

export async function read<T>(r: Reader, ref: DocumentReference): Promise<T | undefined> {
  const snap = "runTransaction" in r ? await ref.get() : await (r as Transaction).get(ref);
  return snap.exists ? (snap.data() as T) : undefined;
}

export const refs = {
  user: (db: Firestore, uid: string) => db.collection(COL.users).doc(uid),
  team: (db: Firestore, teamId: string) => db.collection(COL.teams).doc(teamId),
  game: (db: Firestore) => db.collection(COL.game).doc(GAME_DOC),
  seeker: (db: Firestore, uid: string) => db.collection(COL.seekers).doc(uid),
};

export function makePlayerId(uid: string): string {
  return `OP-${sha256Hex(uid).slice(0, 6).toUpperCase()}`;
}

/** Fills server-owned fields that pre-existing user docs may not have yet. */
export function withUserDefaults(uid: string, data: Partial<UserDoc>): UserDoc {
  return {
    ...(data as UserDoc),
    name: data.name ?? "",
    email: data.email ?? null,
    teamId: data.teamId ?? null,
    playerId: data.playerId ?? makePlayerId(uid),
    status: data.status ?? "active",
    score: data.score ?? 0,
    eliminationTokens: data.eliminationTokens ?? 0,
  };
}

/**
 * Loads the caller's profile. The users doc — not the ID token claim — is the
 * authority for role, team and status inside functions, so a change takes
 * effect immediately instead of when the token next refreshes.
 */
export async function loadActor(db: Firestore, r: Reader, uid: string): Promise<UserDoc> {
  const data = await read<Partial<UserDoc>>(r, refs.user(db, uid));
  if (!data) fail("failed-precondition", "PROFILE_REQUIRED", "Call createOrSyncProfile first.");
  const user = withUserDefaults(uid, data);
  if (user.status === "suspended") fail("permission-denied", "ACCOUNT_SUSPENDED", "Account suspended.");
  return user;
}

export function requireRole(actual: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(actual)) {
    fail("permission-denied", "ROLE_NOT_ALLOWED", "Your role cannot perform this action.");
  }
}

/** An active (not eliminated) player with one of `roles` who is on a team. */
export function requirePlayer(user: UserDoc, roles: readonly Role[]): UserDoc & { teamId: string } {
  requireRole(user.role, roles);
  if (user.status === "eliminated") fail("permission-denied", "PLAYER_ELIMINATED", "You have been eliminated.");
  if (!user.teamId) fail("failed-precondition", "NO_TEAM", "You are not on a team yet.");
  return user as UserDoc & { teamId: string };
}

export async function loadTeam(db: Firestore, r: Reader, teamId: string): Promise<TeamDoc> {
  const team = await read<TeamDoc>(r, refs.team(db, teamId));
  if (!team) fail("not-found", "TEAM_NOT_FOUND", "Team not found.");
  return team;
}

export async function loadGame(db: Firestore, r: Reader): Promise<GameDoc | undefined> {
  return read<GameDoc>(r, refs.game(db));
}

export function requireGameActive(game: GameDoc | undefined): GameDoc {
  if (game?.status === "ended") fail("failed-precondition", "GAME_ENDED", "The game has ended.");
  if (!game || game.status !== "active") fail("failed-precondition", "GAME_NOT_ACTIVE", "The game is not live right now.");
  return game;
}
