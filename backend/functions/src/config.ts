import { FUNCTIONS_REGION, type Role } from "./shared/contract.js";

export const REGION = FUNCTIONS_REGION;

export interface AppCheckPolicy {
  /** Callables that accept location, artifact codes or puzzle answers. */
  sensitive: boolean;
  /** Every other callable. */
  standard: boolean;
}

/**
 * App Check policy (see README "App Check"). Sensitive callables require a
 * valid App Check token in every deployed environment by default; the
 * Functions emulator never enforces, so local development and tests work
 * without attestation. ENFORCE_APP_CHECK in functions/.env.<projectId>:
 *   unset  → sensitive callables enforced, others not
 *   "true" → every callable enforced
 *   "false" → nothing enforced (temporary rollout escape hatch; logged at startup)
 */
export function resolveAppCheckPolicy(env: Record<string, string | undefined>): AppCheckPolicy {
  if (env.FUNCTIONS_EMULATOR === "true" || env.ENFORCE_APP_CHECK === "false") return { sensitive: false, standard: false };
  const all = env.ENFORCE_APP_CHECK === "true";
  return { sensitive: true, standard: all };
}

export const APP_CHECK = resolveAppCheckPolicy(process.env);

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

  maxBroadcastPositions: 200,
} as const;

/**
 * Live-telemetry plausibility limits (updateTelemetry). They reject fixes a
 * phone walking or running on campus cannot produce; they cannot prove a fix
 * came from real GPS hardware (see README "Location trust").
 */
export const TELEMETRY_LIMITS = {
  /** Reported horizontal accuracy worse than this is not used as a live position. */
  maxAccuracyM: 50,
  /** A live fix older than this (server time) is stale; queued history goes through uploadLocationBatch. */
  maxFixAgeMs: 60_000,
  /** Tolerated device clock drift into the future. */
  maxFutureSkewMs: 30_000,
  /** Fastest plausible movement between fixes (fast running is ~7 m/s). */
  maxSpeedMps: 10,
  /** Jitter allowance: the smaller of both fixes' combined accuracy and this cap. */
  maxJitterM: 40,
  /** Extra time allowed on top of the server-observed interval between fixes. */
  timingGraceMs: 5_000,
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
  missionState: { limit: 60, windowMs: 60_000 },
} as const;
