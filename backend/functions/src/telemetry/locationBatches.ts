import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { GAME_DEFAULTS, LIMITS, RATE_LIMITS } from "../config.js";
import { loadActor, loadGame, refs, requireRole, type CallContext } from "../lib/context.js";
import { canonicalJson, sha256Hex } from "../lib/crypto.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { accuracyM, epochMs, headingDeg, latitude, longitude, parseInput, speedMps } from "../lib/validation.js";
import { COL, type LocationBatchDoc, type LocationSample } from "../models.js";
import type { DeleteLocationHistoryResponse, UploadLocationBatchResponse } from "../shared/contract.js";

const sampleSchema = z.strictObject({
  t: epochMs,
  lat: latitude,
  lon: longitude,
  acc: accuracyM,
  spd: speedMps.optional(),
  hdg: headingDeg.optional(),
});

export const BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const schema = z.strictObject({
  batchId: z.string().regex(BATCH_ID_PATTERN, "16-128 chars of A-Z a-z 0-9 _ -"),
  samples: z.array(sampleSchema).min(1).max(LIMITS.locationBatchMaxSamples),
});

/** Order- and key-order-independent fingerprint of a batch, used for idempotency. */
export function batchContentHash(samples: readonly LocationSample[]): string {
  const sorted = [...samples].sort((a, b) => a.t - b.t || a.lat - b.lat || a.lon - b.lon);
  return sha256Hex(canonicalJson(sorted));
}

/**
 * Stores a batch of queued GPS samples under seekers/{uid}/locationBatches.
 * The client-chosen batchId is the idempotency key: resending the same batch
 * returns DUPLICATE (safe to delete locally); reusing an id for different
 * samples fails with BATCH_ID_CONFLICT. Batches expire via a TTL policy.
 * Seekers may upload after elimination or game end so queued history is kept.
 */
export async function uploadLocationBatch(ctx: CallContext, raw: unknown): Promise<UploadLocationBatchResponse> {
  const input = parseInput(schema, raw, LIMITS.locationBatchPayloadBytes);
  const nowMs = Date.now();
  input.samples.forEach((s, index) => {
    if (s.t > nowMs + LIMITS.clockSkewFutureMs || s.t < nowMs - LIMITS.sampleMaxAgeMs) {
      fail("invalid-argument", "SAMPLE_OUT_OF_RANGE", "Sample time is outside the accepted window.", { index });
    }
  });

  const d = db();
  const user = await loadActor(d, d, ctx.uid);
  requireRole(user.role, ["seeker"]);
  const game = await loadGame(d, d);
  await consumeRateLimit(d, `batch_${ctx.uid}`, RATE_LIMITS.locationBatch, nowMs);

  const samples: LocationSample[] = input.samples.map((s) => ({
    t: s.t,
    lat: s.lat,
    lon: s.lon,
    acc: s.acc,
    ...(s.spd === undefined ? {} : { spd: s.spd }),
    ...(s.hdg === undefined ? {} : { hdg: s.hdg }),
  }));
  const contentHash = batchContentHash(samples);
  const times = samples.map((s) => s.t);
  const retentionDays = game?.locationRetentionDays ?? GAME_DEFAULTS.locationRetentionDays;
  const ref = refs.seeker(d, ctx.uid).collection(COL.locationBatches).doc(input.batchId);

  const status = await d.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      if (snap.get("contentHash") === contentHash) return "DUPLICATE" as const;
      fail("already-exists", "BATCH_ID_CONFLICT", "batchId was already used for different samples.");
    }
    const doc: Omit<LocationBatchDoc, "receivedAt"> & { receivedAt: FieldValue } = {
      uid: ctx.uid,
      teamId: user.teamId,
      batchId: input.batchId,
      contentHash,
      count: samples.length,
      firstSampleAt: Timestamp.fromMillis(Math.min(...times)),
      lastSampleAt: Timestamp.fromMillis(Math.max(...times)),
      samples,
      receivedAt: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(nowMs + retentionDays * 24 * 60 * 60 * 1000),
    };
    tx.create(ref, doc);
    return "STORED" as const;
  });

  return { batchId: input.batchId, status, count: samples.length };
}

/** Lets a player erase all of their uploaded location history. */
export async function deleteLocationHistory(ctx: CallContext, raw: unknown): Promise<DeleteLocationHistoryResponse> {
  parseInput(z.strictObject({}), raw ?? {});
  const d = db();
  await consumeRateLimit(d, `delhist_${ctx.uid}`, RATE_LIMITS.deleteHistory);
  const col = refs.seeker(d, ctx.uid).collection(COL.locationBatches);
  const deleted = (await col.count().get()).data().count;
  await d.recursiveDelete(col);
  return { deleted };
}
