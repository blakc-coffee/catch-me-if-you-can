import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { LIMITS, RATE_LIMITS } from "../config.js";
import { loadActor, loadGame, read, refs, requireGameActive, requirePlayer, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { projectToCampus } from "../lib/geo.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { accuracyM, epochMs, headingDeg, latitude, longitude, parseInput, speedMps } from "../lib/validation.js";
import type { SeekerDoc } from "../models.js";
import type { StopTrackingResponse, UpdateTelemetryResponse } from "../shared/contract.js";

const schema = z.strictObject({
  lat: latitude,
  lon: longitude,
  accuracyM,
  speedMps: speedMps.optional(),
  headingDeg: headingDeg.optional(),
  battery: z.number().int().min(0).max(100).optional(),
  signal: z.enum(["STRONG", "GOOD", "WEAK"]).optional(),
  clientTs: epochMs,
});

/** Speed above which a seeker is shown as in_transit (km/h). */
const TRANSIT_KMH = 4;

/**
 * Updates seekers/{uid} — the single "latest position" document — at most once
 * per game.telemetryMinIntervalSec. Zone and map coordinates are derived on
 * the server. History goes through uploadLocationBatch instead.
 */
export async function updateTelemetry(ctx: CallContext, raw: unknown): Promise<UpdateTelemetryResponse> {
  const input = parseInput(schema, raw);
  const nowMs = Date.now();
  if (input.clientTs > nowMs + LIMITS.clockSkewFutureMs || input.clientTs < nowMs - LIMITS.telemetryMaxAgeMs) {
    fail("invalid-argument", "TELEMETRY_CLOCK_SKEW", "Fix time is too far from server time; upload it as a batch.");
  }

  const d = db();
  const game = requireGameActive(await loadGame(d, d));
  // Fail fast on eligibility before throttling, so a client that was eliminated
  // or moved off the seeker side gets a terminal reason instead of RATE_LIMITED.
  requirePlayer(await loadActor(d, d, ctx.uid), ["seeker"]);

  const { nextAllowedAtMs } = await consumeRateLimit(
    d,
    `telemetry_${ctx.uid}`,
    { limit: 1, windowMs: game.telemetryMinIntervalSec * 1000 },
    nowMs,
  );

  const p = projectToCampus(input.lat, input.lon);
  const speedKmh = input.speedMps === undefined ? null : Math.round(input.speedMps * 36) / 10;

  await d.runTransaction(async (tx) => {
    requireGameActive(await loadGame(d, tx));
    const user = requirePlayer(await loadActor(d, tx, ctx.uid), ["seeker"]);
    const now = FieldValue.serverTimestamp();
    tx.set(
      refs.seeker(d, ctx.uid),
      {
        uid: ctx.uid,
        teamId: user.teamId,
        playerId: user.playerId,
        name: user.name,
        active: true,
        trackingEnabled: true,
        status: speedKmh !== null && speedKmh >= TRANSIT_KMH ? "in_transit" : "active",
        zoneId: p.zoneId,
        zoneName: p.zoneName,
        x: p.x,
        y: p.y,
        lat: input.lat,
        lon: input.lon,
        accuracyM: input.accuracyM,
        speedKmh,
        headingDeg: input.headingDeg ?? null,
        battery: input.battery ?? null,
        signal: input.signal ?? null,
        clientTs: input.clientTs,
        lastPing: now,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return { acceptedAtMs: nowMs, nextAllowedAtMs, zoneId: p.zoneId, zoneName: p.zoneName, inBounds: p.inBounds };
}

/** Stops live tracking: hides the seeker from surveillance until the next accepted update. Idempotent. */
export async function stopTracking(ctx: CallContext, raw: unknown): Promise<StopTrackingResponse> {
  parseInput(z.strictObject({}), raw ?? {});
  const d = db();
  await consumeRateLimit(d, `tracking_${ctx.uid}`, RATE_LIMITS.trackingState);
  await d.runTransaction(async (tx) => {
    const seeker = await read<SeekerDoc>(tx, refs.seeker(d, ctx.uid));
    if (!seeker) return;
    const eliminated = seeker.status === "eliminated";
    tx.update(refs.seeker(d, ctx.uid), {
      active: false,
      trackingEnabled: false,
      status: eliminated ? "eliminated" : "offline",
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { trackingEnabled: false };
}
