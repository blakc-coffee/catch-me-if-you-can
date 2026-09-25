export type AppRoute = "mission" | "scanner" | "case" | "tracking";

export type StoredPosition = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

/** A case file the team has unlocked; text comes from the server, never from the app bundle. */
export type UnlockedPuzzle = {
  puzzleId: string;
  title: string;
  question: string;
  /** Unlock time (server) for ordering; null when unknown. */
  unlockedAtMs: number | null;
  solved: boolean;
  solvedByYourTeam: boolean;
};

/** Per-account, per-event progress cached on the device (see session/gameState). */
export type GameState = {
  claimedArtifactIds: string[];
  lastScannedPayload: string | null;
  /** Every unlocked puzzle, keyed by puzzleId. Newer unlocks never remove older ones. */
  puzzles: Record<string, UnlockedPuzzle>;
  /** The case file currently open on the case screen. */
  activePuzzleId: string | null;
};
