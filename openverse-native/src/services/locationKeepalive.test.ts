import { describe, expect, it } from "vitest";
import { LOCATION_SAMPLE_STALE_MS, watcherNeedsRestart } from "./locationKeepalive";

describe("watcherNeedsRestart", () => {
  const nowMs = 1_000_000;

  it("restarts when the permission dialog left no subscription", () => {
    expect(watcherNeedsRestart({ hasSubscription: false, lastSampleAtMs: nowMs, nowMs })).toBe(true);
  });

  it("keeps a watcher that is still delivering fixes", () => {
    expect(watcherNeedsRestart({ hasSubscription: true, lastSampleAtMs: nowMs - 5_000, nowMs })).toBe(false);
  });

  it("restarts after the watcher goes silent", () => {
    expect(watcherNeedsRestart({ hasSubscription: true, lastSampleAtMs: nowMs - LOCATION_SAMPLE_STALE_MS - 1, nowMs })).toBe(true);
  });
});
