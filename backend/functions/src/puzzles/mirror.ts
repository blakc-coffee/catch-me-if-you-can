import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { CONTENT_DEFAULTS } from "../config.js";
import { COL, type PuzzleDoc } from "../models.js";
import { ROLES, type Role } from "../shared/contract.js";

export function publicAudience(puzzle: Partial<PuzzleDoc>): Role[] {
  const a = Array.isArray(puzzle.audience) ? puzzle.audience.filter((r): r is Role => (ROLES as readonly unknown[]).includes(r)) : [];
  return a.length ? a : ["seeker"];
}

/**
 * Copies the player-visible fields of puzzles/{id} (never `answer`) into
 * puzzlePublic/{id}, preserving solve state. Called by the onPuzzleWritten
 * trigger and by the seed/migrate scripts.
 */
export async function mirrorPuzzle(db: Firestore, puzzleId: string, puzzle: Partial<PuzzleDoc> | undefined): Promise<void> {
  const ref = db.collection(COL.puzzlePublic).doc(puzzleId);
  if (!puzzle) {
    await ref.delete();
    return;
  }
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    tx.set(
      ref,
      {
        title: String(puzzle.title ?? ""),
        question: String(puzzle.question ?? ""),
        hints: Array.isArray(puzzle.hints) ? puzzle.hints.map(String) : [],
        audience: publicAudience(puzzle),
        points: typeof puzzle.points === "number" ? puzzle.points : CONTENT_DEFAULTS.puzzlePoints,
        tokensAwarded: typeof puzzle.tokensAwarded === "number" ? puzzle.tokensAwarded : CONTENT_DEFAULTS.puzzleTokens,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : { isSolved: false, solvedBy: null, solvedAt: null }),
      },
      { merge: true },
    );
  });
}
