import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { RATE_LIMITS } from "../config.js";
import { loadActor, loadTeam, read, refs, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { joinCodeKey } from "../lib/normalize.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { parseInput } from "../lib/validation.js";
import { COL, type SeekerDoc, type TeamDoc, type TeamJoinCodeDoc } from "../models.js";
import type { JoinTeamResponse, TeamDTO, TeamType } from "../shared/contract.js";
import { syncClaims } from "../auth/profile.js";

const schema = z.strictObject({ joinCode: z.string().min(4).max(32) });

export function toTeamDTO(teamId: string, t: TeamDoc): TeamDTO {
  return {
    teamId,
    name: t.name,
    type: t.type,
    score: t.score ?? 0,
    tokens: t.tokens ?? 0,
    artifactsClaimed: t.artifactsClaimed ?? 0,
    puzzlesSolved: t.puzzlesSolved ?? 0,
  };
}

/**
 * Joins a player team with an organiser-issued code. Codes exist only as hashes
 * in the server-only teamJoinCodes collection and attempts are rate limited.
 * The player's role becomes the team's type (seeker or hider); staff accounts
 * cannot join player teams. Admins can also place players with assignUser.
 */
export async function joinTeam(ctx: CallContext, raw: unknown): Promise<JoinTeamResponse> {
  const { joinCode } = parseInput(schema, raw);
  const d = db();
  await consumeRateLimit(d, `join_${ctx.uid}`, RATE_LIMITS.joinTeam);

  const codeRef = d.collection(COL.teamJoinCodes).doc(joinCodeKey(joinCode));

  const result = await d.runTransaction(async (tx) => {
    const code = await read<TeamJoinCodeDoc>(tx, codeRef);
    if (!code?.active) fail("not-found", "INVALID_JOIN_CODE", "Invalid team code.");
    const user = await loadActor(d, tx, ctx.uid);
    const team = await loadTeam(d, tx, code.teamId);
    const seeker = await read<SeekerDoc>(tx, refs.seeker(d, ctx.uid));
    if (user.role === "surveillance" || user.role === "admin") {
      fail("permission-denied", "ROLE_NOT_ALLOWED", "Staff accounts cannot join player teams.");
    }
    if (user.status === "eliminated") fail("permission-denied", "PLAYER_ELIMINATED", "You have been eliminated.");

    const role: TeamType = team.type;
    const now = FieldValue.serverTimestamp();
    tx.update(refs.user(d, ctx.uid), { teamId: code.teamId, role, updatedAt: now });
    if (seeker && (seeker.teamId !== code.teamId || role !== "seeker")) {
      tx.update(refs.seeker(d, ctx.uid), { active: false, trackingEnabled: false, status: "offline", updatedAt: now });
    }
    return { team: toTeamDTO(code.teamId, team), role };
  });

  await syncClaims(ctx.uid, result.role, result.team.teamId);
  return result;
}
