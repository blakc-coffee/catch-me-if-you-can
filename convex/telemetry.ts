import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";
import { fail } from "./lib/errors";
import { projectToCampus } from "./lib/geo";
import { ensureGameState } from "./lib/gameDefaults";

const TRANSIT_KMH = 4;
const MIN_INTERVAL_MS = 4000;

export const updateTelemetry = mutation({
  args: {
    lat: v.number(),
    lon: v.number(),
    accuracyM: v.number(),
    speedMps: v.optional(v.number()),
    headingDeg: v.optional(v.number()),
    battery: v.optional(v.number()),
    signal: v.optional(v.union(v.literal("STRONG"), v.literal("GOOD"), v.literal("WEAK"))),
    clientTs: v.number(),
  },
  returns: v.object({
    acceptedAtMs: v.number(),
    nextAllowedAtMs: v.number(),
    zoneId: v.union(v.string(), v.null()),
    zoneName: v.union(v.string(), v.null()),
    inBounds: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (user.role !== "seeker") fail("ROLE_NOT_ALLOWED", "Only seekers can send telemetry.");
    if (user.status !== "active") fail("PLAYER_ELIMINATED", "Player is not active.");
    if (!user.teamExternalId) fail("NO_TEAM", "You are not on a team yet.");

    const game = await ensureGameState(ctx);
    if (game.status === "ended") fail("GAME_ENDED", "Game has ended.");
    if (game.status !== "active") fail("GAME_NOT_ACTIVE", "Game is not active.");

    const projection = projectToCampus(args.lat, args.lon);
    if (!projection.inBounds) fail("TELEMETRY_OUT_OF_BOUNDS", "Fix is out of campus bounds.");
    if (args.accuracyM > 100) fail("TELEMETRY_LOW_ACCURACY", "Fix accuracy is too low.");

    const nowMs = Date.now();
    const speedKmh =
      args.speedMps === undefined ? 0 : Math.round(args.speedMps * 3.6 * 10) / 10;

    const team = await ctx.db
      .query("teams")
      .withIndex("by_external_id", (q) => q.eq("externalId", user.teamExternalId!))
      .unique();

    const existingSeeker = await ctx.db
      .query("seekers")
      .withIndex("by_firebase_uid", (q) => q.eq("firebaseUid", user.firebaseUid))
      .unique();

    const seekerStatus =
      speedKmh >= TRANSIT_KMH ? ("in_transit" as const) : ("active" as const);

    const seekerDoc = {
      firebaseUid: user.firebaseUid,
      teamExternalId: user.teamExternalId,
      playerId: user.playerId,
      name: user.name,
      active: true,
      status: seekerStatus,
      zoneId: projection.zoneId,
      zoneName: projection.zoneName,
      x: projection.x,
      y: projection.y,
      lat: args.lat,
      lon: args.lon,
      accuracyM: args.accuracyM,
      speedKmh,
      headingDeg: args.headingDeg ?? null,
      battery: args.battery ?? 100,
      signal: args.signal ?? "STRONG",
      trackingEnabled: true,
      qrScannedCount: team?.artifactsClaimed ?? user.artifactsClaimed ?? 0,
      clientTs: args.clientTs,
      fixServerMs: nowMs,
      lastPingMs: nowMs,
      updatedAt: nowMs,
    };

    if (existingSeeker) {
      await ctx.db.patch("seekers", existingSeeker._id, seekerDoc);
    } else {
      await ctx.db.insert("seekers", seekerDoc);
    }

    const intervalMs = Math.max(game.telemetryMinIntervalSec * 1000, MIN_INTERVAL_MS);
    return {
      acceptedAtMs: nowMs,
      nextAllowedAtMs: nowMs + intervalMs,
      zoneId: projection.zoneId,
      zoneName: projection.zoneName,
      inBounds: projection.inBounds,
    };
  },
});

export const stopTracking = mutation({
  args: {},
  returns: v.object({ trackingEnabled: v.literal(false) }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const seeker = await ctx.db
      .query("seekers")
      .withIndex("by_firebase_uid", (q) => q.eq("firebaseUid", user.firebaseUid))
      .unique();

    if (seeker) {
      const status = seeker.status === "eliminated" ? ("eliminated" as const) : ("offline" as const);
      await ctx.db.patch("seekers", seeker._id, {
        active: false,
        trackingEnabled: false,
        status,
        updatedAt: Date.now(),
      });
    }

    return { trackingEnabled: false as const };
  },
});

export const uploadLocationBatch = mutation({
  args: {
    batchId: v.string(),
    samples: v.array(
      v.object({
        t: v.number(),
        lat: v.number(),
        lon: v.number(),
        acc: v.number(),
        spd: v.optional(v.number()),
        hdg: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({
    batchId: v.string(),
    status: v.union(v.literal("STORED"), v.literal("DUPLICATE")),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (args.samples.length === 0) fail("INVALID_ARGUMENT", "Batch must contain samples.");

    const existing = await ctx.db
      .query("locationBatches")
      .withIndex("by_batch", (q) =>
        q.eq("firebaseUid", user.firebaseUid).eq("batchId", args.batchId),
      )
      .unique();

    if (existing) {
      return { batchId: args.batchId, status: "DUPLICATE" as const, count: existing.count };
    }

    const nowMs = Date.now();
    const first = args.samples[0]?.t ?? nowMs;
    const last = args.samples[args.samples.length - 1]?.t ?? nowMs;

    await ctx.db.insert("locationBatches", {
      firebaseUid: user.firebaseUid,
      teamExternalId: user.teamExternalId,
      batchId: args.batchId,
      count: args.samples.length,
      firstSampleAtMs: first,
      lastSampleAtMs: last,
      samples: args.samples,
      receivedAtMs: nowMs,
      expireAtMs: nowMs + 7 * 24 * 60 * 60 * 1000,
    });

    return { batchId: args.batchId, status: "STORED" as const, count: args.samples.length };
  },
});

export const deleteLocationHistory = mutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const batches = await ctx.db
      .query("locationBatches")
      .withIndex("by_firebase_uid", (q) => q.eq("firebaseUid", user.firebaseUid))
      .collect();

    for (const batch of batches) {
      await ctx.db.delete("locationBatches", batch._id);
    }

    return { deleted: batches.length };
  },
});
