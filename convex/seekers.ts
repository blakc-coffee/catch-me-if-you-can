import { v } from "convex/values";
import { query } from "./_generated/server";
import { seekerTelemetryValidator } from "./lib/validators";

function mapSeekerStatus(status: string): string {
  if (status === "in_transit") return "IN_TRANSIT";
  if (status === "offline") return "OFFLINE";
  if (status === "eliminated") return "ELIMINATED";
  return "ACTIVE";
}

export const listActiveSeekers = query({
  args: {},
  returns: v.array(seekerTelemetryValidator),
  handler: async (ctx) => {
    const seekers = await ctx.db.query("seekers").collect();
    return seekers
      .map((s) => ({
        id: s.firebaseUid,
        uid: s.firebaseUid,
        playerId: s.playerId,
        name: s.name,
        teamId: s.teamExternalId,
        active: s.active,
        status: mapSeekerStatus(s.status),
        lat: s.lat ?? undefined,
        lon: s.lon ?? undefined,
        x: s.x ?? 500,
        y: s.y ?? 375,
        zoneId: s.zoneId ?? "unknown",
        zoneName: s.zoneName ?? "In Transit",
        battery: s.battery ?? 100,
        signal: s.signal ?? "STRONG",
        speedKmh: s.speedKmh ?? 0,
        headingDeg: s.headingDeg ?? null,
        accuracyM: s.accuracyM ?? undefined,
        qrScannedCount: s.qrScannedCount ?? 0,
        lastPing: s.lastPingMs ?? s.updatedAt,
      }))
      .sort((a, b) => (b.lastPing ?? 0) - (a.lastPing ?? 0));
  },
});

export const getSeekerByFirebaseUid = query({
  args: { firebaseUid: v.string() },
  returns: v.union(seekerTelemetryValidator, v.null()),
  handler: async (ctx, args) => {
    const s = await ctx.db
      .query("seekers")
      .withIndex("by_firebase_uid", (q) => q.eq("firebaseUid", args.firebaseUid))
      .unique();
    if (!s) return null;
    return {
      id: s.firebaseUid,
      uid: s.firebaseUid,
      playerId: s.playerId,
      name: s.name,
      teamId: s.teamExternalId,
      active: s.active,
      status: mapSeekerStatus(s.status),
      lat: s.lat ?? undefined,
      lon: s.lon ?? undefined,
      x: s.x ?? 500,
      y: s.y ?? 375,
      zoneId: s.zoneId ?? "unknown",
      zoneName: s.zoneName ?? "In Transit",
      battery: s.battery ?? 100,
      signal: s.signal ?? "STRONG",
      speedKmh: s.speedKmh ?? 0,
      headingDeg: s.headingDeg ?? null,
      accuracyM: s.accuracyM ?? undefined,
      qrScannedCount: s.qrScannedCount ?? 0,
      lastPing: s.lastPingMs ?? s.updatedAt,
    };
  },
});
