import { HttpsError, type FunctionsErrorCode } from "firebase-functions/v2/https";
import type { CallableErrorDetails, ErrorReason } from "../shared/contract.js";

/**
 * Throws an HttpsError whose `details.reason` is a stable, client-facing code.
 * Messages are safe to show but never include secrets or other users' data.
 */
export function fail(
  code: FunctionsErrorCode,
  reason: ErrorReason,
  message: string,
  extra: Omit<CallableErrorDetails, "reason"> = {},
): never {
  throw new HttpsError(code, message, { reason, ...extra } satisfies CallableErrorDetails);
}

export function reasonOf(err: unknown): ErrorReason | undefined {
  if (err instanceof HttpsError) {
    return (err.details as CallableErrorDetails | undefined)?.reason;
  }
  return undefined;
}
