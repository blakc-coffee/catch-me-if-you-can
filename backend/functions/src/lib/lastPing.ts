import type { Timestamp } from "firebase-admin/firestore";

/** Normalize seeker lastPing whether stored as epoch ms (direct Firestore) or Timestamp (callable). */
export function lastPingMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as Timestamp).toMillis === "function") {
    return (value as Timestamp).toMillis();
  }
  return 0;
}
