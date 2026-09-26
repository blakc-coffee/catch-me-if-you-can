import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { lastPingMs } from "../../src/lib/lastPing.js";

describe("lastPingMs", () => {
  it("reads numeric epoch ms from direct Firestore writes", () => {
    expect(lastPingMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("reads Firestore Timestamp from callable writes", () => {
    expect(lastPingMs(Timestamp.fromMillis(1_700_000_000_000))).toBe(1_700_000_000_000);
  });

  it("returns 0 for missing values", () => {
    expect(lastPingMs(null)).toBe(0);
    expect(lastPingMs(undefined)).toBe(0);
  });
});
