import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { REGION } from "../config.js";
import { callable } from "../lib/callable.js";
import { db } from "../lib/firebase.js";
import { COL, type PuzzleDoc } from "../models.js";
import { mirrorPuzzle } from "./mirror.js";
import { submitPuzzleAnswer as submitPuzzleAnswerHandler } from "./submitPuzzleAnswer.js";

export const submitPuzzleAnswer = callable("submitPuzzleAnswer", submitPuzzleAnswerHandler);

/**
 * Keeps puzzlePublic/{id} (answer-free) in sync with admin edits to puzzles/{id}.
 * Trigger events can arrive late or out of order, so the handler ignores the
 * event payload and mirrors the puzzle's *current* state.
 */
export const onPuzzleWritten = onDocumentWritten({ document: "puzzles/{puzzleId}", region: REGION }, async (event) => {
  const { puzzleId } = event.params;
  const current = await db().collection(COL.puzzles).doc(puzzleId).get();
  await mirrorPuzzle(db(), puzzleId, current.exists ? (current.data() as Partial<PuzzleDoc>) : undefined);
});
