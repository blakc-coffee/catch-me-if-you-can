import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { z } from "zod";
import { DEFAULT_ROLE, RATE_LIMITS } from "../config.js";
import { makePlayerId, refs, withUserDefaults, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { auth, db } from "../lib/firebase.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { parseInput } from "../lib/validation.js";
import type { UserDoc } from "../models.js";
import { ROLES, type CreateOrSyncProfileResponse, type ProfileDTO, type Role } from "../shared/contract.js";

export const DISPLAY_NAME = /^[A-Za-z0-9 _.'-]+$/;

const schema = z.strictObject({
  name: z.string().trim().min(2).max(40).regex(DISPLAY_NAME, "letters, digits, space, _ . ' - only").optional(),
});

function defaultName(email: string | null, playerId: string): string {
  const local = (email?.split("@")[0] ?? "").replace(/[^A-Za-z0-9 _.'-]/g, "").slice(0, 40);
  return local.length >= 2 ? local : playerId;
}

/** Existing docs may carry unexpected role strings; they never grant more than seeker. */
export function safeRole(uid: string, role: unknown): Role {
  if ((ROLES as readonly unknown[]).includes(role)) return role as Role;
  logger.warn("user has unknown role; treating as seeker", { uid, role });
  return "seeker";
}

export function toProfileDTO(uid: string, u: UserDoc): ProfileDTO {
  return {
    uid,
    playerId: u.playerId,
    name: u.name,
    email: u.email,
    role: safeRole(uid, u.role),
    teamId: u.teamId,
    status: u.status,
    score: u.score,
    eliminationTokens: u.eliminationTokens,
  };
}

/**
 * Mirrors the authoritative users/{uid} role and teamId into custom claims,
 * which security rules read. Returns true when the claims changed (the client
 * must refresh its ID token).
 */
export async function syncClaims(uid: string, role: Role, teamId: string | null): Promise<boolean> {
  const user = await auth().getUser(uid);
  const claims = user.customClaims ?? {};
  if (claims.role === role && (claims.teamId ?? null) === teamId) return false;
  await auth().setCustomUserClaims(uid, { ...claims, role, teamId });
  return true;
}

/**
 * Creates the caller's profile on first sign-in (role seeker, no team) or
 * refreshes it, backfilling server-owned fields that pre-existing user docs
 * lack. Clients may only choose a display name; role, team, score, tokens and
 * status are never taken from the client.
 */
export async function createOrSyncProfile(ctx: CallContext, raw: unknown): Promise<CreateOrSyncProfileResponse> {
  const input = parseInput(schema, raw ?? {});
  if (ctx.signInProvider === "anonymous") {
    fail("permission-denied", "ANONYMOUS_NOT_ALLOWED", "Anonymous accounts cannot play.");
  }
  const d = db();
  await consumeRateLimit(d, `profile_${ctx.uid}`, RATE_LIMITS.profileSync);

  const ref = refs.user(d, ctx.uid);
  const user = await d.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = FieldValue.serverTimestamp();
    if (!snap.exists) {
      const playerId = makePlayerId(ctx.uid);
      const fresh = {
        name: input.name ?? defaultName(ctx.email, playerId),
        email: ctx.email,
        role: DEFAULT_ROLE,
        teamId: null,
        playerId,
        status: "active" as const,
        score: 0,
        eliminationTokens: 0,
      };
      tx.create(ref, { ...fresh, createdAt: now, updatedAt: now, lastSeenAt: now });
      return withUserDefaults(ctx.uid, fresh);
    }
    const existing = snap.data() as Partial<UserDoc>;
    const filled = withUserDefaults(ctx.uid, existing);
    const patch: Record<string, unknown> = { lastSeenAt: now };
    // Backfill only missing server fields; never touch existing role/team/name.
    for (const key of ["playerId", "status", "score", "eliminationTokens"] as const) {
      if (existing[key] === undefined) patch[key] = filled[key];
    }
    if (existing.teamId === undefined) patch.teamId = null;
    if (input.name && input.name !== existing.name) {
      patch.name = input.name;
      patch.updatedAt = now;
      filled.name = input.name;
    }
    tx.update(ref, patch);
    return filled;
  });

  const profile = toProfileDTO(ctx.uid, user);
  const claimsUpdated = await syncClaims(ctx.uid, profile.role, profile.teamId);
  return { profile, claimsUpdated };
}
