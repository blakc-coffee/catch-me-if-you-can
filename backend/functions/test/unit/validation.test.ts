import { HttpsError } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";
import { createOrSyncProfile } from "../../src/auth/profile.js";
import { submitPuzzleAnswer } from "../../src/puzzles/submitPuzzleAnswer.js";
import { canonicalJson } from "../../src/lib/crypto.js";
import type { CallContext } from "../../src/lib/context.js";
import { joinTeam } from "../../src/teams/joinTeam.js";
import { batchContentHash, uploadLocationBatch } from "../../src/telemetry/locationBatches.js";
import { updateTelemetry } from "../../src/telemetry/updateTelemetry.js";

// Validation runs before any Firestore access, so these need no emulator.
const ctx: CallContext = { uid: "u1", email: "u1@test.dev", emailVerified: true, signInProvider: "password" };

async function reason(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpsError);
    const err = e as HttpsError;
    return { code: err.code, ...(err.details as { reason: string; issues?: unknown[] }) };
  }
  throw new Error("expected rejection");
}

const now = Date.now();
const goodFix = { lat: 9.7549, lon: 76.65, accuracyM: 8, clientTs: now };

describe("input validation", () => {
  it("rejects unknown keys (clients cannot smuggle role/score)", async () => {
    await expect(reason(createOrSyncProfile(ctx, { name: "Echo", role: "admin" }))).resolves.toMatchObject({
      code: "invalid-argument",
      reason: "INVALID_ARGUMENT",
    });
    await expect(reason(updateTelemetry(ctx, { ...goodFix, score: 999 }))).resolves.toMatchObject({ reason: "INVALID_ARGUMENT" });
  });

  it("rejects anonymous accounts", async () => {
    await expect(reason(createOrSyncProfile({ ...ctx, signInProvider: "anonymous" }, {}))).resolves.toMatchObject({
      reason: "ANONYMOUS_NOT_ALLOWED",
    });
  });

  it.each([
    ["lat out of range", { lat: 91 }],
    ["lon not a number", { lon: "76.6" }],
    ["negative accuracy", { accuracyM: -1 }],
    ["impossible speed", { speedMps: 250 }],
    ["battery > 100", { battery: 101 }],
    ["heading 360", { headingDeg: 360 }],
    ["bad signal", { signal: "EXCELLENT" }],
    ["NaN-like", { lat: Number.NaN }],
    ["unexpected missionId", { missionId: "iiitk-dev" }],
  ])("telemetry: %s", async (_label, patch) => {
    await expect(reason(updateTelemetry(ctx, { ...goodFix, ...patch }))).resolves.toMatchObject({ reason: "INVALID_ARGUMENT" });
  });

  it("reports issue paths without echoing values", async () => {
    const r = await reason(updateTelemetry(ctx, { ...goodFix, lat: 1234.5678 }));
    expect(JSON.stringify(r.issues)).toContain('"path":"lat"');
    expect(JSON.stringify(r.issues)).not.toContain("1234.5678");
  });

  it("rejects stale, future, inaccurate and off-campus live fixes before any Firestore access", async () => {
    await expect(reason(updateTelemetry(ctx, { ...goodFix, clientTs: Date.now() - 2 * 60_000 }))).resolves.toMatchObject({
      reason: "TELEMETRY_STALE_FIX",
    });
    await expect(reason(updateTelemetry(ctx, { ...goodFix, clientTs: Date.now() + 60 * 60_000 }))).resolves.toMatchObject({
      reason: "TELEMETRY_FUTURE_FIX",
    });
    await expect(reason(updateTelemetry(ctx, { ...goodFix, clientTs: Date.now(), accuracyM: 51 }))).resolves.toMatchObject({
      reason: "TELEMETRY_LOW_ACCURACY",
    });
    await expect(reason(updateTelemetry(ctx, { ...goodFix, clientTs: Date.now(), lat: 10.0 }))).resolves.toMatchObject({
      reason: "TELEMETRY_OUT_OF_BOUNDS",
    });
  });

  it("rejects oversized payloads before parsing", async () => {
    await expect(reason(joinTeam(ctx, { joinCode: "x".repeat(10_000) }))).resolves.toMatchObject({
      reason: "PAYLOAD_TOO_LARGE",
    });
    await expect(reason(submitPuzzleAnswer(ctx, { puzzleId: "ch-01", answer: "a".repeat(257) }))).resolves.toMatchObject({
      reason: "INVALID_ARGUMENT",
    });
  });

  it("caps location batches at 500 samples and 128 KiB", async () => {
    const sample = { t: now, lat: 9.75, lon: 76.65, acc: 5 };
    await expect(
      reason(uploadLocationBatch(ctx, { batchId: "b_0123456789abcdef", samples: Array(501).fill(sample) })),
    ).resolves.toMatchObject({ reason: "INVALID_ARGUMENT" });
    const fat = { ...sample, lat: 9.123456789012345, lon: 76.12345678901234, acc: 5.123456789012345, spd: 1.123456789012345, hdg: 1.123456789012345 };
    await expect(
      reason(uploadLocationBatch(ctx, { batchId: "b_0123456789abcdef", samples: Array(1500).fill(fat) })),
    ).resolves.toMatchObject({ reason: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects batch ids that are not idempotency-key shaped", async () => {
    const samples = [{ t: now, lat: 9.75, lon: 76.65, acc: 5 }];
    for (const batchId of ["short", "has space in it here", "../../etc/passwd-xx", "a/b/c/d/e/f/g/h/i/j"]) {
      await expect(reason(uploadLocationBatch(ctx, { batchId, samples }))).resolves.toMatchObject({
        reason: "INVALID_ARGUMENT",
      });
    }
  });

  it("rejects samples outside the accepted time window", async () => {
    const old = { t: now - 8 * 24 * 60 * 60_000, lat: 9.75, lon: 76.65, acc: 5 };
    await expect(
      reason(uploadLocationBatch(ctx, { batchId: "b_0123456789abcdef", samples: [old] })),
    ).resolves.toMatchObject({ reason: "SAMPLE_OUT_OF_RANGE", index: 0 });
  });
});

describe("batch content hash", () => {
  const a = { t: 1, lat: 1, lon: 2, acc: 3 };
  const b = { t: 2, lat: 1.5, lon: 2.5, acc: 3, spd: 1 };

  it("is independent of sample order and key order", () => {
    const reordered = { acc: 3, lon: 2, t: 1, lat: 1 };
    expect(batchContentHash([a, b])).toBe(batchContentHash([b, reordered]));
  });

  it("changes with content", () => {
    expect(batchContentHash([a, b])).not.toBe(batchContentHash([a]));
    expect(batchContentHash([a])).not.toBe(batchContentHash([{ ...a, lat: 1.0001 }]));
  });

  it("canonicalJson drops undefined fields", () => {
    expect(canonicalJson({ b: 1, a: undefined, c: [1, { z: 1, y: 2 }] })).toBe('{"b":1,"c":[1,{"y":2,"z":1}]}');
  });
});
