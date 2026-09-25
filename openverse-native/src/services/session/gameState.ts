import type { MissionPuzzleDTO, PuzzleDTO } from "../firebase/contract";
import type { GameState, UnlockedPuzzle } from "../../types";

export const initialGameState: GameState = {
  claimedArtifactIds: [],
  lastScannedPayload: null,
  puzzles: {},
  activePuzzleId: null,
};

const isString = (v: unknown): v is string => typeof v === "string";

function toPuzzle(raw: unknown): UnlockedPuzzle | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!isString(p.puzzleId) || !isString(p.title) || !isString(p.question)) return null;
  return {
    puzzleId: p.puzzleId,
    title: p.title,
    question: p.question,
    unlockedAtMs: typeof p.unlockedAtMs === "number" ? p.unlockedAtMs : null,
    solved: p.solved === true,
    solvedByYourTeam: p.solvedByYourTeam === true,
  };
}

/**
 * Reads stored progress defensively. Also upgrades the previous shape, which
 * kept a single `activePuzzle` and `solvedPuzzleIds`, so an unlocked case file
 * is not lost on update.
 */
export function normalizeGameState(raw: unknown): GameState {
  if (!raw || typeof raw !== "object") return initialGameState;
  const r = raw as Record<string, unknown>;
  const puzzles: Record<string, UnlockedPuzzle> = {};
  if (r.puzzles && typeof r.puzzles === "object") {
    for (const value of Object.values(r.puzzles as Record<string, unknown>)) {
      const p = toPuzzle(value);
      if (p) puzzles[p.puzzleId] = p;
    }
  }
  const legacy = toPuzzle(r.activePuzzle);
  const legacySolved = Array.isArray(r.solvedPuzzleIds) ? r.solvedPuzzleIds.filter(isString) : [];
  if (legacy && !puzzles[legacy.puzzleId]) {
    const solved = legacySolved.includes(legacy.puzzleId);
    puzzles[legacy.puzzleId] = { ...legacy, solved, solvedByYourTeam: solved };
  }
  const activePuzzleId = isString(r.activePuzzleId) && puzzles[r.activePuzzleId] ? r.activePuzzleId : legacy?.puzzleId ?? null;
  return {
    claimedArtifactIds: Array.isArray(r.claimedArtifactIds) ? r.claimedArtifactIds.filter(isString) : [],
    lastScannedPayload: isString(r.lastScannedPayload) ? r.lastScannedPayload : null,
    puzzles,
    activePuzzleId,
  };
}

/** Oldest unlock first; unknown unlock times go last, then by id. */
export function listPuzzles(state: GameState): UnlockedPuzzle[] {
  return Object.values(state.puzzles).sort(
    (a, b) => (a.unlockedAtMs ?? Number.MAX_SAFE_INTEGER) - (b.unlockedAtMs ?? Number.MAX_SAFE_INTEGER) || a.puzzleId.localeCompare(b.puzzleId),
  );
}

/** Records an artifact claim; a newly unlocked puzzle is added (never replacing older ones) and opened. */
export function applyClaim(state: GameState, claim: { artifactId: string; payload: string; puzzle: PuzzleDTO | null }, nowMs: number): GameState {
  const claimedArtifactIds = state.claimedArtifactIds.includes(claim.artifactId) ? state.claimedArtifactIds : [...state.claimedArtifactIds, claim.artifactId];
  if (!claim.puzzle) return { ...state, claimedArtifactIds, lastScannedPayload: claim.payload };
  const existing = state.puzzles[claim.puzzle.puzzleId];
  const puzzle: UnlockedPuzzle = existing
    ? { ...existing, title: claim.puzzle.title, question: claim.puzzle.question }
    : { ...claim.puzzle, unlockedAtMs: nowMs, solved: false, solvedByYourTeam: false };
  return {
    claimedArtifactIds,
    lastScannedPayload: claim.payload,
    puzzles: { ...state.puzzles, [puzzle.puzzleId]: puzzle },
    activePuzzleId: puzzle.puzzleId,
  };
}

/** Merges the server's list (authoritative for text and solve state); keeps anything only known locally. */
export function mergeMissionPuzzles(state: GameState, server: MissionPuzzleDTO[]): GameState {
  const puzzles = { ...state.puzzles };
  for (const p of server) {
    puzzles[p.puzzleId] = {
      puzzleId: p.puzzleId,
      title: p.title,
      question: p.question,
      unlockedAtMs: p.unlockedAtMs ?? puzzles[p.puzzleId]?.unlockedAtMs ?? null,
      solved: p.solved,
      solvedByYourTeam: p.solvedByYourTeam,
    };
  }
  const activePuzzleId = state.activePuzzleId && puzzles[state.activePuzzleId] ? state.activePuzzleId : null;
  return { ...state, puzzles, activePuzzleId };
}

export function markSolved(state: GameState, puzzleId: string, byYourTeam: boolean): GameState {
  const p = state.puzzles[puzzleId];
  if (!p) return state;
  return { ...state, puzzles: { ...state.puzzles, [puzzleId]: { ...p, solved: true, solvedByYourTeam: p.solvedByYourTeam || byYourTeam } } };
}

export function selectPuzzle(state: GameState, puzzleId: string | null): GameState {
  if (puzzleId !== null && !state.puzzles[puzzleId]) return state;
  return { ...state, activePuzzleId: puzzleId };
}
