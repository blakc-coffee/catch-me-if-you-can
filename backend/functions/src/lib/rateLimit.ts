import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { COL, type RateLimitDoc } from "../models.js";
import { fail } from "./errors.js";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface WindowState {
  windowStartMs: number;
  count: number;
}

export interface RateDecision {
  allowed: boolean;
  next: WindowState;
  retryAfterMs: number;
}

/** Pure fixed-window evaluation, split out for unit tests. */
export function evaluateWindow(state: WindowState | undefined, nowMs: number, rule: RateLimitRule): RateDecision {
  const fresh = !state || nowMs - state.windowStartMs >= rule.windowMs || nowMs < state.windowStartMs;
  const current: WindowState = fresh ? { windowStartMs: nowMs, count: 0 } : state;
  if (current.count >= rule.limit) {
    return { allowed: false, next: current, retryAfterMs: current.windowStartMs + rule.windowMs - nowMs };
  }
  return { allowed: true, next: { windowStartMs: current.windowStartMs, count: current.count + 1 }, retryAfterMs: 0 };
}

/**
 * Consumes one unit from `rateLimits/{key}` in its own transaction and throws
 * RATE_LIMITED when exhausted. A limit of 1 per window doubles as a minimum
 * interval (used for telemetry). Returns the time the next call is allowed.
 */
export async function consumeRateLimit(
  db: Firestore,
  key: string,
  rule: RateLimitRule,
  nowMs: number = Date.now(),
): Promise<{ nextAllowedAtMs: number }> {
  const ref = db.collection(COL.rateLimits).doc(key);
  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as RateLimitDoc | undefined;
    const d = evaluateWindow(data, nowMs, rule);
    if (d.allowed) {
      const doc: RateLimitDoc = {
        ...d.next,
        expireAt: Timestamp.fromMillis(d.next.windowStartMs + rule.windowMs + 60_000),
      };
      tx.set(ref, doc);
    }
    return d;
  });
  if (!decision.allowed) {
    fail("resource-exhausted", "RATE_LIMITED", "Too many requests. Try again later.", {
      retryAfterMs: Math.max(decision.retryAfterMs, 0),
    });
  }
  const full = decision.next.count >= rule.limit;
  return { nextAllowedAtMs: full ? decision.next.windowStartMs + rule.windowMs : nowMs };
}
