import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { CONTENT_DEFAULTS, RATE_LIMITS } from "../config.js";
import { loadActor, loadGame, loadTeam, refs, requireGameActive, requirePlayer, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { answerMatches } from "../lib/normalize.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { parseInput, resourceId } from "../lib/validation.js";
import { COL, docIds, type PuzzleClaimDoc, type PuzzleDoc } from "../models.js";
import type { SubmitPuzzleAnswerResponse } from "../shared/contract.js";
import { publicAudience } from "./mirror.js";

const schema = z.strictObject({
  puzzleId: resourceId,
  answer: z.string().min(1).max(256),
});

function notFound(): never {
  fail("not-found", "PUZZLE_NOT_FOUND", "Puzzle not found.");
}

function alreadyClaimed(puzzleId: string, claim: PuzzleClaimDoc, teamId: string): SubmitPuzzleAnswerResponse {
  return {
    status: "ALREADY_CLAIMED",
    puzzleId,
    solvedByYourTeam: claim.teamId === teamId,
    solvedBy: { playerId: claim.playerId, name: claim.name, teamName: claim.teamName },
  };
}

/**
 * Checks an answer server-side against the admin-only puzzles/{id}.answer and
 * awards the puzzle inside a transaction keyed on puzzleClaims/{puzzleId}, so
 * exactly one team is rewarded even under concurrent submissions (first-solve
 * lockout). Seekers must have unlocked the puzzle by claiming its artifact.
 */
export async function submitPuzzleAnswer(ctx: CallContext, raw: unknown): Promise<SubmitPuzzleAnswerResponse> {
  const { puzzleId, answer } = parseInput(schema, raw);
  const d = db();
  await consumeRateLimit(d, `answer_${ctx.uid}`, RATE_LIMITS.puzzleAnswerGlobal);
  await consumeRateLimit(d, `answer_${ctx.uid}_${puzzleId}`, RATE_LIMITS.puzzleAnswerPerPuzzle);

  const claimRef = d.collection(COL.puzzleClaims).doc(puzzleId);
  const puzzleRef = d.collection(COL.puzzles).doc(puzzleId);

  return d.runTransaction(
    async (tx): Promise<SubmitPuzzleAnswerResponse> => {
      const current = requirePlayer(await loadActor(d, tx, ctx.uid), ["seeker", "hider"]);
      requireGameActive(await loadGame(d, tx));
      const puzzleSnap = await tx.get(puzzleRef);
      const puzzle = puzzleSnap.data() as PuzzleDoc | undefined;
      // Puzzles outside the caller's audience are reported as missing, not forbidden.
      if (!puzzle || !publicAudience(puzzle).includes(current.role)) notFound();

      if (current.role === "seeker") {
        const unlockRef = d.collection(COL.puzzleUnlocks).doc(docIds.puzzleUnlock(current.teamId, puzzleId));
        if (!(await tx.get(unlockRef)).exists) {
          fail("failed-precondition", "PUZZLE_LOCKED", "Scan the linked artifact to unlock this puzzle.");
        }
      }

      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists) return alreadyClaimed(puzzleId, claimSnap.data() as PuzzleClaimDoc, current.teamId);
      if (!answerMatches(typeof puzzle.answer === "string" ? puzzle.answer : "", answer)) {
        return { status: "INCORRECT", puzzleId };
      }

      const team = await loadTeam(d, tx, current.teamId);
      const points = typeof puzzle.points === "number" ? puzzle.points : CONTENT_DEFAULTS.puzzlePoints;
      const tokens = typeof puzzle.tokensAwarded === "number" ? puzzle.tokensAwarded : CONTENT_DEFAULTS.puzzleTokens;

      const now = FieldValue.serverTimestamp();
      const solvedBy = { uid: ctx.uid, playerId: current.playerId, name: current.name, teamId: current.teamId, teamName: team.name };
      const claim: Omit<PuzzleClaimDoc, "claimedAt"> = { puzzleId, ...solvedBy, points, tokensAwarded: tokens };
      tx.create(claimRef, { ...claim, claimedAt: now });
      tx.set(d.collection(COL.puzzlePublic).doc(puzzleId), { isSolved: true, solvedBy, solvedAt: now }, { merge: true });
      tx.update(refs.team(d, current.teamId), {
        score: FieldValue.increment(points),
        tokens: FieldValue.increment(tokens),
        puzzlesSolved: FieldValue.increment(1),
        updatedAt: now,
      });
      tx.update(refs.user(d, ctx.uid), {
        score: FieldValue.increment(points),
        eliminationTokens: FieldValue.increment(tokens),
        updatedAt: now,
      });
      return { status: "SOLVED", puzzleId, pointsAwarded: points, tokensAwarded: tokens, teamTokens: (team.tokens ?? 0) + tokens };
    },
    { maxAttempts: 10 },
  );
}
