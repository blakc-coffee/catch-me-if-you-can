/**
 * Firestore document models, adapted to the existing seekerdb schema
 * (users / teams / artifacts / puzzles / areas). Fields marked "existing" are
 * part of that schema and keep their names; everything else is added and owned
 * by Cloud Functions.
 *
 * Collections not readable by any client: teamJoinCodes, rateLimits.
 * `puzzles` (holds plaintext answers) is readable only by admins, as before;
 * players read the answer-free mirror in `puzzlePublic`.
 */
import type { Timestamp } from "firebase-admin/firestore";
import type { GameStatus, PlayerStatus, Role, TeamType } from "./shared/contract.js";

export const COL = {
  // existing schema
  users: "users",
  teams: "teams",
  artifacts: "artifacts",
  puzzles: "puzzles",
  areas: "areas",
  // added
  game: "game",
  seekers: "seekers",
  locationBatches: "locationBatches", // subcollection of seekers/{uid}
  artifactClaims: "artifactClaims",
  puzzleUnlocks: "puzzleUnlocks",
  puzzlePublic: "puzzlePublic",
  puzzleClaims: "puzzleClaims",
  broadcasts: "broadcasts",
  teamJoinCodes: "teamJoinCodes",
  rateLimits: "rateLimits",
} as const;

export const GAME_DOC = "state";

/**
 * Team and puzzle ids are Firestore auto-ids or admin-chosen ids without "_",
 * so "_"-joined composite ids are unambiguous. Artifact ids are free-form QR
 * strings, so claims key them by hash.
 */
export const docIds = {
  artifactClaim: (teamId: string, artifactKey: string) => `${teamId}_${artifactKey}`,
  puzzleUnlock: (teamId: string, puzzleId: string) => `${teamId}_${puzzleId}`,
};

export type SeekerStatus = "active" | "in_transit" | "offline" | "eliminated";
export type Signal = "STRONG" | "GOOD" | "WEAK";

/** users/{uid} */
export interface UserDoc {
  // existing
  name: string;
  email: string | null;
  role: Role;
  teamId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // added (backfilled by createOrSyncProfile / migrate)
  playerId: string;
  status: PlayerStatus;
  score: number;
  eliminationTokens: number;
  lastSeenAt?: Timestamp;
}

/** teams/{teamId} */
export interface TeamDoc {
  // existing
  name: string;
  type: TeamType;
  createdAt: Timestamp;
  // added counters (functions only)
  score?: number;
  tokens?: number;
  artifactsClaimed?: number;
  puzzlesSolved?: number;
  updatedAt?: Timestamp;
}

/** artifacts/{qrCode} — existing. The doc id is the printed QR value. */
export interface ArtifactDoc {
  qrCode: string;
  qrType: "correct" | "wrong";
  name: string;
  description: string;
  areaId: string | null;
  puzzleId: string | null;
  redirectUrl: string | null;
  isActive: boolean;
  createdAt: Timestamp;
  /** Optional; defaults to ARTIFACT_DEFAULT_POINTS. */
  points?: number;
  /**
   * Stable identity for one-claim-per-team deduplication, kept when the QR code
   * is rotated (see rotateArtifactCode). Missing means the doc id.
   */
  claimKey?: string;
  /** Set on a rotated-out artifact doc: the doc id of its replacement. */
  replacedBy?: string;
}

/** puzzles/{puzzleId} — existing, admin-only. `answer` may hold pipe-separated alternatives. */
export interface PuzzleDoc {
  title: string;
  question: string;
  answer: string;
  createdAt: Timestamp;
  // optional additions
  points?: number;
  tokensAwarded?: number;
  hints?: string[];
  /** Roles that may attempt it. Default ["seeker"]; seekers additionally need a team unlock. */
  audience?: Role[];
}

/** puzzlePublic/{puzzleId} — answer-free mirror maintained by the onPuzzleWritten trigger + solve state. */
export interface PuzzlePublicDoc {
  title: string;
  question: string;
  hints: string[];
  audience: Role[];
  points: number;
  tokensAwarded: number;
  isSolved: boolean;
  solvedBy: SolvedBy | null;
  solvedAt: Timestamp | null;
}

export interface SolvedBy {
  uid: string;
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
}

/** game/state — single game configuration. */
export interface GameDoc {
  status: GameStatus;
  /** Scopes on-device state; clients treat a missing value as DEFAULT_EVENT_ID. */
  eventId?: string;
  telemetryMinIntervalSec: number;
  broadcastCooldownSec: number;
  staleAfterSec: number;
  locationRetentionDays: number;
  lastBroadcastAt: Timestamp | null;
  updatedAt: Timestamp;
}

/** seekers/{uid} — latest live telemetry only. */
export interface SeekerDoc {
  uid: string;
  teamId: string;
  playerId: string;
  name: string;
  active: boolean;
  status: SeekerStatus;
  zoneId: string | null;
  zoneName: string | null;
  x: number | null;
  y: number | null;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  battery: number | null;
  signal: Signal | null;
  trackingEnabled: boolean;
  clientTs: number | null;
  /** Server epoch ms when the current live fix was accepted (baseline for plausibility checks). */
  fixServerMs?: number | null;
  lastPing: Timestamp | null;
  updatedAt: Timestamp;
}

export interface LocationSample {
  t: number;
  lat: number;
  lon: number;
  acc: number;
  spd?: number | undefined;
  hdg?: number | undefined;
}

/** seekers/{uid}/locationBatches/{batchId} — TTL on expireAt. */
export interface LocationBatchDoc {
  uid: string;
  teamId: string | null;
  batchId: string;
  contentHash: string;
  count: number;
  firstSampleAt: Timestamp;
  lastSampleAt: Timestamp;
  samples: LocationSample[];
  receivedAt: Timestamp;
  expireAt: Timestamp;
}

/** artifactClaims/{teamId_sha256(qrCode)} — one claim per team per artifact. */
export interface ArtifactClaimDoc {
  teamId: string;
  artifactId: string;
  puzzleId: string | null;
  claimedBy: string;
  playerId: string;
  points: number;
  claimedAt: Timestamp;
}

/** puzzleUnlocks/{teamId_puzzleId} — lets the team read puzzlePublic/{puzzleId}. */
export interface PuzzleUnlockDoc {
  teamId: string;
  puzzleId: string;
  artifactId: string;
  unlockedAt: Timestamp;
}

/** puzzleClaims/{puzzleId} — the single winning solve (first-solve lockout across teams). */
export interface PuzzleClaimDoc {
  puzzleId: string;
  uid: string;
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  points: number;
  tokensAwarded: number;
  claimedAt: Timestamp;
}

export interface BroadcastPosition {
  playerId: string;
  name: string;
  teamId: string;
  zoneId: string | null;
  zoneName: string | null;
  x: number;
  y: number;
  lastPingMs: number;
}

/** broadcasts/{broadcastId} */
export interface BroadcastDoc {
  createdAt: Timestamp;
  serverEpochMs: number;
  operatorUid: string;
  operator: string;
  totalActiveSeekers: number;
  seekerPositions: BroadcastPosition[];
}

/** teamJoinCodes/{sha256(normalizedCode)} — server only. */
export interface TeamJoinCodeDoc {
  teamId: string;
  active: boolean;
}

/** rateLimits/{key} — server only. TTL on expireAt. */
export interface RateLimitDoc {
  windowStartMs: number;
  count: number;
  expireAt: Timestamp;
}
