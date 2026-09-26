import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  defaultTeamForEmail,
  getCurrentUser,
  getCurrentUserOrNull,
  makePlayerId,
  requireIdentity,
} from "./lib/auth";
import { ensureGameState, ensureTeam } from "./lib/gameDefaults";
import { profileValidator } from "./lib/validators";

function toProfile(user: {
  firebaseUid: string;
  playerId: string;
  name: string;
  email: string | null;
  role: "seeker" | "hider" | "surveillance" | "admin";
  teamExternalId: string | null;
  status: "active" | "eliminated" | "suspended";
  score: number;
  eliminationTokens: number;
}) {
  return {
    uid: user.firebaseUid,
    playerId: user.playerId,
    name: user.name,
    email: user.email,
    role: user.role,
    teamId: user.teamExternalId,
    status: user.status,
    score: user.score,
    eliminationTokens: user.eliminationTokens,
  };
}

export const createOrSyncProfile = mutation({
  args: {
    name: v.optional(v.string()),
  },
  returns: v.object({
    profile: profileValidator,
    claimsUpdated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const firebaseUid = identity.subject;
    const email = identity.email ?? null;
    const now = Date.now();

    if (identity.tokenIdentifier.includes("anonymous")) {
      throw new Error("Anonymous accounts cannot play.");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    let user;
    if (!existing) {
      const defaultTeam = defaultTeamForEmail(email);
      await ensureTeam(ctx, defaultTeam);
      await ensureGameState(ctx);

      const playerId = makePlayerId(firebaseUid);
      const displayName =
        args.name?.trim() ||
        identity.name ||
        email?.split("@")[0] ||
        playerId;

      const id = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        firebaseUid,
        name: displayName,
        email,
        role: "seeker",
        teamExternalId: defaultTeam,
        playerId,
        status: "active",
        score: 0,
        eliminationTokens: 0,
        artifactsClaimed: 0,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      });
      const created = await ctx.db.get("users", id);
      if (!created) throw new Error("Failed to create user");
      user = created;
    } else {
      const patch: {
        lastSeenAt: number;
        updatedAt?: number;
        name?: string;
        email?: string | null;
        teamExternalId?: string;
        playerId?: string;
        status?: "active";
        role?: "seeker";
      } = { lastSeenAt: now };

      if (args.name && args.name !== existing.name) {
        patch.name = args.name;
        patch.updatedAt = now;
      }
      if (existing.email !== email) patch.email = email;
      if (!existing.teamExternalId) {
        const defaultTeam = defaultTeamForEmail(email);
        await ensureTeam(ctx, defaultTeam);
        patch.teamExternalId = defaultTeam;
      }
      if (!existing.playerId) patch.playerId = makePlayerId(firebaseUid);
      if (!existing.status) patch.status = "active";
      if (!existing.role) patch.role = "seeker";

      await ctx.db.patch("users", existing._id, patch);
      const updated = await ctx.db.get("users", existing._id);
      if (!updated) throw new Error("Failed to update user");
      user = updated;
    }

    await ensureGameState(ctx);

    return {
      profile: toProfile(user),
      claimsUpdated: false,
    };
  },
});

export const getMyProfile = query({
  args: {},
  returns: v.union(profileValidator, v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
    return toProfile(user);
  },
});

export const getProfileByFirebaseUid = query({
  args: { firebaseUid: v.string() },
  returns: v.union(profileValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_firebase_uid", (q) => q.eq("firebaseUid", args.firebaseUid))
      .unique();
    if (!user) return null;
    return toProfile(user);
  },
});

export const getMyProfileSnapshot = query({
  args: {},
  returns: v.union(
    v.object({
      uid: v.string(),
      role: v.union(
        v.literal("seeker"),
        v.literal("hider"),
        v.literal("surveillance"),
        v.literal("admin"),
      ),
      teamId: v.union(v.string(), v.null()),
      status: v.union(v.literal("active"), v.literal("eliminated"), v.literal("suspended")),
      playerId: v.string(),
      name: v.string(),
      score: v.number(),
      eliminationTokens: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
    return {
      uid: user.firebaseUid,
      role: user.role,
      teamId: user.teamExternalId,
      status: user.status,
      playerId: user.playerId,
      name: user.name,
      score: user.score,
      eliminationTokens: user.eliminationTokens,
    };
  },
});
