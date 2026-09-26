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
  constructor(
    message: string,
    public readonly reason: ErrorReason,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ConvexAppError";
  }
}

export function fail(reason: ErrorReason, message: string, retryAfterMs?: number): never {
  throw new ConvexAppError(message, reason, retryAfterMs);
}
