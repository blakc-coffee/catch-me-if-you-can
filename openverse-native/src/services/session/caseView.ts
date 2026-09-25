import type { UnlockedPuzzle } from "../../types";

/** Header text for the case screen, derived from the real unlocked puzzles (never hardcoded). */
export function caseHeader(puzzles: UnlockedPuzzle[], activePuzzleId: string | null): { title: string; position: string } {
  const index = puzzles.findIndex((p) => p.puzzleId === activePuzzleId);
  if (index < 0) return { title: "SEEKER / CASE FILES", position: `${puzzles.length} UNLOCKED` };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    title: `SEEKER / ${puzzles[index]!.puzzleId.toUpperCase()}`,
    position: `CASE ${pad(index + 1)} / ${pad(puzzles.length)}`,
  };
}
