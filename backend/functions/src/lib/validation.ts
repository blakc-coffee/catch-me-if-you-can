import { z } from "zod";
import { LIMITS } from "../config.js";
import { fail } from "./errors.js";

/** Team / puzzle ids (Firestore auto-ids or admin-chosen): no "_" so composite doc ids stay unambiguous. */
export const resourceId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "must be 1-64 chars of A-Z a-z 0-9 -");
/** Firebase Auth uids (default and custom). */
export const uidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "invalid uid");
export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);
export const accuracyM = z.number().min(0).max(5000);
export const speedMps = z.number().min(0).max(100);
export const headingDeg = z.number().min(0).lt(360);
export const epochMs = z.number().int().min(1_600_000_000_000).max(4_102_444_800_000);

function payloadBytes(raw: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(raw ?? null), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Size-checks then strictly parses a callable payload. Unknown keys are rejected
 * (schemas are strictObject) and issue reports carry field paths, never values.
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  maxBytes: number = LIMITS.defaultPayloadBytes,
): z.infer<S> {
  if (payloadBytes(raw) > maxBytes) {
    fail("invalid-argument", "PAYLOAD_TOO_LARGE", `Request exceeds ${maxBytes} bytes.`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    fail("invalid-argument", "INVALID_ARGUMENT", "Request failed validation.", {
      issues: result.error.issues.slice(0, 10).map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      })),
    });
  }
  return result.data;
}
