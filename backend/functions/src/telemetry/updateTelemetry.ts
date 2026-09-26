import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { RATE_LIMITS } from "../config.js";
import { loadActor, loadGame, loadTeam, read, refs, requireGameActive, requirePlayer, type CallContext } from "../lib/context.js";
import { fail } from "../lib/errors.js";
import { db } from "../lib/firebase.js";
import { projectToCampus } from "../lib/geo.js";
import { consumeRateLimit } from "../lib/rateLimit.js";
import { accuracyM, epochMs, headingDeg, latitude, longitude, parseInput, speedMps } from "../lib/validation.js";
import type { SeekerDoc } from "../models.js";
import type { StopTrackingResponse, UpdateTelemetryResponse } from "../shared/contract.js";
import { checkFix, checkMovement, type AcceptedFix, type FixRejection } from "./plausibility.js";

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

function rejectFix(reason: FixRejection): never {
  fail("failed-precondition", reason, "Fix rejected; send a newer fix.");
}

function acceptedFix(seeker: SeekerDoc | undefined): AcceptedFix | null {
  if (!seeker || seeker.lat == null || seeker.lon == null || seeker.clientTs == null) return null;
  const serverMs = seeker.fixServerMs ?? (typeof seeker.lastPing === "number" ? seeker.lastPing : seeker.lastPing?.toMillis());
  if (serverMs == null) return null;
  return { lat: seeker.lat, lon: seeker.lon, accuracyM: seeker.accuracyM ?? 0, clientTs: seeker.clientTs, serverMs };
}

/**
 * Updates seekers/{uid} — the single "latest position" document — at most once
 * per game.telemetryMinIntervalSec. Zone and map coordinates are derived on
 * the server. History goes through uploadLocationBatch instead.
 *
 * A fix is rejected (see TELEMETRY_FIX_REJECTIONS) when it is stale or
 * future-dated, too inaccurate, off campus, not newer than the last accepted
 * fix, or implies faster movement than a person can manage. Game state, role,
 * elimination and the previous fix are all read inside the write transaction.
 * The first fix has no baseline and passes on the stateless checks alone.
 * These checks make spoofing harder; they cannot prove a device's position.
 */
export async function updateTelemetry(ctx: CallContext, raw: unknown): Promise<UpdateTelemetryResponse> {
  const input = parseInput(schema, raw);
  const nowMs = Date.now();
  const stateless = checkFix(input, nowMs);
  if (stateless) rejectFix(stateless);

  const d = db();
  const game = requireGameActive(await loadGame(d, d));
  // Fail fast on eligibility before throttling, so a client that was eliminated
  // or moved off the seeker side gets a terminal reason instead of RATE_LIMITED.
  requirePlayer(await loadActor(d, d, ctx.uid), ["seeker"]);
  // Reject implausible or out-of-order fixes before charging the rate limit,
  // so the next, valid fix is not throttled. Re-checked in the transaction.
  const early = checkMovement(acceptedFix(await read<SeekerDoc>(d, refs.seeker(d, ctx.uid))), input, nowMs);
  if (early) rejectFix(early);

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
    const team = await loadTeam(d, tx, user.teamId);
    const seeker = await read<SeekerDoc>(tx, refs.seeker(d, ctx.uid));
    const movement = checkMovement(acceptedFix(seeker), input, nowMs);
    if (movement) rejectFix(movement);

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
        status: speedKmh !== null && speedKmh >= TRANSIT_KMH ? "IN_TRANSIT" : "ACTIVE",
        zoneId: p.zoneId,
        zoneName: p.zoneName,
        x: p.x,
        y: p.y,
        lat: input.lat,
        lon: input.lon,
        accuracyM: input.accuracyM,
        speedKmh: speedKmh ?? 0,
        headingDeg: input.headingDeg ?? null,
        battery: input.battery ?? 100,
        signal: input.signal ?? "STRONG",
        qrScannedCount: team.artifactsClaimed ?? 0,
        clientTs: input.clientTs,
        fixServerMs: nowMs,
        lastPing: nowMs,
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
