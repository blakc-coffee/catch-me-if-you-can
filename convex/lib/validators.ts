import { v } from "convex/values";

export const roleValidator = v.union(
  v.literal("seeker"),
  v.literal("hider"),
  v.literal("surveillance"),
  v.literal("admin"),
);

export const playerStatusValidator = v.union(
  v.literal("active"),
  v.literal("eliminated"),
  v.literal("suspended"),
);

export const gameStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("ended"),
);

export const teamTypeValidator = v.union(v.literal("seeker"), v.literal("hider"));

export const profileValidator = v.object({
  uid: v.string(),
  playerId: v.string(),
  name: v.string(),
  email: v.union(v.string(), v.null()),
  role: roleValidator,
  teamId: v.union(v.string(), v.null()),
  status: playerStatusValidator,
  score: v.number(),
  eliminationTokens: v.number(),
});

export const teamValidator = v.object({
  teamId: v.string(),
  name: v.string(),
  type: teamTypeValidator,
  score: v.number(),
  tokens: v.number(),
  artifactsClaimed: v.number(),
  puzzlesSolved: v.number(),
});

export const missionPuzzleValidator = v.object({
  puzzleId: v.string(),
  title: v.string(),
  question: v.string(),
  unlockedAtMs: v.union(v.number(), v.null()),
  solved: v.boolean(),
  solvedByYourTeam: v.boolean(),
});

export const gameStateSnapshotValidator = v.object({
  status: gameStatusValidator,
  eventId: v.string(),
  telemetryMinIntervalSec: v.number(),
});

export const seekerTelemetryValidator = v.object({
  id: v.string(),
  uid: v.string(),
  playerId: v.string(),
  name: v.string(),
  teamId: v.string(),
  active: v.boolean(),
  status: v.string(),
  lat: v.optional(v.number()),
  lon: v.optional(v.number()),
  x: v.number(),
  y: v.number(),
  zoneId: v.string(),
  zoneName: v.string(),
  battery: v.number(),
  signal: v.string(),
  speedKmh: v.number(),
  headingDeg: v.union(v.number(), v.null()),
  accuracyM: v.optional(v.number()),
  qrScannedCount: v.number(),
  lastPing: v.number(),
});
