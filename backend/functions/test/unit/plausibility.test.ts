import { describe, expect, it } from "vitest";
import { TELEMETRY_LIMITS } from "../../src/config.js";
import { haversineMeters } from "../../src/lib/geo.js";
import { checkFix, checkMovement, type AcceptedFix, type Fix } from "../../src/telemetry/plausibility.js";

const NOW = 1_800_000_000_000;
const academic1 = { lat: 9.754904, lon: 76.649988 };
const dining = { lat: 9.755678, lon: 76.650101 };
const sports = { lat: 9.754, lon: 76.649392 };

const fix = (over: Partial<Fix> = {}): Fix => ({ ...academic1, accuracyM: 8, clientTs: NOW, ...over });
const prevAt = (secondsAgo: number, over: Partial<AcceptedFix> = {}): AcceptedFix => ({
  ...academic1,
  accuracyM: 8,
  clientTs: NOW - secondsAgo * 1000,
  serverMs: NOW - secondsAgo * 1000,
  ...over,
});
/** A point `meters` north of academic1 (1° latitude ≈ 111.2 km). */
const north = (meters: number) => ({ lat: academic1.lat + meters / 111_195, lon: academic1.lon });

describe("checkFix (stateless)", () => {
  it("accepts a fresh, accurate on-campus fix", () => {
    expect(checkFix(fix(), NOW)).toBeNull();
    expect(checkFix(fix({ clientTs: NOW - 59_000 }), NOW)).toBeNull();
    expect(checkFix(fix({ clientTs: NOW + 29_000 }), NOW)).toBeNull();
    expect(checkFix(fix({ accuracyM: TELEMETRY_LIMITS.maxAccuracyM }), NOW)).toBeNull();
  });

  it("rejects stale and future fixes", () => {
    expect(checkFix(fix({ clientTs: NOW - TELEMETRY_LIMITS.maxFixAgeMs - 1 }), NOW)).toBe("TELEMETRY_STALE_FIX");
    expect(checkFix(fix({ clientTs: NOW + TELEMETRY_LIMITS.maxFutureSkewMs + 1 }), NOW)).toBe("TELEMETRY_FUTURE_FIX");
  });

  it("rejects unacceptable accuracy", () => {
    expect(checkFix(fix({ accuracyM: TELEMETRY_LIMITS.maxAccuracyM + 0.1 }), NOW)).toBe("TELEMETRY_LOW_ACCURACY");
  });

  it("rejects out-of-campus coordinates instead of clamping them", () => {
    expect(checkFix(fix({ lat: 9.76 }), NOW)).toBe("TELEMETRY_OUT_OF_BOUNDS");
    expect(checkFix(fix({ lon: 76.6 }), NOW)).toBe("TELEMETRY_OUT_OF_BOUNDS");
    expect(checkFix(fix({ lat: 0, lon: 0 }), NOW)).toBe("TELEMETRY_OUT_OF_BOUNDS");
  });
});

describe("checkMovement", () => {
  it("accepts the first fix with no baseline", () => {
    expect(checkMovement(null, fix(sports), NOW)).toBeNull();
  });

  it("accepts ordinary walking and running", () => {
    expect(checkMovement(prevAt(15), fix(north(20)), NOW)).toBeNull(); // 1.3 m/s
    expect(checkMovement(prevAt(30), fix(north(200)), NOW)).toBeNull(); // 6.7 m/s
    expect(checkMovement(prevAt(10), fix(), NOW)).toBeNull(); // standing still
  });

  it("tolerates GPS jitter within the reported accuracy", () => {
    expect(checkMovement(prevAt(1, { accuracyM: 15 }), fix({ ...north(30), accuracyM: 15 }), NOW)).toBeNull();
    expect(checkMovement(prevAt(1, { accuracyM: 15 }), fix({ ...north(60), accuracyM: 15 }), NOW)).toBe("TELEMETRY_IMPLAUSIBLE_MOVEMENT");
  });

  it("rejects impossible jumps", () => {
    expect(haversineMeters(sports.lat, sports.lon, dining.lat, dining.lon)).toBeGreaterThan(200);
    expect(checkMovement(prevAt(10, sports), fix(dining), NOW)).toBe("TELEMETRY_IMPLAUSIBLE_MOVEMENT");
    expect(checkMovement(prevAt(10), fix(north(160)), NOW)).toBe("TELEMETRY_IMPLAUSIBLE_MOVEMENT");
  });

  it("caps the jitter allowance even when the client claims poor accuracy", () => {
    const sloppy = { accuracyM: TELEMETRY_LIMITS.maxAccuracyM };
    expect(checkMovement(prevAt(1, sloppy), fix({ ...north(70), ...sloppy }), NOW)).toBe("TELEMETRY_IMPLAUSIBLE_MOVEMENT");
  });

  it("rejects non-monotonic and repeated timestamps", () => {
    expect(checkMovement(prevAt(5), fix({ clientTs: NOW - 10_000 }), NOW)).toBe("TELEMETRY_NON_MONOTONIC");
    const prev = prevAt(5);
    expect(checkMovement(prev, fix({ clientTs: prev.clientTs }), NOW)).toBe("TELEMETRY_NON_MONOTONIC");
  });

  it("does not let a backdated previous fix buy extra travel distance", () => {
    // Attacker's previous fix claimed to be 55 s old but reached the server 10 s ago.
    const prev = prevAt(10, { clientTs: NOW - 55_000 });
    // 55 s × 10 m/s would allow 550 m; the server-observed 10 s (+5 s grace) allows ~166 m.
    expect(checkMovement(prev, fix(north(300)), NOW)).toBe("TELEMETRY_IMPLAUSIBLE_MOVEMENT");
    expect(checkMovement(prev, fix(north(120)), NOW)).toBeNull();
  });

  it("does not let a future-dated new fix buy extra travel distance", () => {
    expect(checkMovement(prevAt(10), fix({ ...north(300), clientTs: NOW + 29_000 }), NOW)).toBe("TELEMETRY_IMPLAUSIBLE_MOVEMENT");
  });

  it("rejects a teleport chain that stays under the per-hop rate limit", () => {
    // Plausible-looking 10 s hops, each 180 m: every hop exceeds 10 m/s + jitter.
    let prev = prevAt(10);
    for (let hop = 1; hop <= 3; hop++) {
      const next = fix(north(180 * hop));
      expect(checkMovement(prev, next, NOW)).toBe("TELEMETRY_IMPLAUSIBLE_MOVEMENT");
      prev = { ...prev, serverMs: NOW - 10_000 }; // the server never accepted the hop
    }
  });

  it("allows a long gap after tracking resumes", () => {
    expect(checkMovement(prevAt(600, sports), fix(dining), NOW)).toBeNull();
  });
});
