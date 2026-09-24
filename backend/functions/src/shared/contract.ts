/**
 * Client ↔ server contract for the OpenVerse callable functions.
 *
 * This file has no runtime imports so it can be copied verbatim into client apps
 * (openverse-native, openverse-web) and kept in sync. Callable errors carry
 * `details.reason` set to one of `ErrorReason`.
 *
 * Roles and status values are lower-case to match the existing seekerdb schema.
 */

export const ROLES = ["seeker", "hider", "surveillance", "admin"] as const;
export type Role = (typeof ROLES)[number];
export type TeamType = "seeker" | "hider";

/** Region every callable is deployed to. Clients must call functions in this region. */
export const FUNCTIONS_REGION = "asia-south1";

export const CALLABLES = {
  createOrSyncProfile: "createOrSyncProfile",
  assignUser: "assignUser",
  joinTeam: "joinTeam",
  stopTracking: "stopTracking",
  setGameStatus: "setGameStatus",
  eliminatePlayer: "eliminatePlayer",
  updateTelemetry: "updateTelemetry",
  uploadLocationBatch: "uploadLocationBatch",
  deleteLocationHistory: "deleteLocationHistory",
  claimArtifact: "claimArtifact",
  submitPuzzleAnswer: "submitPuzzleAnswer",
  createBroadcast: "createBroadcast",
} as const;

export type ErrorReason =
  | "UNAUTHENTICATED"
  | "ANONYMOUS_NOT_ALLOWED"
  | "INVALID_ARGUMENT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "PROFILE_REQUIRED"
  | "ACCOUNT_SUSPENDED"
  | "ROLE_NOT_ALLOWED"
  | "CANNOT_CHANGE_OWN_ROLE"
  | "USER_NOT_FOUND"
  | "TEAM_NOT_FOUND"
  | "TEAM_ROLE_MISMATCH"
  | "NO_TEAM"
  | "INVALID_JOIN_CODE"
  | "GAME_NOT_ACTIVE"
  | "GAME_ENDED"
  | "PLAYER_ELIMINATED"
  | "TELEMETRY_CLOCK_SKEW"
  | "BATCH_ID_CONFLICT"
  | "SAMPLE_OUT_OF_RANGE"
  | "INVALID_ARTIFACT_CODE"
  | "ARTIFACT_ALREADY_CLAIMED"
  | "PUZZLE_NOT_FOUND"
  | "PUZZLE_LOCKED"
  | "BROADCAST_COOLDOWN"
  | "INTERNAL";

export interface CallableErrorDetails {
  reason: ErrorReason;
  /** Present for RATE_LIMITED and BROADCAST_COOLDOWN. */
  retryAfterMs?: number;
  /** Present for INVALID_ARGUMENT: field paths and messages, never values. */
  issues?: { path: string; message: string }[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------- profile / teams / roles

export type PlayerStatus = "active" | "eliminated" | "suspended";
export type GameStatus = "draft" | "active" | "paused" | "ended";

export interface ProfileDTO {
  uid: string;
  playerId: string;
  name: string;
  email: string | null;
  role: Role;
  teamId: string | null;
  status: PlayerStatus;
  score: number;
  eliminationTokens: number;
}

export interface TeamDTO {
  teamId: string;
  name: string;
  type: TeamType;
  score: number;
  tokens: number;
  artifactsClaimed: number;
  puzzlesSolved: number;
}

export interface CreateOrSyncProfileRequest {
  name?: string;
}
export interface CreateOrSyncProfileResponse {
  profile: ProfileDTO;
  /** True when custom claims (role/teamId) changed; the client must call getIdToken(true). */
  claimsUpdated: boolean;
}

export interface AssignUserRequest {
  uid: string;
  role?: Role;
  /** A team id, or null to remove the user from their team. */
  teamId?: string | null;
}
export interface AssignUserResponse {
  uid: string;
  role: Role;
  teamId: string | null;
}

export interface JoinTeamRequest {
  joinCode: string;
}
export interface JoinTeamResponse {
  team: TeamDTO;
  role: Role;
}

export interface StopTrackingResponse {
  trackingEnabled: false;
}

export interface SetGameStatusRequest {
  status: GameStatus;
}
export interface SetGameStatusResponse {
  status: GameStatus;
  seekersDeactivated: number;
}

export interface EliminatePlayerRequest {
  uid: string;
}
export interface EliminatePlayerResponse {
  uid: string;
  status: "eliminated";
}

// ---------------------------------------------------------------- telemetry

export interface UpdateTelemetryRequest {
  lat: number;
  lon: number;
  accuracyM: number;
  speedMps?: number;
  headingDeg?: number;
  battery?: number;
  signal?: "STRONG" | "GOOD" | "WEAK";
  /** Device epoch ms when the fix was taken. */
  clientTs: number;
}
export interface UpdateTelemetryResponse {
  acceptedAtMs: number;
  nextAllowedAtMs: number;
  zoneId: string | null;
  zoneName: string | null;
  inBounds: boolean;
}

export interface LocationSampleDTO {
  t: number;
  lat: number;
  lon: number;
  acc: number;
  spd?: number;
  hdg?: number;
}

export interface UploadLocationBatchRequest {
  /**
   * Deterministic idempotency key chosen by the client, e.g.
   * `b_<firstT>_<lastT>_<count>_<hash>`. Retrying the same batch with the same
   * id is safe and returns DUPLICATE.
   */
  batchId: string;
  samples: LocationSampleDTO[];
}
export interface UploadLocationBatchResponse {
  batchId: string;
  status: "STORED" | "DUPLICATE";
  count: number;
}

export interface DeleteLocationHistoryResponse {
  deleted: number;
}

// ---------------------------------------------------------------- artifacts

export interface ClaimArtifactRequest {
  /** Raw string decoded from the QR code (the artifact's qrCode). */
  payload: string;
}

export interface PuzzleDTO {
  puzzleId: string;
  title: string;
  question: string;
}

export type ClaimArtifactResponse =
  | {
      status: "CLAIMED";
      artifactId: string;
      name: string;
      points: number;
      /** Artifacts claimed by the caller's team so far. */
      teamArtifactsClaimed: number;
      totalArtifacts: number;
      /** Puzzle unlocked for the team by this artifact, if any. */
      puzzle: PuzzleDTO | null;
    }
  | {
      /** A decoy (qrType "wrong"): no points, optional redirect set by the organisers. */
      status: "DECOY";
      artifactId: string;
      name: string;
      redirectUrl: string | null;
    };

// ---------------------------------------------------------------- puzzles

export interface SubmitPuzzleAnswerRequest {
  puzzleId: string;
  answer: string;
}
export type SubmitPuzzleAnswerResponse =
  | { status: "SOLVED"; puzzleId: string; pointsAwarded: number; tokensAwarded: number; teamTokens: number }
  | { status: "INCORRECT"; puzzleId: string }
  | {
      status: "ALREADY_CLAIMED";
      puzzleId: string;
      solvedByYourTeam: boolean;
      solvedBy: { playerId: string; name: string; teamName: string };
    };

// ---------------------------------------------------------------- broadcasts

export type CreateBroadcastRequest = Record<string, never>;
export interface CreateBroadcastResponse {
  broadcastId: string;
  totalActiveSeekers: number;
  nextBroadcastAtMs: number;
}
