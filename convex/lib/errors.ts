export type ErrorReason =
  | "UNAUTHENTICATED"
  | "ANONYMOUS_NOT_ALLOWED"
  | "INVALID_ARGUMENT"
  | "RATE_LIMITED"
  | "ROLE_NOT_ALLOWED"
  | "NO_TEAM"
  | "GAME_NOT_ACTIVE"
  | "GAME_ENDED"
  | "PLAYER_ELIMINATED"
  | "ACCOUNT_SUSPENDED"
  | "TELEMETRY_OUT_OF_BOUNDS"
  | "TELEMETRY_LOW_ACCURACY"
  | "BATCH_ID_CONFLICT"
  | "ARTIFACT_ALREADY_CLAIMED"
  | "PUZZLE_NOT_FOUND"
  | "PUZZLE_LOCKED"
  | "INTERNAL";

export class ConvexAppError extends Error {
  readonly reason: ErrorReason;
  readonly retryAfterMs?: number;

  constructor(message: string, reason: ErrorReason, retryAfterMs?: number) {
    super(message);
    this.name = "ConvexAppError";
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

export function fail(reason: ErrorReason, message: string, retryAfterMs?: number): never {
  throw new ConvexAppError(message, reason, retryAfterMs);
}
