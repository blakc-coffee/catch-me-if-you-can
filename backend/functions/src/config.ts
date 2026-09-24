import { FUNCTIONS_REGION, type Role } from "./shared/contract.js";

export const REGION = FUNCTIONS_REGION;

/**
 * App Check enforcement is opt-in per environment so the emulator and early
 * development builds keep working. Set ENFORCE_APP_CHECK=true in
 * functions/.env.<projectId> once the Android app ships with the Play Integrity
 * provider (see README "App Check").
 */
export const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";

/** Role given to brand-new profiles. Every other role is assigned by an ADMIN. */
export const DEFAULT_ROLE: Role = "seeker";

/** Used when game/state is created (setGameStatus / migrate / seed). */
export const GAME_DEFAULTS = {
  telemetryMinIntervalSec: 10,
  broadcastCooldownSec: 600,
  staleAfterSec: 900,
  locationRetentionDays: 30,
} as const;

/** Defaults for optional fields missing from existing artifacts/puzzles docs. */
export const CONTENT_DEFAULTS = {
  artifactPoints: 25,
  puzzlePoints: 100,
  puzzleTokens: 1,
} as const;

export const LIMITS = {
  /** Serialized request size caps (bytes). */
  defaultPayloadBytes: 4 * 1024,
  locationBatchPayloadBytes: 128 * 1024,

  locationBatchMaxSamples: 500,
  /** Accept samples up to this old (must not exceed the retention window). */
  sampleMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** Tolerated device clock drift into the future. */
  clockSkewFutureMs: 5 * 60 * 1000,
  /** Live telemetry older than this should go through uploadLocationBatch instead. */
  telemetryMaxAgeMs: 10 * 60 * 1000,

  maxBroadcastPositions: 200,
} as const;

/** Fixed-window rate limits, keyed per user (and per resource where noted). */
export const RATE_LIMITS = {
  profileSync: { limit: 20, windowMs: 60_000 },
  joinTeam: { limit: 10, windowMs: 15 * 60_000 },
  trackingState: { limit: 30, windowMs: 60_000 },
  locationBatch: { limit: 30, windowMs: 60_000 },
  deleteHistory: { limit: 5, windowMs: 60 * 60_000 },
  claimArtifact: { limit: 30, windowMs: 60_000 },
  puzzleAnswerPerPuzzle: { limit: 10, windowMs: 60_000 },
  puzzleAnswerGlobal: { limit: 60, windowMs: 60_000 },
  adminAction: { limit: 60, windowMs: 60_000 },
} as const;
