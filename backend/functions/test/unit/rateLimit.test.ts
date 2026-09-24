import { describe, expect, it } from "vitest";
import { evaluateWindow } from "../../src/lib/rateLimit.js";

describe("evaluateWindow", () => {
  const rule = { limit: 3, windowMs: 1000 };

  it("allows up to the limit inside a window, then blocks with retryAfter", () => {
    let state = undefined as ReturnType<typeof evaluateWindow>["next"] | undefined;
    for (let i = 0; i < 3; i++) {
      const d = evaluateWindow(state, 10_000 + i, rule);
      expect(d.allowed).toBe(true);
      state = d.next;
    }
    const blocked = evaluateWindow(state, 10_500, rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(500);
  });

  it("starts a new window once the old one elapses", () => {
    const d = evaluateWindow({ windowStartMs: 10_000, count: 3 }, 11_000, rule);
    expect(d.allowed).toBe(true);
    expect(d.next).toEqual({ windowStartMs: 11_000, count: 1 });
  });

  it("acts as a minimum interval with limit 1 (telemetry throttle)", () => {
    const interval = { limit: 1, windowMs: 10_000 };
    const first = evaluateWindow(undefined, 0, interval);
    expect(first.allowed).toBe(true);
    const tooSoon = evaluateWindow(first.next, 9_999, interval);
    expect(tooSoon.allowed).toBe(false);
    expect(tooSoon.retryAfterMs).toBe(1);
    expect(evaluateWindow(first.next, 10_000, interval).allowed).toBe(true);
  });

  it("resets if the stored window is in the future (clock rollback)", () => {
    const d = evaluateWindow({ windowStartMs: 50_000, count: 3 }, 1_000, rule);
    expect(d.allowed).toBe(true);
  });
});
