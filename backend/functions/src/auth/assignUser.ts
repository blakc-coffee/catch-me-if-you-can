import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { RATE_LIMITS } from "../config.js";
import { loadActor, read, refs, requireRole, withUserDefaults, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { parseInput, resourceId, uidSchema } from "../lib/validation.js";
import type { SeekerDoc, TeamDoc, UserDoc } from "../models.js";
import { ROLES, type AssignUserResponse, type Role } from "../shared/contract.js";
import { safeRole, syncClaims } from "./profile.js";

const schema = z
  .strictObject({ uid: uidSchema, role: z.enum(ROLES).optional(), teamId: resourceId.nullable().optional() })
  .refine((v) => v.role !== undefined || v.teamId !== undefined, "set role and/or teamId");

/** Player roles must match their team's type; staff roles are not on player teams. */
export function teamFits(role: Role, team: TeamDoc | undefined): boolean {
  if (!team) return true;
  return (role === "seeker" || role === "hider") && team.type === role;
}

/**
 * ADMIN-only: sets a user's role and/or team. This is the only way roles and
 * teams change (besides joinTeam codes); it updates the users doc and the
 * {role, teamId} custom claims used by security rules.
 */
export async function assignUser(ctx: CallContext, raw: unknown): Promise<AssignUserResponse> {
  const input = parseInput(schema, raw);
  const d = db();
  const actor = await loadActor(d, d, ctx.uid);
  requireRole(actor.role, ["admin"]);
  if (input.uid === ctx.uid && input.role !== undefined && input.role !== actor.role) {
    fail("failed-precondition", "CANNOT_CHANGE_OWN_ROLE", "Admins cannot change their own role.");
  }
  await consumeRateLimit(d, `admin_${ctx.uid}`, RATE_LIMITS.adminAction);

  const result = await d.runTransaction(async (tx) => {
    const data = await read<Partial<UserDoc>>(tx, refs.user(d, input.uid));
    if (!data) fail("not-found", "USER_NOT_FOUND", "User has no profile.");
    const current = withUserDefaults(input.uid, data);
    const role = input.role ?? safeRole(input.uid, current.role);
    const teamId = input.teamId === undefined ? current.teamId : input.teamId;
    const team = teamId ? await read<TeamDoc>(tx, refs.team(d, teamId)) : undefined;
    if (teamId && !team) fail("not-found", "TEAM_NOT_FOUND", "Team not found.");
    if (!teamFits(role, team)) fail("failed-precondition", "TEAM_ROLE_MISMATCH", "Role does not match the team type.");
    const seeker = await read<SeekerDoc>(tx, refs.seeker(d, input.uid));

    const now = FieldValue.serverTimestamp();
    tx.update(refs.user(d, input.uid), { role, teamId, updatedAt: now });
    if (seeker?.active && (role !== "seeker" || teamId !== seeker.teamId)) {
      tx.update(refs.seeker(d, input.uid), { active: false, trackingEnabled: false, status: "offline", updatedAt: now });
    }
    return { role, teamId };
  });

  await syncClaims(input.uid, result.role, result.teamId);
  return { uid: input.uid, ...result };
}
