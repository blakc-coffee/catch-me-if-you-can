import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(
  v.literal("seeker"),
  v.literal("hider"),
  v.literal("surveillance"),
  v.literal("admin"),
);

const playerStatus = v.union(
  v.literal("active"),
  v.literal("eliminated"),
  v.literal("suspended"),
);

const gameStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("ended"),
);

const teamType = v.union(v.literal("seeker"), v.literal("hider"));

const seekerStatus = v.union(
  v.literal("active"),
  v.literal("in_transit"),
  v.literal("offline"),
  v.literal("eliminated"),
);

const signal = v.union(v.literal("STRONG"), v.literal("GOOD"), v.literal("WEAK"));

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    firebaseUid: v.string(),
    name: v.string(),
    email: v.union(v.string(), v.null()),
    role,
    teamExternalId: v.union(v.string(), v.null()),
    playerId: v.string(),
    status: playerStatus,
    score: v.number(),
    eliminationTokens: v.number(),
    artifactsClaimed: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_firebase_uid", ["firebaseUid"])
    .index("by_team", ["teamExternalId"]),

  teams: defineTable({
    externalId: v.string(),
    name: v.string(),
    type: teamType,
    score: v.number(),
    tokens: v.number(),
    artifactsClaimed: v.number(),
    puzzlesSolved: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_external_id", ["externalId"]),

  gameState: defineTable({
    key: v.literal("state"),
    status: gameStatus,
    eventId: v.string(),
    telemetryMinIntervalSec: v.number(),
    broadcastCooldownSec: v.number(),
    staleAfterSec: v.number(),
    locationRetentionDays: v.number(),
    lastBroadcastAtMs: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  seekers: defineTable({
    firebaseUid: v.string(),
    teamExternalId: v.string(),
    playerId: v.string(),
    name: v.string(),
    active: v.boolean(),
    status: seekerStatus,
    zoneId: v.union(v.string(), v.null()),
    zoneName: v.union(v.string(), v.null()),
    x: v.union(v.number(), v.null()),
    y: v.union(v.number(), v.null()),
    lat: v.union(v.number(), v.null()),
    lon: v.union(v.number(), v.null()),
    accuracyM: v.union(v.number(), v.null()),
    speedKmh: v.union(v.number(), v.null()),
    headingDeg: v.union(v.number(), v.null()),
    battery: v.union(v.number(), v.null()),
    signal: v.union(signal, v.null()),
    trackingEnabled: v.boolean(),
    qrScannedCount: v.optional(v.number()),
    clientTs: v.union(v.number(), v.null()),
    fixServerMs: v.union(v.number(), v.null()),
    lastPingMs: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_firebase_uid", ["firebaseUid"])
    .index("by_team", ["teamExternalId"])
    .index("by_active", ["active"]),

  locationBatches: defineTable({
    firebaseUid: v.string(),
    teamExternalId: v.union(v.string(), v.null()),
    batchId: v.string(),
    contentHash: v.optional(v.string()),
    count: v.number(),
    firstSampleAtMs: v.optional(v.number()),
    lastSampleAtMs: v.optional(v.number()),
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
    receivedAtMs: v.number(),
    expireAtMs: v.optional(v.number()),
  })
    .index("by_firebase_uid", ["firebaseUid"])
    .index("by_batch", ["firebaseUid", "batchId"]),

  artifacts: defineTable({
    qrCode: v.string(),
    qrType: v.union(v.literal("correct"), v.literal("wrong")),
    name: v.string(),
    description: v.string(),
    areaExternalId: v.union(v.string(), v.null()),
    puzzleExternalId: v.union(v.string(), v.null()),
    redirectUrl: v.union(v.string(), v.null()),
    isActive: v.boolean(),
    points: v.optional(v.number()),
    claimKey: v.optional(v.string()),
    replacedBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_qr_code", ["qrCode"])
    .index("by_active", ["isActive"]),

  puzzles: defineTable({
    externalId: v.string(),
    title: v.string(),
    question: v.string(),
    answer: v.string(),
    points: v.number(),
    tokensAwarded: v.number(),
    hints: v.optional(v.array(v.string())),
    audience: v.optional(v.array(role)),
    createdAt: v.number(),
  }).index("by_external_id", ["externalId"]),

  puzzlePublic: defineTable({
    externalId: v.string(),
    title: v.string(),
    question: v.string(),
    hints: v.array(v.string()),
    audience: v.array(role),
    points: v.number(),
    tokensAwarded: v.number(),
    isSolved: v.boolean(),
    solvedBy: v.union(
      v.object({
        firebaseUid: v.string(),
        playerId: v.string(),
        name: v.string(),
        teamExternalId: v.string(),
        teamName: v.string(),
      }),
      v.null(),
    ),
    solvedAtMs: v.union(v.number(), v.null()),
  }).index("by_external_id", ["externalId"]),

  artifactClaims: defineTable({
    claimKey: v.string(),
    teamExternalId: v.string(),
    artifactQrCode: v.string(),
    puzzleExternalId: v.union(v.string(), v.null()),
    claimedByFirebaseUid: v.string(),
    playerId: v.string(),
    points: v.number(),
    claimedAtMs: v.number(),
  })
    .index("by_claim_key", ["claimKey"])
    .index("by_team", ["teamExternalId"]),

  puzzleUnlocks: defineTable({
    unlockKey: v.string(),
    teamExternalId: v.string(),
    puzzleExternalId: v.string(),
    artifactQrCode: v.string(),
    unlockedAtMs: v.number(),
  })
    .index("by_unlock_key", ["unlockKey"])
    .index("by_team", ["teamExternalId"]),

  puzzleClaims: defineTable({
    puzzleExternalId: v.string(),
    firebaseUid: v.string(),
    playerId: v.string(),
    name: v.string(),
    teamExternalId: v.string(),
    teamName: v.string(),
    points: v.number(),
    tokensAwarded: v.number(),
    claimedAtMs: v.number(),
  }).index("by_puzzle", ["puzzleExternalId"]),

  broadcasts: defineTable({
    serverEpochMs: v.number(),
    operatorFirebaseUid: v.string(),
    operator: v.string(),
    totalActiveSeekers: v.number(),
    seekerPositions: v.array(
      v.object({
        playerId: v.string(),
        name: v.string(),
        teamExternalId: v.string(),
        zoneId: v.union(v.string(), v.null()),
        zoneName: v.union(v.string(), v.null()),
        x: v.number(),
        y: v.number(),
        lastPingMs: v.number(),
      }),
    ),
    createdAtMs: v.number(),
  }).index("by_created", ["createdAtMs"]),

  teamJoinCodes: defineTable({
    codeHash: v.string(),
    teamExternalId: v.string(),
    active: v.boolean(),
  }).index("by_hash", ["codeHash"]),

  rateLimits: defineTable({
    key: v.string(),
    windowStartMs: v.number(),
    count: v.number(),
    expireAtMs: v.number(),
  }).index("by_key", ["key"]),
});
